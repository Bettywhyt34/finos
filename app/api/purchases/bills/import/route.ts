import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { BillStatus } from "@prisma/client"
import type { MappedBill } from "@/lib/bills/csv-map"

export async function POST(req: NextRequest) {
  const session = await auth()
  const tenantId = session?.user?.tenantId
  if (!tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await req.json()) as { bills: MappedBill[] }
  const incomingBills = body.bills ?? []

  // Pre-load vendors and campaigns for fast lookup
  const [vendors, campaigns, existingBills, defaultAccount] = await Promise.all([
    prisma.vendor.findMany({
      where: { tenantId },
      select: { id: true, companyName: true },
    }),
    prisma.revflowCampaign.findMany({
      where: { tenantId },
      select: { id: true, revflowId: true, campaignCode: true, campaignName: true },
    }),
    prisma.bill.findMany({
      where: { tenantId, externalBillId: { not: null } },
      select: { id: true, externalBillId: true },
    }),
    // Fallback GL account for unresolved account codes (AP)
    prisma.chartOfAccounts.findFirst({
      where: { tenantId, code: "AP-001" },
      select: { id: true },
    }),
  ])

  // Lookup maps
  const vendorByName = new Map(
    vendors.map((v) => [v.companyName.toLowerCase().trim(), v.id])
  )
  const campaignByRevflowId = new Map(campaigns.map((c) => [c.revflowId, c.id]))
  const campaignByCode = new Map(
    campaigns
      .filter((c) => c.campaignCode)
      .map((c) => [c.campaignCode!.toLowerCase(), c.id])
  )
  const campaignByName = new Map(
    campaigns.map((c) => [c.campaignName.toLowerCase(), c.id])
  )
  const existingByExternalId = new Map(
    existingBills.map((b) => [b.externalBillId!, b.id])
  )

  // Pre-load all GL accounts for this tenant
  const glAccounts = await prisma.chartOfAccounts.findMany({
    where: { tenantId },
    select: { id: true, code: true, name: true },
  })
  const glByCode = new Map(glAccounts.map((a) => [a.code.toLowerCase(), a.id]))
  const glByName = new Map(
    glAccounts.map((a) => [a.name.toLowerCase().trim(), a.id])
  )

  function resolveGl(code: string | null, name: string | null): string | null {
    if (code) {
      const found = glByCode.get(code.toLowerCase())
      if (found) return found
    }
    if (name) {
      const found = glByName.get(name.toLowerCase().trim())
      if (found) return found
    }
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

    // Resolve vendor
    const vendorId = vendorByName.get(b.vendorName.toLowerCase().trim())
    if (!vendorId) {
      errors.push({ row: i + 2, bill: b.billNumber, error: `Vendor not found: "${b.vendorName}" — import vendor first` })
      skipped++
      continue
    }

    const campaignId = resolveCampaign(b.campaignRef)

    // Build bill data
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
        // Update bill header only (don't re-create lines on update)
        await prisma.bill.update({
          where: { id: existingId },
          data: billData,
        })
        updated++
      } else {
        // Resolve GL accounts for lines
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
          data: {
            tenantId,
            ...billData,
            lines: { create: resolvedLines },
          },
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
