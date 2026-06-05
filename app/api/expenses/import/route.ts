import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { ExpenseStatus } from "@prisma/client"
import type { MappedExpense } from "@/lib/expenses/csv-map"

export async function POST(req: NextRequest) {
  const session = await auth()
  const tenantId = session?.user?.tenantId
  if (!tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await req.json()) as { expenses: MappedExpense[] }
  const incoming = body.expenses ?? []

  // Pre-load lookup data
  const [categories, campaigns, existing] = await Promise.all([
    prisma.expenseCategory.findMany({
      where: { tenantId },
      select: { id: true, name: true },
    }),
    prisma.revflowCampaign.findMany({
      where: { tenantId },
      select: { id: true, revflowId: true, campaignCode: true, campaignName: true },
    }),
    prisma.expense.findMany({
      where: { tenantId, externalExpenseId: { not: null } },
      select: { id: true, externalExpenseId: true },
    }),
  ])

  // Lookup maps
  const catByName = new Map(
    categories.map((c) => [c.name.toLowerCase().trim(), c.id])
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
    existing.map((e) => [e.externalExpenseId!, e.id])
  )

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
  const errors: Array<{ row: number; ref: string; error: string }> = []

  for (let i = 0; i < incoming.length; i++) {
    const e = incoming[i]

    // Resolve category by name (case-insensitive)
    const categoryId = catByName.get(e.categoryName.toLowerCase().trim())
    if (!categoryId) {
      errors.push({
        row: i + 2,
        ref: e.externalExpenseId,
        error: `Category not found: "${e.categoryName}" — create it under Expenses → Categories first`,
      })
      skipped++
      continue
    }

    const campaignId = resolveCampaign(e.campaignRef)

    const expenseData = {
      categoryId,
      expenseDate:        new Date(e.expenseDate),
      description:        e.description,
      amount:             e.amount,
      taxAmount:          e.taxAmount,
      totalAmount:        e.totalAmount,
      status:             e.status as ExpenseStatus,
      campaignId:         campaignId ?? null,
      externalExpenseId:  e.externalExpenseId,
    }

    try {
      const existingId = existingByExternalId.get(e.externalExpenseId)

      if (existingId) {
        await prisma.expense.update({
          where: { id: existingId },
          data: expenseData,
        })
        updated++
      } else {
        await prisma.expense.create({
          data: { tenantId, ...expenseData },
        })
        existingByExternalId.set(e.externalExpenseId, "new")
        imported++
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error"
      errors.push({ row: i + 2, ref: e.externalExpenseId, error: message })
      skipped++
    }
  }

  return NextResponse.json({ imported, updated, skipped, errors })
}
