"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { postJournalEntryInTransaction, type JournalPostingLine } from "@/lib/journal";
import { getRecognitionPeriod } from "@/lib/utils";
import { generateTransactionNumber } from "@/lib/customization/service";

function normaliseTags(value: Prisma.JsonValue | null): Record<string, string> | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const pairs = Object.entries(value)
    .filter(([, optionId]) => typeof optionId === "string" && optionId.length > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  return pairs.length ? Object.fromEntries(pairs) as Record<string, string> : null;
}

export async function voidInvoiceSafely(id: string, reason: string, convertToDraft: boolean) {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  const userId = session?.user?.id;
  if (!tenantId || !userId) return { error: "Unauthorized" };
  if (!reason.trim()) return { error: "Please provide a void reason" };

  const invoice = await prisma.invoice.findFirst({
    where: { id, tenantId },
    include: { lines: true },
  });
  if (!invoice) return { error: "Invoice not found" };
  if (invoice.status === "VOIDED") return { error: "Invoice already voided" };
  if (invoice.status === "PAID") {
    return { error: "Cannot void a fully paid invoice. Reverse or refund the payment first." };
  }
  if (invoice.status === "WRITTEN_OFF") return { error: "Cannot void a written-off invoice." };
  if (Number(invoice.amountPaid) > 0) {
    return { error: "This invoice has payments recorded. Reverse or refund the payment before voiding it." };
  }

  const appliedCreditNotes = await prisma.$queryRaw<Array<{ count: unknown }>>`
    SELECT COUNT(*) AS "count"
    FROM "credit_notes"
    WHERE "tenant_id" = ${tenantId}::uuid
      AND "invoice_id" = ${id}
      AND "status" = 'APPLIED'::"CreditNoteStatus"
  `;
  if (Number(appliedCreditNotes[0]?.count ?? 0) > 0) {
    return { error: "This invoice has an applied credit note. Reverse the credit note before voiding the invoice." };
  }

  const recognisedFromThisInvoice = await prisma.$queryRaw<Array<{ amount: unknown }>>`
    SELECT COALESCE(SUM(rria."amount"), 0) AS "amount"
    FROM "invoice_line_revenue_allocations" ila
    INNER JOIN "revenue_recognition_invoice_allocations" rria
      ON rria."invoice_line_allocation_id" = ila."id"
    INNER JOIN "project_revenue_recognitions" prr
      ON prr."id" = rria."recognition_id"
    WHERE ila."tenant_id" = ${tenantId}::uuid
      AND ila."invoice_id" = ${id}
      AND rria."allocation_type" = 'UNEARNED_RELEASE'
      AND prr."status" = 'POSTED'
  `;
  if (Number(recognisedFromThisInvoice[0]?.amount ?? 0) > 0.005) {
    return {
      error:
        "This invoice has Project revenue that was recognised after billing. " +
        "Reverse those Project revenue recognition entries before voiding the invoice.",
    };
  }

  const voidedAt = new Date();
  const fxNote = Number(invoice.exchangeRate) !== 1
    ? ` (${invoice.currency} @ ${invoice.exchangeRate})`
    : "";

  if (invoice.status === "DRAFT") {
    try {
      await prisma.invoice.updateMany({
        where: { id, tenantId, status: "DRAFT" },
        data: { status: "VOIDED", voidedAt, voidedReason: reason.trim() },
      });
    } catch (error: unknown) {
      return { error: error instanceof Error ? error.message : "Failed to void invoice" };
    }
  } else {
    const originalJournal = await prisma.journalEntry.findFirst({
      where: { tenantId, source: "invoice", sourceId: id },
      include: { lines: true },
    });
    if (!originalJournal) {
      return {
        error:
          "Cannot void this invoice because its original accounting entry was not found. " +
          "Review the posting history before continuing.",
      };
    }

    const existingReversal = await prisma.journalEntry.findFirst({
      where: { tenantId, source: "invoice_void", sourceId: id },
      select: { id: true },
    });
    if (existingReversal) return { error: "A void reversal already exists for this invoice." };

    const reversalLines: JournalPostingLine[] = originalJournal.lines.map((line) => ({
      accountId: line.accountId,
      description: `Void - ${line.description ?? invoice.invoiceNumber}`,
      debit: Number(line.credit),
      credit: Number(line.debit),
      projectId: line.projectId ?? null,
      reportingTags: normaliseTags(line.reportingTags),
    }));

    try {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:invoice:${tenantId}:${id}`}))`;

        const live = await tx.invoice.findFirst({
          where: { id, tenantId },
          select: { status: true, amountPaid: true },
        });
        if (!live || live.status !== invoice.status) {
          throw new Error("Invoice status changed before voiding could complete.");
        }
        if (Number(live.amountPaid) > 0) {
          throw new Error("A payment was applied before voiding could complete. Reverse it first.");
        }

        const liveCreditNotes = await tx.$queryRaw<Array<{ count: unknown }>>`
          SELECT COUNT(*) AS "count"
          FROM "credit_notes"
          WHERE "tenant_id" = ${tenantId}::uuid
            AND "invoice_id" = ${id}
            AND "status" = 'APPLIED'::"CreditNoteStatus"
        `;
        if (Number(liveCreditNotes[0]?.count ?? 0) > 0) {
          throw new Error("A credit note was applied before voiding could complete. Reverse it first.");
        }

        const projectRows = await tx.$queryRaw<Array<{ projectId: string }>>`
          SELECT DISTINCT "project_id" AS "projectId"
          FROM "invoice_line_revenue_allocations"
          WHERE "tenant_id" = ${tenantId}::uuid
            AND "invoice_id" = ${id}
            AND "project_id" IS NOT NULL
          ORDER BY "project_id"
        `;
        for (const row of projectRows) {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:project-revenue:${tenantId}:${row.projectId}`}))`;
        }

        const activeRecognition = await tx.$queryRaw<Array<{ amount: unknown }>>`
          SELECT COALESCE(SUM(rria."amount"), 0) AS "amount"
          FROM "invoice_line_revenue_allocations" ila
          INNER JOIN "revenue_recognition_invoice_allocations" rria
            ON rria."invoice_line_allocation_id" = ila."id"
          INNER JOIN "project_revenue_recognitions" prr
            ON prr."id" = rria."recognition_id"
          WHERE ila."tenant_id" = ${tenantId}::uuid
            AND ila."invoice_id" = ${id}
            AND rria."allocation_type" = 'UNEARNED_RELEASE'
            AND prr."status" = 'POSTED'
        `;
        if (Number(activeRecognition[0]?.amount ?? 0) > 0.005) {
          throw new Error("Project revenue was recognised from this invoice before voiding could complete. Reverse it first.");
        }

        const duplicate = await tx.journalEntry.findFirst({
          where: { tenantId, source: "invoice_void", sourceId: id },
          select: { id: true },
        });
        if (duplicate) throw new Error("A void reversal already exists for this invoice.");

        await postJournalEntryInTransaction(tx, {
          tenantId,
          createdBy: userId,
          entryDate: voidedAt,
          reference: `VOID-${invoice.invoiceNumber}`,
          description: `Void ${invoice.invoiceNumber}: ${reason.trim()}${fxNote}`,
          recognitionPeriod: getRecognitionPeriod(voidedAt),
          source: "invoice_void",
          sourceId: id,
          lines: reversalLines,
        });

        const updated = await tx.invoice.updateMany({
          where: { id, tenantId, status: invoice.status },
          data: { status: "VOIDED", voidedAt, voidedReason: reason.trim() },
        });
        if (updated.count !== 1) {
          throw new Error("Invoice changed before voiding could complete. Transaction rolled back.");
        }
      });
    } catch (error: unknown) {
      return {
        error: error instanceof Error
          ? error.message
          : "Failed to void invoice. The invoice and ledger were not changed.",
      };
    }
  }

  let newInvoiceId: string | undefined;
  if (convertToDraft) {
    try {
      const newNumber = await generateTransactionNumber(tenantId, "INVOICE");
      const newInvoice = await prisma.invoice.create({
        data: {
          tenantId,
          customerId: invoice.customerId,
          invoiceNumber: newNumber,
          reference: invoice.reference,
          orderNumber: invoice.orderNumber,
          issueDate: invoice.issueDate,
          dueDate: invoice.dueDate,
          status: "DRAFT",
          currency: invoice.currency,
          exchangeRate: invoice.exchangeRate,
          subtotal: invoice.subtotal,
          discountAmount: invoice.discountAmount,
          taxAmount: invoice.taxAmount,
          totalAmount: invoice.totalAmount,
          amountPaid: 0,
          balanceDue: invoice.totalAmount,
          recognitionPeriod: invoice.recognitionPeriod,
          paymentTermsDays: invoice.paymentTermsDays,
          recogniseRevenueOnInvoiceDate: invoice.recogniseRevenueOnInvoiceDate,
          notes: invoice.notes,
          lines: {
            create: invoice.lines.map((line) => ({
              itemId: line.itemId,
              description: line.description,
              quantity: line.quantity,
              rate: line.rate,
              amount: line.amount,
              taxRateId: line.taxRateId,
              taxName: line.taxName,
              taxRate: line.taxRate,
              taxAmount: line.taxAmount,
              discountType: line.discountType,
              discountValue: line.discountValue,
              discountAmount: line.discountAmount,
              lineTotal: line.lineTotal,
              incomeAccountId: line.incomeAccountId,
              projectId: line.projectId,
              reportingTags: line.reportingTags ?? undefined,
            })),
          },
        },
        select: { id: true },
      });
      newInvoiceId = newInvoice.id;
    } catch (error: unknown) {
      revalidatePath(`/sales/invoices/${id}`);
      revalidatePath("/sales/invoices");
      return {
        success: true,
        newInvoiceId: undefined,
        warning:
          `Invoice voided successfully, but the replacement draft could not be created: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  revalidatePath(`/sales/invoices/${id}`);
  revalidatePath("/sales/invoices");
  return { success: true, newInvoiceId };
}
