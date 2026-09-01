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
  const incomingIds = Array.from(
    new Set(incoming.map((expense) => expense.externalExpenseId).filter(Boolean))
  )

  // Pre-load lookup data and accounting locks for this import batch.
  const [categories, existing, postedJournals] = await Promise.all([
    prisma.expenseCategory.findMany({
      where: { tenantId },
      select: { id: true, name: true },
    }),
    prisma.expense.findMany({
      where: { tenantId, externalExpenseId: { in: incomingIds } },
      select: { id: true, externalExpenseId: true },
    }),
    prisma.journalEntry.findMany({
      where: {
        tenantId,
        source: { in: ["expense_approval", "expense_reimbursement"] },
        sourceId: { in: incomingIds },
      },
      select: { sourceId: true, source: true },
    }),
  ])

  const catByName = new Map(
    categories.map((c) => [c.name.toLowerCase().trim(), c.id])
  )
  const existingByExternalId = new Map(
    existing.map((e) => [e.externalExpenseId!, e.id])
  )
  const postedSourceIds = new Set(postedJournals.map((journal) => journal.sourceId).filter(Boolean))

  let imported = 0
  let updated = 0
  let skipped = 0
  const errors: Array<{ row: number; ref: string; error: string }> = []
  const warnings: Array<{ row: number; ref: string; warning: string }> = []

  for (let i = 0; i < incoming.length; i++) {
    const e = incoming[i]

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

    // A CSV is not a reliable accounting event source for approval/reimbursement
    // dates. Preserve the row, but keep it non-posting until a verified workflow
    // (for example XpenxFlow) supplies the actual event.
    const requiresAccountingEvent = e.status === "APPROVED" || e.status === "REIMBURSED"
    const safeStatus: ExpenseStatus = requiresAccountingEvent
      ? ExpenseStatus.PENDING
      : (e.status as ExpenseStatus)

    if (requiresAccountingEvent) {
      warnings.push({
        row: i + 2,
        ref: e.externalExpenseId,
        warning:
          `CSV status ${e.status} was imported as PENDING because the file does not provide ` +
          "a verified accounting event date. Approve/reimburse through the connected source workflow.",
      })
    }

    const expenseData = {
      categoryId,
      expenseDate:        new Date(e.expenseDate),
      description:        e.description,
      amount:             e.amount,
      taxAmount:          e.taxAmount,
      totalAmount:        e.totalAmount,
      status:             safeStatus,
      externalExpenseId:  e.externalExpenseId,
    }

    try {
      const existingId = existingByExternalId.get(e.externalExpenseId)

      if (existingId) {
        if (postedSourceIds.has(e.externalExpenseId)) {
          errors.push({
            row: i + 2,
            ref: e.externalExpenseId,
            error:
              "This expense already has accounting entries. CSV import cannot overwrite a posted expense; " +
              "use a controlled adjustment or reversal.",
          })
          skipped++
          continue
        }

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

  return NextResponse.json({ imported, updated, skipped, errors, warnings })
}
