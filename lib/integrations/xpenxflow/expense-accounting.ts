import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { postJournalEntryInTransaction } from "@/lib/journal";
import { resolveSystemAccount } from "@/lib/accounting/system-accounts";
import { getRecognitionPeriod, toNGN } from "@/lib/utils";
import type { XFExpense } from "./cdm";

type ExpenseStatus = "DRAFT" | "PENDING" | "APPROVED" | "REJECTED" | "REIMBURSED";

const STATUS_MAP: Record<string, ExpenseStatus> = {
  draft: "DRAFT",
  submitted: "PENDING",
  approved: "APPROVED",
  rejected: "REJECTED",
  reimbursed: "REIMBURSED",
  cancelled: "DRAFT",
};

function money(value: unknown) {
  return Math.round(Number(value) * 100) / 100;
}

function sameMoney(a: unknown, b: unknown) {
  return Math.abs(money(a) - money(b)) <= 0.01;
}

/**
 * Upsert one XpenxFlow expense and apply its accounting lifecycle atomically.
 *
 * approved:    Dr Expense / Cr Expense Reimbursement Payable
 * reimbursed:  Dr Expense Reimbursement Payable / Cr Default Bank
 *
 * XpenxFlow owns approval. FINOS owns the accounting consequence.
 */
export async function upsertXpenxflowExpenseWithAccounting(
  tenantId: string,
  xf: XFExpense,
): Promise<"created" | "updated"> {
  const catCache = await prisma.unifiedTransactionsCache.findFirst({
    where: {
      tenantId,
      sourceApp: "xpenxflow",
      sourceTable: "expense_categories",
      sourceId: xf.category_id,
    },
    select: { dataJson: true },
  });

  let category: { id: string; accountId: string } | null = null;
  if (catCache?.dataJson) {
    const catName = (catCache.dataJson as unknown as { name: string }).name;
    category = await prisma.expenseCategory.findFirst({
      where: { tenantId, name: catName },
      select: { id: true, accountId: true },
    });
  }
  if (!category) {
    throw new Error(
      `Expense category "${xf.category_id}" not in FINOS. Sync categories before expenses.`,
    );
  }

  const expenseAccount = await prisma.chartOfAccounts.findFirst({
    where: {
      tenantId,
      id: category.accountId,
      isActive: true,
      type: "EXPENSE",
    },
    select: { id: true },
  });
  if (!expenseAccount) {
    throw new Error(
      "The mapped expense category does not point to an active FINOS Expense account.",
    );
  }

  const status = STATUS_MAP[xf.status] ?? "DRAFT";
  const description = `${xf.expense_number} — ${xf.description} (${xf.employee_name})`;
  const totalNGN = toNGN(xf.total_amount, xf.exchange_rate || 1);
  const approvalDate = xf.approved_at ? new Date(xf.approved_at) : new Date(xf.expense_date);
  const reimbursementDate = xf.reimbursed_at ? new Date(xf.reimbursed_at) : null;

  if (["APPROVED", "REIMBURSED"].includes(status) && Number.isNaN(approvalDate.getTime())) {
    throw new Error("Approved expense is missing a valid approval/expense date.");
  }
  if (status === "REIMBURSED" && (!reimbursementDate || Number.isNaN(reimbursementDate.getTime()))) {
    throw new Error(
      `Reimbursed expense ${xf.expense_number} is missing reimbursed_at. ` +
      "FINOS will not invent a bank-settlement date.",
    );
  }

  const existing = await prisma.expense.findFirst({
    where: {
      tenantId,
      OR: [
        { externalExpenseId: xf.id },
        { externalExpenseId: null, description: { startsWith: `${xf.expense_number} —` } },
      ],
    },
    select: {
      id: true,
      categoryId: true,
      amount: true,
      taxAmount: true,
      totalAmount: true,
      projectId: true,
      reportingTags: true,
    },
  });

  const [approvalJournal, reimbursementJournal] = await Promise.all([
    prisma.journalEntry.findFirst({
      where: { tenantId, source: "expense_approval", sourceId: xf.id },
      include: { lines: { select: { accountId: true, debit: true, credit: true } } },
    }),
    prisma.journalEntry.findFirst({
      where: { tenantId, source: "expense_reimbursement", sourceId: xf.id },
      select: { id: true },
    }),
  ]);

  if (approvalJournal) {
    const postedDebit = approvalJournal.lines.reduce(
      (sum, line) => sum + Number(line.debit),
      0,
    );
    const postedExpenseAccount = approvalJournal.lines.find(
      (line) => Number(line.debit) > 0.001,
    )?.accountId;

    if (!sameMoney(postedDebit, totalNGN) || postedExpenseAccount !== expenseAccount.id) {
      throw new Error(
        `Expense ${xf.expense_number} changed after accounting recognition. ` +
        "A controlled adjustment/reversal is required; the sync will not rewrite posted accounting.",
      );
    }
    if (["DRAFT", "PENDING", "REJECTED"].includes(status)) {
      throw new Error(
        `Expense ${xf.expense_number} was already recognised but source status is now ${status}. ` +
        "A controlled reversal is required.",
      );
    }
  }

  if (reimbursementJournal && status !== "REIMBURSED") {
    throw new Error(
      `Expense ${xf.expense_number} was already reimbursed in FINOS but source status is now ${status}. ` +
      "A controlled settlement reversal is required.",
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const expenseData = {
      categoryId: category.id,
      expenseDate: new Date(xf.expense_date),
      description,
      amount: xf.amount,
      taxAmount: xf.tax_amount,
      totalAmount: xf.total_amount,
      status,
      receiptUrl: xf.receipt_url ?? null,
      approvedBy: xf.approved_by ?? null,
      approvedAt: xf.approved_at ? new Date(xf.approved_at) : null,
      externalExpenseId: xf.id,
    } satisfies Prisma.ExpenseUncheckedUpdateInput;

    const localExpense = existing
      ? await tx.expense.update({
          where: { id: existing.id },
          data: expenseData,
          select: { id: true, projectId: true, reportingTags: true },
        })
      : await tx.expense.create({
          data: { tenantId, ...expenseData } as Prisma.ExpenseUncheckedCreateInput,
          select: { id: true, projectId: true, reportingTags: true },
        });

    if (status === "APPROVED" || status === "REIMBURSED") {
      const payable = await resolveSystemAccount(
        tx,
        tenantId,
        "EXPENSE_REIMBURSEMENT_PAYABLE",
      );

      const tags =
        localExpense.reportingTags &&
        !Array.isArray(localExpense.reportingTags) &&
        typeof localExpense.reportingTags === "object"
          ? (localExpense.reportingTags as Record<string, string>)
          : null;

      await postJournalEntryInTransaction(tx, {
        tenantId,
        createdBy: "system:xpenxflow",
        entryDate: approvalDate,
        reference: xf.expense_number,
        description: `Approved expense ${xf.expense_number}`,
        recognitionPeriod: getRecognitionPeriod(approvalDate),
        source: "expense_approval",
        sourceId: xf.id,
        lines: [
          {
            accountId: expenseAccount.id,
            description: xf.description,
            debit: totalNGN,
            credit: 0,
            projectId: localExpense.projectId,
            reportingTags: tags,
          },
          {
            accountId: payable.id,
            description: `Expense reimbursement payable - ${xf.expense_number}`,
            debit: 0,
            credit: totalNGN,
          },
        ],
      });

      if (status === "REIMBURSED" && reimbursementDate) {
        const bank = await resolveSystemAccount(tx, tenantId, "DEFAULT_BANK", "CA-003");
        await postJournalEntryInTransaction(tx, {
          tenantId,
          createdBy: "system:xpenxflow",
          entryDate: reimbursementDate,
          reference: xf.expense_number,
          description: `Expense reimbursement ${xf.expense_number}`,
          recognitionPeriod: getRecognitionPeriod(reimbursementDate),
          source: "expense_reimbursement",
          sourceId: xf.id,
          lines: [
            {
              accountId: payable.id,
              description: `Settle reimbursement payable - ${xf.expense_number}`,
              debit: totalNGN,
              credit: 0,
            },
            {
              accountId: bank.id,
              description: `Expense reimbursement paid - ${xf.expense_number}`,
              debit: 0,
              credit: totalNGN,
            },
          ],
        });
      }
    }

    return existing ? "updated" as const : "created" as const;
  });

  return result;
}
