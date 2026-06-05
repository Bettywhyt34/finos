import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { MappedVendor } from "@/lib/vendors/csv-map"

/** Generate a short vendor code from company name + running counter */
function generateVendorCode(name: string, taken: Set<string>): string {
  const base = name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6)
    .padEnd(3, "X")

  let code = base
  let n = 1
  while (taken.has(code)) {
    code = `${base.slice(0, 4)}${String(n).padStart(2, "0")}`
    n++
  }
  taken.add(code)
  return code
}

export async function POST(req: NextRequest) {
  const session = await auth()
  const tenantId = session?.user?.tenantId
  if (!tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await req.json()) as { rows: MappedVendor[] }
  const rows = body.rows ?? []

  // Pre-load existing vendor codes + externalVendorIds for dedup
  const existing = await prisma.vendor.findMany({
    where: { tenantId },
    select: { id: true, vendorCode: true, externalVendorId: true },
  })
  const byExternalId = new Map(
    existing.filter((v) => v.externalVendorId).map((v) => [v.externalVendorId!, v.id])
  )
  const takenCodes = new Set(existing.map((v) => v.vendorCode))

  let imported = 0
  let updated = 0
  let skipped = 0
  const errors: Array<{ row: number; error: string }> = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNum = i + 2

    if (!row.companyName?.trim()) {
      errors.push({ row: rowNum, error: "Company Name is required" })
      skipped++
      continue
    }

    const data = {
      companyName: row.companyName.trim(),
      contactName: row.contactName || null,
      email: row.email || null,
      phone: row.phone || null,
      billingAddress: row.billingAddress || null,
      billingCity: row.billingCity || null,
      billingState: row.billingState || null,
      billingCountry: row.billingCountry || null,
      billingPostalCode: row.billingPostalCode || null,
      paymentTerms: row.paymentTerms ?? 0,
      openingBalance: row.openingBalance ?? 0,
      currency: row.currency || "NGN",
      notes: row.notes || null,
      website: row.website || null,
      isActive: row.isActive !== false,
      externalVendorId: row.externalVendorId || null,
    }

    try {
      const existingId = byExternalId.get(row.externalVendorId)
      if (existingId) {
        await prisma.vendor.update({ where: { id: existingId }, data })
        updated++
      } else {
        const vendorCode = generateVendorCode(row.companyName, takenCodes)
        await prisma.vendor.create({
          data: { tenantId, vendorCode, ...data },
        })
        if (row.externalVendorId) {
          byExternalId.set(row.externalVendorId, "new")
        }
        imported++
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error"
      errors.push({ row: rowNum, error: message })
      skipped++
    }
  }

  return NextResponse.json({ imported, updated, skipped, errors })
}
