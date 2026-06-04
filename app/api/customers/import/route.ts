import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import {
  CustomerImportRow,
  parsePaymentTerms,
  generateCustomerCode,
} from "@/lib/customers/csv-map"

export async function POST(req: NextRequest) {
  const session = await auth()
  const tenantId = session?.user?.tenantId
  if (!tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json() as { rows: CustomerImportRow[] }
  const rows = body.rows ?? []

  // Pre-load existing customer codes for this tenant to detect conflicts
  const existing = await prisma.customer.findMany({
    where: { tenantId },
    select: { id: true, customerCode: true },
  })
  const existingByCode = new Map(existing.map((c) => [c.customerCode, c.id]))

  // Track codes assigned during this import to avoid within-batch duplicates
  const assignedCodes = new Set(existing.map((c) => c.customerCode))

  let imported = 0
  let updated = 0
  let skipped = 0
  const errors: Array<{ row: number; error: string }> = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNum = i + 2 // 1-based + header row

    if (!row.companyName?.trim()) {
      errors.push({ row: rowNum, error: "Company Name is required" })
      skipped++
      continue
    }

    // Resolve customer code
    let code = row.customerCode?.trim()
    if (!code) {
      code = generateCustomerCode(row.companyName, assignedCodes)
    } else {
      assignedCodes.add(code)
    }

    const data = {
      companyName: row.companyName.trim(),
      salutation: row.salutation || null,
      firstName: row.firstName || null,
      lastName: row.lastName || null,
      contactName: row.contactName || null,
      email: row.email || null,
      phone: row.phone || null,
      mobile: row.mobile || null,
      website: row.website || null,
      currency: row.currency || "NGN",
      paymentTerms: parsePaymentTerms(row.paymentTerms ?? "30"),
      creditLimit: row.creditLimit ? parseFloat(row.creditLimit) : null,
      openingBalance: row.openingBalance ? parseFloat(row.openingBalance) : 0,
      customerSubType: row.customerSubType || "business",
      isActive: row.isActive !== "false",
      billingAddress: row.billingAddress || null,
      billingCity: row.billingCity || null,
      billingState: row.billingState || null,
      billingCountry: row.billingCountry || null,
      billingPostalCode: row.billingPostalCode || null,
    }

    try {
      const existingId = existingByCode.get(code)
      if (existingId) {
        await prisma.customer.update({ where: { id: existingId }, data })
        updated++
      } else {
        await prisma.customer.create({
          data: { tenantId, customerCode: code, ...data },
        })
        existingByCode.set(code, "new")
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
