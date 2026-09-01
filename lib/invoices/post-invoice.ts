/**
 * Shared invoice posting service.
 *
 * Marks a DRAFT invoice as SENT and posts the matching AR / Revenue / VAT
 * journal atomically. JournalEntry + JournalEntryLine is the authoritative GL.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toNGN } from "@/lib/utils";
import { sendInvoiceEmail } from "@/lib/email-notifications/senders/invoice-sent";
import { COA_AR_CODE, COA_OUTPUT_VAT_CODE } from "@/lib/constants";
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
  accountId: string;
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

  // Fetch the source dimensions together with the invoice lines. These dimensions
  // must survive into JournalEntryLine so Project and Reporting Tag reporting works.
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

  // Validate every explicitly selected revenue account in this tenant before any write.
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

  const rate = parseFloat(String(invoice.exchangeRate));
  const totalAmountNGN = toNGN(parseFloat(String(invoice.totalAmount)), rate);
  const taxAmountNGN = toNGN(parseFloat(String(invoice.taxAmount)), rate);
  const invoiceDiscountNGN = toNGN(parseFloat(String(invoice.discountAmount)), rate);

  // Temporary compatibility: resolve FINOS system accounts using the existing codes.
  // Step 2 system-account role mapping will replace these code dependencies.
  const arAccount = await prisma.chartOfAccounts.findFirst({
    where: { tenantId, code: COA_AR_CODE, isActive: true },
    select: { id: true },
  });
  if (!arAccount) {
    return {
      error:
        `Accounts Receivable account (${COA_AR_CODE}) not found or inactive. ` +
        "Configure the system Accounts Receivable account before posting.",
    };
  }

  let vatAccountId: string | null = null;
  if (taxAmountNGN > 0.001) {
    const vatAccount = await prisma.chartOfAccounts.findFirst({
      where: { tenantId, code: COA_OUTPUT_VAT_CODE, isActive: true },
      select: { id: true },
    });
    if (!vatAccount) {
      return {
        error:
          `Output VAT account (${COA_OUTPUT_VAT_CODE}) not found or inactive. ` +
          "Configure the system Output VAT account before posting.",
      };
    }
    vatAccountId = vatAccount.id;
  }

  // A DRAFT invoice with an existing invoice journal indicates inconsistent state.
  // Do not silently mark it SENT simply because the journal helper is idempotent.
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

  // Preserve accounting dimensions by aggregating only lines with the same
  // revenue account + Project + Reporting Tags. Two projects sharing one revenue
  // account therefore remain distinct in the GL.
  const revenueGroups = new Map<string, RevenueGroup>();
  for (const line of invoice.lines) {
    const accountId = line.incomeAccountId!;
    const projectId = line.projectId ?? null;
    const reportingTags = normaliseReportingTags(line.reportingTags);
    const key = dimensionKey(accountId, projectId, reportingTags);
    const gross = parseFloat(String(line.amount));
    const lineDiscount = parseFloat(String(line.discountAmount));
    const amount = toNGN(gross - lineDiscount, rate);

    const current = revenueGroups.get(key);
    if (current) {
      current.amount = Math.round((current.amount + amount) * 100) / 100;
    } else {
      revenueGroups.set(key, {
        accountId,
        projectId,
        reportingTags,
        amount: Math.round(amount * 100) / 100,
      });
    }
  }

  // Allocate invoice-level discount proportionally across dimensional revenue groups.
  if (invoiceDiscountNGN > 0.001) {
    const totalBeforeInvoiceDiscount = Array.from(revenueGroups.values())
      .reduce((sum, group) => sum + group.amount, 0);

    if (totalBeforeInvoiceDiscount > 0) {
      for (const group of revenueGroups.values()) {
        const reduction = Math.round(
          invoiceDiscountNGN * (group.amount / totalBeforeInvoiceDiscount) * 100,
        ) / 100;
        group.amount = Math.round((group.amount - reduction) * 100) / 100;
      }
    }
  }

  // Correct only harmless rounding noise, and only on the largest revenue group.
  const revenueTotal = Array.from(revenueGroups.values())
    .reduce((sum, group) => sum + group.amount, 0);
  const expectedRevenue = Math.round((totalAmountNGN - taxAmountNGN) * 100) / 100;
  const roundingDifference = Math.round((expectedRevenue - revenueTotal) * 100) / 100;

  if (Math.abs(roundingDifference) > 1) {
    return {
      error:
        `Journal rounding imbalance exceeds tolerance (${roundingDifference} NGN). ` +
        "This may indicate a data inconsistency. Please review the invoice.",
    };
  }

  if (roundingDifference !== 0 && revenueGroups.size > 0) {
    let largest: RevenueGroup | null = null;
    for (const group of revenueGroups.values()) {
      if (!largest || group.amount > largest.amount) largest = group;
    }
    if (largest) {
      largest.amount = Math.round((largest.amount + roundingDifference) * 100) / 100;
    }
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
    journalLines.push({
      accountId: group.accountId,
      description: `Revenue - ${invoice.invoiceNumber}${fxNote}`,
      debit: 0,
      credit: group.amount,
      projectId: group.projectId,
      reportingTags: group.reportingTags,
    });
  }

  // AR and VAT remain invoice-level lines. Project/tag dimensions are carried on
  // the revenue lines where the source invoice line provides an unambiguous basis.
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

      // The source document and journal now share one database transaction.
      // Period checking, account/dimension validation, double-entry validation,
      // idempotency and JE numbering are centralised in the authoritative engine.
      await postJournalEntryInTransaction(tx, {
        tenantId,
        createdBy: userId,
        entryDate: invoice.issueDate,
        reference: invoice.invoiceNumber,
        description: `Invoice ${invoice.invoiceNumber}${fxNote}`,
        recognitionPeriod: invoice.recognitionPeriod,
        source: "invoice",
        sourceId: invoiceId,
        lines: journalLines,
      });

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
