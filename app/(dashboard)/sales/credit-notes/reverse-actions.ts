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

export async function reverseCreditNote(input: {
  creditNoteId: string;
  reversalDate: string;
  reason: string;
}): Promise<{ success: true } | { error: string }> {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  const userId = session?.user?.id;
  const role = session?.user?.role;
  if (!tenantId || !userId) return { error: "Your session has expired. Please sign in again." };
  if (!role || !["OWNER", "ADMIN", "ACCOUNTANT"].includes(role)) {
    return { error: "You do not have permission to reverse credit notes." };
  }

  const reason = input.reason.trim();
  if (!reason) return { error: "Enter a reversal reason." };
  if (reason.length > 2000) return { error: "Reversal reason is too long." };
  const reversalDate = new Date(`${input.reversalDate}T00:00:00`);
  if (Number.isNaN(reversalDate.getTime())) return { error: "Enter a valid reversal date." };
  if (reversalDate > new Date()) return { error: "Reversal date cannot be in the future." };

  try {
    let invoiceId = "";

    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{
        id: string;
        creditNumber: string;
        invoiceId: string;
        issueDate: Date;
        status: string;
        arAppliedAmount: unknown;
        customerCreditAmount: unknown;
        journalEntryId: string | null;
      }>>`
        SELECT "id", "credit_number" AS "creditNumber", "invoice_id" AS "invoiceId",
               "issue_date" AS "issueDate", "status"::text AS "status",
               "ar_applied_amount" AS "arAppliedAmount",
               "customer_credit_amount" AS "customerCreditAmount",
               "journal_entry_id" AS "journalEntryId"
        FROM "credit_notes"
        WHERE "id" = ${input.creditNoteId}
          AND "tenant_id" = ${tenantId}::uuid
        LIMIT 1
      `;
      const credit = rows[0];
      if (!credit) throw new Error("Credit note not found.");
      if (credit.status === "REVERSED") throw new Error("This credit note has already been reversed.");
      if (credit.status !== "APPLIED") throw new Error(`A ${credit.status.toLowerCase()} credit note cannot be reversed.`);
      if (!credit.journalEntryId) throw new Error("The credit note has no authoritative journal evidence.");
      if (reversalDate < credit.issueDate) throw new Error("Reversal date cannot be before the credit-note date.");
      invoiceId = credit.invoiceId;

      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:invoice:${tenantId}:${invoiceId}`}))`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:invoice-revenue:${tenantId}:${invoiceId}`}))`;

      const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId, tenantId },
        select: { id: true, invoiceNumber: true, status: true, totalAmount: true, amountPaid: true, balanceDue: true },
      });
      if (!invoice) throw new Error("The credited invoice could not be found.");
      if (["DRAFT", "VOIDED", "WRITTEN_OFF"].includes(invoice.status)) {
        throw new Error(`Credit note cannot be reversed while invoice ${invoice.invoiceNumber} is ${invoice.status}.`);
      }

      const customerCreditAmount = roundMoney(Number(credit.customerCreditAmount ?? 0));
      if (customerCreditAmount > 0.005) {
        const customerCredits = await tx.$queryRaw<Array<{
          id: string;
          originalAmount: unknown;
          remainingAmount: unknown;
          status: string;
        }>>`
          SELECT "id", "original_amount" AS "originalAmount", "remaining_amount" AS "remainingAmount", "status"
          FROM "customer_credits"
          WHERE "tenant_id" = ${tenantId}::uuid AND "credit_note_id" = ${credit.id}
          LIMIT 1
        `;
        const customerCredit = customerCredits[0];
        if (!customerCredit) throw new Error("Customer-credit liability evidence is missing for this credit note.");
        if (customerCredit.status !== "OPEN" || Math.abs(Number(customerCredit.remainingAmount) - Number(customerCredit.originalAmount)) > 0.01) {
          throw new Error("This credit note cannot be reversed because its customer credit has already been used or refunded.");
        }
      }

      const journal = await tx.journalEntry.findFirst({
        where: { id: credit.journalEntryId, tenantId, source: "credit_note", sourceId: credit.id, isLocked: true },
        include: { lines: true },
      });
      if (!journal) throw new Error("The original credit-note journal could not be found.");

      const duplicate = await tx.journalEntry.findFirst({
        where: { tenantId, source: "credit_note_reversal", sourceId: credit.id },
        select: { id: true },
      });
      if (duplicate) throw new Error("A reversal journal already exists for this credit note.");

      const reversalLines: JournalPostingLine[] = journal.lines.map((line) => ({
        accountId: line.accountId,
        description: `Reverse - ${line.description ?? credit.creditNumber}`,
        debit: Number(line.credit),
        credit: Number(line.debit),
        projectId: line.projectId ?? null,
        reportingTags: normaliseReportingTags(line.reportingTags),
      }));

      const reversalJournalId = await postJournalEntryInTransaction(tx, {
        tenantId,
        createdBy: userId,
        entryDate: reversalDate,
        reference: `REV-${credit.creditNumber}`,
        description: `Reverse credit note ${credit.creditNumber}: ${reason}`,
        recognitionPeriod: getRecognitionPeriod(reversalDate),
        source: "credit_note_reversal",
        sourceId: credit.id,
        lines: reversalLines,
      });

      const arAppliedAmount = roundMoney(Number(credit.arAppliedAmount ?? 0));
      const currentBalance = roundMoney(Number(invoice.balanceDue));
      const amountPaid = roundMoney(Number(invoice.amountPaid));
      const maximumOpenBalance = Math.max(0, roundMoney(Number(invoice.totalAmount) - amountPaid));
      const newBalance = Math.min(maximumOpenBalance, roundMoney(currentBalance + arAppliedAmount));
      const newStatus = newBalance > 0.01
        ? (amountPaid > 0.01 ? "PARTIAL" : "SENT")
        : invoice.status;

      await tx.invoice.update({
        where: { id: invoice.id },
        data: { balanceDue: newBalance, status: newStatus, paidAt: newBalance > 0.01 ? null : undefined },
      });

      if (customerCreditAmount > 0.005) {
        await tx.$executeRaw`
          UPDATE "customer_credits"
          SET "remaining_amount" = 0, "status" = 'REVERSED', "updated_at" = now()
          WHERE "tenant_id" = ${tenantId}::uuid AND "credit_note_id" = ${credit.id}
        `;
      }

      const updated = await tx.$executeRaw`
        UPDATE "credit_notes"
        SET "status" = 'REVERSED'::"CreditNoteStatus",
            "reversal_journal_entry_id" = ${reversalJournalId},
            "reversed_at" = ${reversalDate},
            "reversed_by" = ${userId},
            "reversal_reason" = ${reason}
        WHERE "id" = ${credit.id}
          AND "tenant_id" = ${tenantId}::uuid
          AND "status" = 'APPLIED'::"CreditNoteStatus"
      `;
      if (updated !== 1) throw new Error("Credit note status changed before reversal could complete.");
    });

    revalidatePath("/sales/credit-notes");
    revalidatePath("/sales/invoices");
    if (invoiceId) revalidatePath(`/sales/invoices/${invoiceId}`);
    revalidatePath("/accounting/profit-loss");
    revalidatePath("/accounting/balance-sheet");
    return { success: true };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Credit note could not be reversed." };
  }
}
