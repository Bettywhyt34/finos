"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertPeriodOpenInTransaction, postJournalEntryInTransaction, type JournalPostingLine } from "@/lib/journal";
import { getRecognitionPeriod } from "@/lib/utils";

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normaliseReportingTags(value: Prisma.JsonValue | null): Record<string, string> | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const entries = Object.entries(value)
    .filter(([, optionId]) => typeof optionId === "string" && optionId.length > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  return entries.length ? Object.fromEntries(entries) as Record<string, string> : null;
}

export async function reverseVendorPayment(input: {
  paymentId: string;
  reason: string;
  reversalDate: string;
}) {
  try {
    const session = await auth();
    const tenantId = session?.user?.tenantId;
    const userId = session?.user?.id;
    const role = session?.user?.role;
    if (!tenantId || !userId) return { error: "Unauthorized" };
    if (!role || !["OWNER", "ADMIN", "ACCOUNTANT"].includes(role)) {
      return { error: "You do not have permission to reverse vendor payments." };
    }

    const reason = input.reason.trim();
    if (!reason) return { error: "Enter a reversal reason." };
    if (reason.length > 2000) return { error: "Reversal reason is too long." };
    const reversalDate = new Date(`${input.reversalDate}T00:00:00`);
    if (Number.isNaN(reversalDate.getTime()) || reversalDate > new Date()) {
      return { error: "Enter a valid reversal date." };
    }

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:vendor-payment:${tenantId}:${input.paymentId}`}))`;

      const payments = await tx.$queryRaw<Array<{
        id: string;
        paymentNumber: string;
        paymentDate: Date;
        createdAt: Date;
        status: string;
      }>>`
        SELECT "id", "payment_number" AS "paymentNumber", "payment_date" AS "paymentDate",
               "created_at" AS "createdAt", "status"
        FROM "vendor_payments"
        WHERE "id"=${input.paymentId} AND "tenant_id"=${tenantId}::uuid
        LIMIT 1
      `;
      const payment = payments[0];
      if (!payment) throw new Error("Vendor payment not found.");
      if (payment.status !== "POSTED") throw new Error("This vendor payment has already been reversed.");

      const allocations = await tx.$queryRaw<Array<{ billId: string; amount: unknown }>>`
        SELECT "bill_id" AS "billId", "amount"
        FROM "vendor_payment_allocations"
        WHERE "payment_id"=${payment.id} AND "tenant_id"=${tenantId}::uuid
        ORDER BY "bill_id"
      `;
      if (!allocations.length) throw new Error("Vendor payment allocation evidence is missing.");

      const billIds = allocations.map((allocation) => allocation.billId);
      for (const billId of [...new Set(billIds)].sort()) {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:bill:${tenantId}:${billId}`}))`;
      }

      const laterPayment = await tx.$queryRaw<Array<{ paymentNumber: string }>>`
        SELECT vp."payment_number" AS "paymentNumber"
        FROM "vendor_payment_allocations" current_alloc
        JOIN "vendor_payment_allocations" later_alloc ON later_alloc."bill_id"=current_alloc."bill_id"
        JOIN "vendor_payments" vp ON vp."id"=later_alloc."payment_id"
        WHERE current_alloc."payment_id"=${payment.id}
          AND current_alloc."tenant_id"=${tenantId}::uuid
          AND vp."tenant_id"=${tenantId}::uuid
          AND vp."status"='POSTED'
          AND vp."id"<>${payment.id}
          AND (vp."payment_date">${payment.paymentDate}
               OR (vp."payment_date"=${payment.paymentDate} AND vp."created_at">${payment.createdAt}))
        ORDER BY vp."payment_date" DESC, vp."created_at" DESC
        LIMIT 1
      `;
      if (laterPayment[0]) {
        throw new Error(`Reverse later vendor payment ${laterPayment[0].paymentNumber} first.`);
      }

      const originalJournal = await tx.journalEntry.findFirst({
        where: {
          tenantId,
          source: "vendor_payment",
          sourceId: payment.id,
          isLocked: true,
        },
        include: { lines: true },
      });
      if (!originalJournal || !originalJournal.lines.length) {
        throw new Error("Original vendor-payment journal evidence is missing.");
      }

      const duplicate = await tx.journalEntry.findFirst({
        where: { tenantId, source: "vendor_payment_reversal", sourceId: payment.id },
        select: { id: true },
      });
      if (duplicate) throw new Error("A reversal journal already exists for this vendor payment.");

      const reversalPeriod = getRecognitionPeriod(reversalDate);
      await assertPeriodOpenInTransaction(tx, tenantId, reversalPeriod);

      const reversalLines: JournalPostingLine[] = originalJournal.lines.map((line) => ({
        accountId: line.accountId,
        description: `Reverse - ${line.description ?? payment.paymentNumber}`,
        debit: Number(line.credit),
        credit: Number(line.debit),
        projectId: line.projectId ?? null,
        reportingTags: normaliseReportingTags(line.reportingTags),
      }));

      const reversalJournalId = await postJournalEntryInTransaction(tx, {
        tenantId,
        createdBy: userId,
        entryDate: reversalDate,
        reference: `REV-${payment.paymentNumber}`,
        description: `Reverse vendor payment ${payment.paymentNumber}: ${reason}`,
        recognitionPeriod: reversalPeriod,
        source: "vendor_payment_reversal",
        sourceId: payment.id,
        lines: reversalLines,
      });

      for (const allocation of allocations) {
        const bill = await tx.bill.findFirst({
          where: { id: allocation.billId, tenantId },
          select: { id: true, billNumber: true, amountPaid: true, dueDate: true },
        });
        if (!bill) throw new Error("An allocated bill could not be found.");
        const restoredPaid = roundMoney(Number(bill.amountPaid) - Number(allocation.amount));
        if (restoredPaid < -0.01) {
          throw new Error(`Reversal would make bill ${bill.billNumber} settlement negative.`);
        }
        const amountPaid = Math.max(0, restoredPaid);
        const status = amountPaid > 0.01
          ? "PARTIAL"
          : (bill.dueDate < reversalDate ? "OVERDUE" : "RECORDED");
        await tx.bill.update({ where: { id: bill.id }, data: { amountPaid, status } });
      }

      const updated = await tx.$executeRaw`
        UPDATE "vendor_payments"
        SET "status"='REVERSED',
            "reversal_journal_entry_id"=${reversalJournalId},
            "reversed_at"=${reversalDate},
            "reversed_by"=${userId},
            "reversal_reason"=${reason}
        WHERE "id"=${payment.id}
          AND "tenant_id"=${tenantId}::uuid
          AND "status"='POSTED'
      `;
      if (updated !== 1) throw new Error("Vendor payment status changed before reversal could complete.");
    });

    revalidatePath("/purchases/bills");
    revalidatePath("/purchases/payments");
    revalidatePath("/accounting/fx-revaluation");
    revalidatePath("/accounting/balance-sheet");
    return { success: true as const };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Vendor payment could not be reversed." };
  }
}
