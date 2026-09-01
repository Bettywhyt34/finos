"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { postJournalEntryInTransaction, type JournalPostingLine } from "@/lib/journal";
import { getRecognitionPeriod } from "@/lib/utils";

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normaliseReportingTags(value: Prisma.JsonValue | null): Record<string, string> | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const pairs = Object.entries(value)
    .filter(([, optionId]) => typeof optionId === "string" && optionId.length > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  return pairs.length ? Object.fromEntries(pairs) as Record<string, string> : null;
}

function proportionalReversal(
  lines: Array<{
    accountId: string;
    description: string | null;
    debit: unknown;
    credit: unknown;
    projectId: string | null;
    reportingTags: Prisma.JsonValue | null;
  }>,
  ratio: number,
  label: string,
): JournalPostingLine[] {
  const scaled = lines.map((line) => ({
    accountId: line.accountId,
    description: `Credit note ${label} - ${line.description ?? "Invoice adjustment"}`,
    debit: roundMoney(Number(line.credit) * ratio),
    credit: roundMoney(Number(line.debit) * ratio),
    projectId: line.projectId ?? null,
    reportingTags: normaliseReportingTags(line.reportingTags),
  }));

  let debit = roundMoney(scaled.reduce((sum, line) => sum + line.debit, 0));
  let credit = roundMoney(scaled.reduce((sum, line) => sum + line.credit, 0));
  const difference = roundMoney(debit - credit);
  if (Math.abs(difference) > 0.001) {
    const targetSide = difference > 0 ? "credit" : "debit";
    const candidates = scaled
      .map((line, index) => ({ index, amount: targetSide === "credit" ? line.credit : line.debit }))
      .sort((a, b) => b.amount - a.amount);
    const target = candidates[0];
    if (!target) throw new Error("Credit note journal could not be balanced.");
    if (targetSide === "credit") scaled[target.index].credit = roundMoney(scaled[target.index].credit + difference);
    else scaled[target.index].debit = roundMoney(scaled[target.index].debit + Math.abs(difference));
    debit = roundMoney(scaled.reduce((sum, line) => sum + line.debit, 0));
    credit = roundMoney(scaled.reduce((sum, line) => sum + line.credit, 0));
  }
  if (Math.abs(debit - credit) > 0.01) throw new Error("Credit note journal is not balanced.");
  return scaled.filter((line) => line.debit > 0.001 || line.credit > 0.001);
}

export async function applyInvoiceCreditNote(input: {
  invoiceId: string;
  amount: number;
  issueDate: string;
  reason: string;
}): Promise<{ success: true; creditNoteId: string } | { error: string }> {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  const userId = session?.user?.id;
  const role = session?.user?.role;
  if (!tenantId || !userId) return { error: "Your session has expired. Please sign in again." };
  if (!role || !["OWNER", "ADMIN", "ACCOUNTANT"].includes(role)) {
    return { error: "You do not have permission to create credit notes." };
  }

  const amount = roundMoney(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Credit amount must be greater than zero." };
  const reason = input.reason.trim();
  if (!reason) return { error: "Enter a reason for the credit note." };
  if (reason.length > 2000) return { error: "Credit note reason is too long." };
  const issueDate = new Date(`${input.issueDate}T00:00:00`);
  if (Number.isNaN(issueDate.getTime())) return { error: "Enter a valid credit note date." };
  if (issueDate > new Date()) return { error: "Credit note date cannot be in the future." };

  try {
    const creditNoteId = crypto.randomUUID();

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:invoice:${tenantId}:${input.invoiceId}`}))`;

      const invoice = await tx.invoice.findFirst({
        where: { id: input.invoiceId, tenantId },
        select: {
          id: true,
          customerId: true,
          invoiceNumber: true,
          status: true,
          currency: true,
          exchangeRate: true,
          totalAmount: true,
          amountPaid: true,
          balanceDue: true,
          lines: { select: { projectId: true } },
        },
      });
      if (!invoice) throw new Error("Invoice not found.");
      if (["DRAFT", "VOIDED", "WRITTEN_OFF"].includes(invoice.status)) {
        throw new Error(`A credit note cannot be applied while the invoice is ${invoice.status}.`);
      }
      if (invoice.lines.some((line) => Boolean(line.projectId))) {
        throw new Error(
          "Project-linked invoice credit notes are temporarily blocked until Project revenue allocation adjustments are enabled. This prevents Unearned Income or Contract Asset from being reopened incorrectly.",
        );
      }
      const outstanding = roundMoney(Number(invoice.balanceDue));
      if (outstanding <= 0.01) throw new Error("This invoice has no outstanding balance to credit.");
      if (amount - outstanding > 0.01) {
        throw new Error(`Credit amount cannot exceed the current outstanding balance of ${outstanding.toFixed(2)} ${invoice.currency}.`);
      }
      const totalAmount = Number(invoice.totalAmount);
      if (!Number.isFinite(totalAmount) || totalAmount <= 0) throw new Error("Invoice total is invalid.");
      const exchangeRate = Number(invoice.exchangeRate);
      if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) throw new Error("Invoice exchange rate is invalid.");

      const originalJournal = await tx.journalEntry.findFirst({
        where: { tenantId, source: "invoice", sourceId: invoice.id, isLocked: true },
        include: { lines: true },
      });
      if (!originalJournal) throw new Error("The original invoice journal could not be found.");

      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:credit-note:${tenantId}`}))`;
      const countRows = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS "count" FROM "credit_notes" WHERE "tenant_id" = ${tenantId}::uuid
      `;
      const nextNumber = Number(countRows[0]?.count ?? 0n) + 1;
      const creditNumber = `CN-${String(nextNumber).padStart(5, "0")}`;
      const ratio = amount / totalAmount;
      const lines = proportionalReversal(originalJournal.lines, ratio, creditNumber);
      const baseAmount = roundMoney(amount * exchangeRate);

      const journalEntryId = await postJournalEntryInTransaction(tx, {
        tenantId,
        createdBy: userId,
        entryDate: issueDate,
        reference: creditNumber,
        description: `Credit note ${creditNumber} against ${invoice.invoiceNumber}: ${reason}`,
        recognitionPeriod: getRecognitionPeriod(issueDate),
        source: "credit_note",
        sourceId: creditNoteId,
        lines,
      });

      await tx.$executeRaw`
        INSERT INTO "credit_notes" (
          "id", "tenant_id", "customer_id", "credit_number", "invoice_id", "issue_date",
          "amount", "reason", "status", "currency", "exchange_rate", "base_amount",
          "journal_entry_id", "applied_at", "created_by"
        ) VALUES (
          ${creditNoteId}, ${tenantId}::uuid, ${invoice.customerId}, ${creditNumber}, ${invoice.id}, ${issueDate},
          ${amount}, ${reason}, 'APPLIED'::"CreditNoteStatus", ${invoice.currency}, ${exchangeRate}, ${baseAmount},
          ${journalEntryId}, now(), ${userId}
        )
      `;

      const newBalance = Math.max(0, roundMoney(outstanding - amount));
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          balanceDue: newBalance,
          // A credit note settles AR but is not cash. Preserve SENT/PARTIAL rather than mislabeling it PAID.
          status: Number(invoice.amountPaid) > 0 ? "PARTIAL" : invoice.status,
          paidAt: null,
        },
      });
    });

    revalidatePath("/sales/credit-notes");
    revalidatePath("/sales/invoices");
    revalidatePath(`/sales/invoices/${input.invoiceId}`);
    return { success: true, creditNoteId };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Credit note could not be applied." };
  }
}
