import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { BillStatus } from "@prisma/client"
import type { MappedBill } from "@/lib/bills/csv-map"

type VendorResolution =
  | { action: "map"; vendorId: string }
  | { action: "create" }

/** Generate a short vendor code from company name + de-dupe counter */
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

  const body = (await req.json()) as {
    bills: MappedBill[]
    vendorResolutions?: Record<string, VendorResolution>
  }
  const incomingBills = body.bills ?? []
  const vendorResolutions: Record<string, VendorResolution> = body.vendorResolutions ?? {}

  // Pre-load vendors, campaigns, existing bills, GL accounts
  const [vendors, campaigns, existingBills, defaultAccount] = await Promise.all([
    prisma.vendor.findMany({
      where: { tenantId },
      select: { id: true, companyName: true, vendorCode: true },
    }),
    prisma.revflowCampaign.findMany({
      where: { tenantId },
      select: { id: true, revflowId: true, campaignCode: true, campaignName: true },
    }),
    prisma.bill.findMany({
      where: { tenantId, externalBillId: { not: null } },
      select: { id: true, externalBillId: true },
    }),
    prisma.chartOfAccounts.findFirst({
      where: { tenantId, code: "AP-001" },
      select: { id: true },
    }),
  ])

  // Vendor lookup
  const vendorByName = new Map(vendors.map((v) => [v.companyName.toLowerCase().trim(), v.id]))
  const takenCodes = new Set(vendors.map((v) => v.vendorCode))

  // Apply vendor resolutions — create new vendors first
  for (const [csvName, resolution] of Object.entries(vendorResolutions)) {
    if (resolution.action === "create") {
      const code = generateVendorCode(csvName, takenCodes)
      const created = await prisma.vendor.create({
        data: {
          tenantId,
          companyName: csvName,
          vendorCode: code,
          paymentTerms: 30,
          openingBalance: 0,
          isWhtEligible: false,
        },
      })
      vendorByName.set(csvName.toLowerCase().trim(), created.id)
    } else {
      vendorByName.set(csvName.toLowerCase().trim(), resolution.vendorId)
    }
  }

  // Campaign lookup
  const campaignByRevflowId = new Map(campaigns.map((c) => [c.revflowId, c.id]))
  const campaignByCode = new Map(
    campaigns.filter((c) => c.campaignCode).map((c) => [c.campaignCode!.toLowerCase(), c.id])
  )
  const campaignByName = new Map(campaigns.map((c) => [c.campaignName.toLowerCase(), c.id]))

  // Existing bills (dedup)
  const existingByExternalId = new Map(existingBills.map((b) => [b.externalBillId!, b.id]))

  // GL accounts
  const glAccounts = await prisma.chartOfAccounts.findMany({
    where: { tenantId },
    select: { id: true, code: true, name: true },
  })
  const glByCode = new Map(glAccounts.map((a) => [a.code.toLowerCase(), a.id]))
  const glByName = new Map(glAccounts.map((a) => [a.name.toLowerCase().trim(), a.id]))

  function resolveGl(code: string | null, name: string | null): string | null {
    if (code) { const f = glByCode.get(code.toLowerCase()); if (f) return f }
    if (name) { const f = glByName.get(name.toLowerCase().trim()); if (f) return f }
    return defaultAccount?.id ?? null
  }

  function resolveCampaign(ref: string | null): string | null {
    if (!ref) return null
    const r = ref.trim()
    return (
      campaignByRevflowId.get(r) ??
      campaignByCode.get(r.toLowerCase()) ??
      campaignByName.get(r.toLowerCase()) ??
      null
    )
  }

  let imported = 0
  let updated = 0
  let skipped = 0
  const errors: Array<{ row: number; bill: string; error: string }> = []

  for (let i = 0; i < incomingBills.length; i++) {
    const b = incomingBills[i]

    const vendorId = vendorByName.get(b.vendorName.toLowerCase().trim())
    if (!vendorId) {
      errors.push({ row: i + 2, bill: b.billNumber, error: `Vendor not found: "${b.vendorName}"` })
      skipped++
      continue
    }

    const campaignId = resolveCampaign(b.campaignRef)

    const billData = {
      vendorId,
      billNumber: b.billNumber,
      vendorRef: b.purchaseOrderNumber ?? null,
      billDate: new Date(b.billDate),
      dueDate: new Date(b.dueDate),
      status: b.status as BillStatus,
      currency: b.currency,
      exchangeRate: b.exchangeRate,
      subtotal: b.subtotal,
      taxAmount: b.taxAmount,
      totalAmount: b.totalAmount,
      amountPaid: b.amountPaid,
      notes: b.notes ?? null,
      campaignId: campaignId ?? null,
      externalBillId: b.externalBillId,
      purchaseOrderNumber: b.purchaseOrderNumber ?? null,
    }

    try {
      const existingId = existingByExternalId.get(b.externalBillId)

      if (existingId) {
        await prisma.bill.update({ where: { id: existingId }, data: billData })
        updated++
      } else {
        const resolvedLines = b.lines.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          rate: l.rate,
          amount: l.amount,
          accountId: resolveGl(l.accountCode, l.accountName) ?? defaultAccount?.id ?? "",
        }))

        if (resolvedLines.some((l) => !l.accountId)) {
          errors.push({ row: i + 2, bill: b.billNumber, error: "Could not resolve GL account for one or more lines" })
          skipped++
          continue
        }

        await prisma.bill.create({
          data: { tenantId, ...billData, lines: { create: resolvedLines } },
        })
        existingByExternalId.set(b.externalBillId, "new")
        imported++
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error"
      errors.push({ row: i + 2, bill: b.billNumber, error: message })
      skipped++
    }
  }

  return NextResponse.json({ imported, updated, skipped, errors })
}
