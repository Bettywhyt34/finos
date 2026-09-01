/**
 * Shared invoice posting service.
 *
 * Marks a DRAFT invoice as SENT and posts the matching billing journal atomically.
 * Billing and revenue recognition are separate accounting events:
 * - recogniseRevenueOnInvoiceDate=true  -> Dr AR / Cr Revenue (+ VAT)
 * - recogniseRevenueOnInvoiceDate=false -> Dr AR / Cr Unearned Income (+ VAT)
 *
 * JournalEntry + JournalEntryLine is the authoritative GL.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getRecognitionPeriod, toNGN } from "@/lib/utils";
import { sendInvoiceEmail } from "@/lib/email-notifications/senders/invoice-sent";
import { COA_AR_CODE, COA_OUTPUT_VAT_CODE } from "@/lib/constants";
import { getSystemAccount } from "@/lib/accounting/system-accounts";
import {
  postJournalEntryInTransaction,
  type JournalPostingLine,
} from "@/lib/journal";

export interface PostInvoiceOptions {
  tenantId: string;
  invoiceId: string;
  userId: string;
  /** Operational sent date. Must be today or earlier. */
  sentAt: Date;
  /** Defaults to true. Bulk posting may set false. */
  sendEmail?: boolean;
}

type ReportingTags = Record<string, string> | null;

type RevenueGroup = {
  incomeAccountId: string;
  projectId: string | null;
  reportingTags: ReportingTags;
  amount: number;
};

type SourceLineAllocation = {
  invoiceLineId: string;
  incomeAccountId: string;
  projectId: string | null;
  reportingTags: ReportingTags;
  amount: number;
};

function normaliseReportingTags(value: Prisma.JsonValue | null): ReportingTags {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;

  const pairs = Object.entries(value)
    .filter(([, optionId]) => typeof optionId === "string" && optionId.length > 0)
    .map(([tagId, optionId]) => [tagId, optionId as string] as const)
    .sort(([a], [b]) => a.localeCompare(b));

  return pairs.length ? Object.fromEntries(pairs) : null;
}

function dimensionKey(accountId: string, projectId: string | null, reportingTags: ReportingTags) {
  return JSON.stringify([
    accountId,
    projectId ?? null,
    reportingTags ? Object.entries(reportingTags).sort(([a], [b]) => a.localeCompare(b)) : [],
  ]);
}

export async function postInvoiceAndMarkSent(
  opts: PostInvoiceOptions,
): Promise<{ success: true } | { error: string }> {
  const { tenantId, invoiceId, userId, sendEmail = true } = opts;

  const now = new Date();
  const todayEnd = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999,
  );
  if (!(opts.sentAt instanceof Date) || Number.isNaN(opts.sentAt.getTime())) {
    return { error: "A valid sent date is required." };
  }
  if (opts.sentAt > todayEnd) {
    return { error: "Sent date cannot be in the future. Please select today or a past date." };
  }
  const sentAt = opts.sentAt;

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: {
      lines: {
        select: {
          id: true,
          amount: true,
          discountAmount: true,
          taxAmount: true,
          incomeAccountId: true,
          projectId: true,
          reportingTags: true,
        },
      },
    },
  });

  if (!invoice) return { error: "Invoice not found" };
  if (invoice.status !== "DRAFT") {
    return {
      error: `Invoice is already ${invoice.status}. Only DRAFT invoices can be marked as sent.`,
    };
  }
  if (invoice.lines.length === 0) {
    return { error: "Invoice has no line items. Add at least one line before marking as sent." };
  }

  const missingIncomeLine = invoice.lines.find((line) => !line.incomeAccountId);
  if (missingIncomeLine) {
    return {
      error:
        "One or more invoice lines are missing an income account. " +
        "Edit the invoice and assign an income account to every line.",
    };
  }

  const incomeAccountIds = Array.from(
    new Set(invoice.lines.map((line) => line.incomeAccountId!).filter(Boolean)),
  );
  const validIncomeAccounts = await prisma.chartOfAccounts.findMany({
    where: {
      tenantId,
      id: { in: incomeAccountIds },
      type: "INCOME",
      isActive: true,
    },
    select: { id: true },
  });
  const validIncomeIds = new Set(validIncomeAccounts.map((account) => account.id));
  if (incomeAccountIds.some((id) => !validIncomeIds.has(id))) {
    return {
      error:
        "One or more income accounts on this invoice are inactive or do not belong to this organisation. " +
        "Edit the invoice to reselect valid income accounts.",
    };
  }

  const projectIds = Array.from(
    new Set(invoice.lines.map((line) => line.projectId).filter((id): id is string => Boolean(id))),
  );
  const projects = projectIds.length
    ? await prisma.project.findMany({
        where: { tenantId, id: { in: projectIds } },
        select: { id: true, unearnedIncomeAccountId: true },
      })
    : [];
  if (projects.length !== projectIds.length) {
    return { error: "One or more Projects on this invoice are no longer available to this organisation." };
  }
  const projectMap = new Map(projects.map((project) => [project.id, project]));

  const projectUnearnedIds = Array.from(
    new Set(projects.map((project) => project.unearnedIncomeAccountId).filter((id): id is string => Boolean(id))),
  );
  if (projectUnearnedIds.length) {
    const validUnearned = await prisma.chartOfAccounts.findMany({
      where: {
        tenantId,
        id: { in: projectUnearnedIds },
        type: "LIABILITY",
        isActive: true,
      },
      select: { id: true },
    });
    const validIds = new Set(validUnearned.map((account) => account.id));
    if (projectUnearnedIds.some((id) => !validIds.has(id))) {
      return {
        error:
          "A Project on this invoice has an invalid or inactive Unearned Income account. " +
          "Correct the Project accounting defaults before posting the invoice.",
      };
    }
  }

  const rate = parseFloat(String(invoice.exchangeRate));
  const totalAmountNGN = toNGN(parseFloat(String(invoice.totalAmount)), rate);
  const taxAmountNGN = toNGN(parseFloat(String(invoice.taxAmount)), rate);
  const invoiceDiscountNGN = toNGN(parseFloat(String(invoice.discountAmount)), rate);

  let arAccount;
  try {
    arAccount = await getSystemAccount(
      tenantId,
      "ACCOUNTS_RECEIVABLE",
      COA_AR_CODE,
    );
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Accounts Receivable is not configured." };
  }

  let defaultUnearnedAccountId: string | null = null;
  if (!invoice.recogniseRevenueOnInvoiceDate) {
    try {
      const unearned = await getSystemAccount(tenantId, "UNEARNED_REVENUE");
      defaultUnearnedAccountId = unearned.id;
    } catch (error: unknown) {
      const everyProjectHasOverride = projectIds.length > 0 && projectIds.every(
        (projectId) => Boolean(projectMap.get(projectId)?.unearnedIncomeAccountId),
      );
      const hasUnassignedProjectLine = invoice.lines.some((line) => !line.projectId);
      if (!everyProjectHasOverride || hasUnassignedProjectLine) {
        return {
          error:
            error instanceof Error
              ? error.message
              : "Unearned Revenue is not configured for deferred invoice revenue.",
        };
      }
    }
  }

  let vatAccountId: string | null = null;
  if (taxAmountNGN > 0.001) {
    try {
      const vatAccount = await getSystemAccount(
        tenantId,
        "OUTPUT_VAT",
        COA_OUTPUT_VAT_CODE,
      );
      vatAccountId = vatAccount.id;
    } catch (error: unknown) {
      return { error: error instanceof Error ? error.message : "Output VAT is not configured." };
    }
  }

  const existingJournal = await prisma.journalEntry.findFirst({
    where: { tenantId, source: "invoice", sourceId: invoiceId },
    select: { id: true },
  });
  if (existingJournal) {
    return {
      error:
        "A journal entry already exists for this invoice. Duplicate posting prevented. " +
        "Review the invoice status before retrying.",
    };
  }

  // Build one evidence amount per source line. This mirrors the journal economics
  // but preserves invoice-line identity for later Project revenue recognition.
  const sourceLineAllocations: SourceLineAllocation[] = invoice.lines.map((line) => ({
    invoiceLineId: line.id,
    incomeAccountId: line.incomeAccountId!,
    projectId: line.projectId ?? null,
    reportingTags: normaliseReportingTags(line.reportingTags),
    amount: toNGN(
      parseFloat(String(line.amount)) - parseFloat(String(line.discountAmount)),
      rate,
    ),
  }));

  if (invoiceDiscountNGN > 0.001) {
    const beforeInvoiceDiscount = sourceLineAllocations.reduce((sum, line) => sum + line.amount, 0);
    if (beforeInvoiceDiscount > 0) {
      for (const line of sourceLineAllocations) {
        const reduction = Math.round(
          invoiceDiscountNGN * (line.amount / beforeInvoiceDiscount) * 100,
        ) / 100;
        line.amount = Math.round((line.amount - reduction) * 100) / 100;
      }
    }
  }

  const expectedNetSales = Math.round((totalAmountNGN - taxAmountNGN) * 100) / 100;
  const sourceLineTotal = sourceLineAllocations.reduce((sum, line) => sum + line.amount, 0);
  const sourceLineRounding = Math.round((expectedNetSales - sourceLineTotal) * 100) / 100;
  if (Math.abs(sourceLineRounding) > 1) {
    return {
      error:
        `Invoice line allocation imbalance exceeds tolerance (${sourceLineRounding} NGN). ` +
        "Please review the invoice totals.",
    };
  }
  if (sourceLineRounding !== 0 && sourceLineAllocations.length) {
    let largest = sourceLineAllocations[0];
    for (const line of sourceLineAllocations) {
      if (line.amount > largest.amount) largest = line;
    }
    largest.amount = Math.round((largest.amount + sourceLineRounding) * 100) / 100;
  }

  // Preserve source economics and dimensions by aggregating only lines with the
  // same intended income account + Project + Reporting Tags. When revenue is
  // deferred, the intended income account remains available in the source allocation.
  const revenueGroups = new Map<string, RevenueGroup>();
  for (const line of sourceLineAllocations) {
    const key = dimensionKey(line.incomeAccountId, line.projectId, line.reportingTags);
    const current = revenueGroups.get(key);
    if (current) {
      current.amount = Math.round((current.amount + line.amount) * 100) / 100;
    } else {
      revenueGroups.set(key, {
        incomeAccountId: line.incomeAccountId,
        projectId: line.projectId,
        reportingTags: line.reportingTags,
        amount: line.amount,
      });
    }
  }

  const netSalesTotal = Array.from(revenueGroups.values()).reduce((sum, group) => sum + group.amount, 0);
  const roundingDifference = Math.round((expectedNetSales - netSalesTotal) * 100) / 100;
  if (Math.abs(roundingDifference) > 0.005) {
    return { error: `Journal allocation imbalance: ${roundingDifference.toFixed(2)} NGN.` };
  }

  const fxNote = rate !== 1 ? ` (${invoice.currency} @ ${rate})` : "";
  const journalLines: JournalPostingLine[] = [
    {
      accountId: arAccount.id,
      description: `AR - ${invoice.invoiceNumber}${fxNote}`,
      debit: totalAmountNGN,
      credit: 0,
    },
  ];

  for (const group of revenueGroups.values()) {
    if (group.amount <= 0) continue;
    const projectUnearnedId = group.projectId
      ? projectMap.get(group.projectId)?.unearnedIncomeAccountId ?? null
      : null;
    const postingAccountId = invoice.recogniseRevenueOnInvoiceDate
      ? group.incomeAccountId
      : projectUnearnedId ?? defaultUnearnedAccountId;

    if (!postingAccountId) {
      return { error: "Unearned Revenue is not configured for one or more deferred invoice lines." };
    }

    journalLines.push({
      accountId: postingAccountId,
      description: invoice.recogniseRevenueOnInvoiceDate
        ? `Revenue - ${invoice.invoiceNumber}${fxNote}`
        : `Unearned Income - ${invoice.invoiceNumber}${fxNote}`,
      debit: 0,
      credit: group.amount,
      projectId: group.projectId,
      reportingTags: group.reportingTags,
    });
  }

  if (taxAmountNGN > 0.001 && vatAccountId) {
    journalLines.push({
      accountId: vatAccountId,
      description: `Output VAT - ${invoice.invoiceNumber}${fxNote}`,
      debit: 0,
      credit: taxAmountNGN,
    });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const liveInvoice = await tx.invoice.findFirst({
        where: { id: invoiceId, tenantId },
        select: { status: true },
      });
      if (!liveInvoice) throw new Error("Invoice not found.");
      if (liveInvoice.status !== "DRAFT") {
        throw new Error(
          `Invoice is already ${liveInvoice.status}. Another request may have posted it concurrently.`,
        );
      }

      const duplicateJournal = await tx.journalEntry.findFirst({
        where: { tenantId, source: "invoice", sourceId: invoiceId },
        select: { id: true },
      });
      if (duplicateJournal) {
        throw new Error("A journal entry already exists for this invoice. Concurrent duplicate prevented.");
      }

      await postJournalEntryInTransaction(tx, {
        tenantId,
        createdBy: userId,
        entryDate: invoice.issueDate,
        reference: invoice.invoiceNumber,
        description: invoice.recogniseRevenueOnInvoiceDate
          ? `Invoice ${invoice.invoiceNumber}${fxNote}`
          : `Invoice ${invoice.invoiceNumber} — revenue deferred${fxNote}`,
        recognitionPeriod: getRecognitionPeriod(invoice.issueDate),
        source: "invoice",
        sourceId: invoiceId,
        lines: journalLines,
      });

      // One immutable billing allocation per Project invoice line. Values are stored
      // in the base ledger currency (NGN), matching the authoritative journal.
      for (const allocation of sourceLineAllocations) {
        if (!allocation.projectId || allocation.amount <= 0) continue;
        await tx.$executeRaw`
          INSERT INTO "invoice_line_revenue_allocations" (
            "tenant_id", "project_id", "invoice_id", "invoice_line_id", "income_account_id",
            "currency", "invoice_amount", "contract_asset_cleared", "immediate_revenue", "unearned_created"
          ) VALUES (
            ${tenantId}::uuid, ${allocation.projectId}, ${invoice.id}, ${allocation.invoiceLineId},
            ${allocation.incomeAccountId}, 'NGN', ${allocation.amount}, 0,
            ${invoice.recogniseRevenueOnInvoiceDate ? allocation.amount : 0},
            ${invoice.recogniseRevenueOnInvoiceDate ? 0 : allocation.amount}
          )
        `;
      }

      const updated = await tx.invoice.updateMany({
        where: { id: invoiceId, tenantId, status: "DRAFT" },
        data: { status: "SENT", sentAt },
      });
      if (updated.count !== 1) {
        throw new Error(
          "Invoice status changed before the update could complete. Transaction rolled back.",
        );
      }
    });
  } catch (error: unknown) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Failed to post invoice. Invoice status was not changed.",
    };
  }

  if (sendEmail) {
    void sendInvoiceEmail({ tenantId, invoiceId })
      .then((result) => {
        if (!result.sent) {
          console.warn(`[INVOICE_SENT] Email not sent for invoice ${invoiceId}: ${result.reason}`);
        }
      })
      .catch((error: unknown) => {
        console.error(`[INVOICE_SENT] Unexpected email error for invoice ${invoiceId}:`, error);
      });
  }

  return { success: true };
}
