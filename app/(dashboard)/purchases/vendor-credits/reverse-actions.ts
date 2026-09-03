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

async function actor() {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  const userId = session?.user?.id;
  const role = session?.user?.role;
  if (!tenantId || !userId) throw new Error("Your session has expired. Please sign in again.");
  if (!role || !["OWNER", "ADMIN", "ACCOUNTANT"].includes(role)) {
    throw new Error("You do not have permission to reverse vendor-credit movements.");
  }
  return { tenantId, userId };
}

function parseReversal(reasonInput: string, dateInput: string, movementDate: Date) {
  const reason = reasonInput.trim();
  if (!reason) throw new Error("Enter a reversal reason.");
  if (reason.length > 2000) throw new Error("Reversal reason is too long.");
  const reversalDate = new Date(`${dateInput}T00:00:00`);
  if (Number.isNaN(reversalDate.getTime()) || reversalDate > new Date()) throw new Error("Enter a valid reversal date.");
  if (reversalDate < new Date(movementDate)) throw new Error("Reversal date cannot be before the original movement date.");
  return { reason, reversalDate };
}

async function assertNoLaterCreditMovement(
  tx: Prisma.TransactionClient,
  tenantId: string,
  creditId: string,
  movementDate: Date,
  movementCreatedAt: Date,
  currentKind: "APPLICATION" | "REFUND",
  currentId: string,
) {
  const rows = await tx.$queryRaw<Array<{ kind: string; reference: string }>>`
    SELECT x."kind", x."reference"
    FROM (
      SELECT 'APPLICATION'::text AS "kind", vca."id" AS "id", vca."application_date" AS "movementDate",
             vca."created_at" AS "createdAt", vca."id" AS "reference"
      FROM "vendor_credit_applications" vca
      WHERE vca."tenant_id"=${tenantId}::uuid AND vca."vendor_credit_id"=${creditId}
        AND vca."application_type"='LATER' AND vca."status"='POSTED'
      UNION ALL
      SELECT 'REFUND'::text, vcr."id", vcr."refunded_at", vcr."created_at",
             COALESCE(vcr."reference",vcr."id")
      FROM "vendor_credit_refunds" vcr
      WHERE vcr."tenant_id"=${tenantId}::uuid AND vcr."vendor_credit_id"=${creditId}
        AND vcr."status"='POSTED'
    ) x
    WHERE NOT (x."kind"=${currentKind} AND x."id"=${currentId})
      AND (x."movementDate">${movementDate}
           OR (x."movementDate"=${movementDate} AND x."createdAt">${movementCreatedAt}))
    ORDER BY x."movementDate" DESC, x."createdAt" DESC
    LIMIT 1
  `;
  if (rows[0]) throw new Error(`Reverse the later vendor-credit ${rows[0].kind.toLowerCase()} first.`);
}

async function assertNoLaterCreditRevaluation(
  tx: Prisma.TransactionClient,
  tenantId: string,
  creditId: string,
  movementDate: Date,
) {
  const rows = await tx.$queryRaw<Array<{ period: string }>>`
    SELECT fr."period"
    FROM "fx_revaluation_items" fri
    INNER JOIN "fx_revaluations" fr ON fr."id"=fri."fx_revaluation_id"
    WHERE fri."tenant_id"=${tenantId}::uuid
      AND fri."item_type"='VENDOR_CREDIT'
      AND fri."vendor_credit_id"=${creditId}
      AND fr."status"='POSTED'::fx_revaluation_status
      AND fr."revaluation_date">${movementDate}
    ORDER BY fr."revaluation_date" DESC
    LIMIT 1
  `;
  if (rows[0]) throw new Error(`A later FX revaluation (${rows[0].period}) depends on this Vendor Credit. Reverse that revaluation first.`);
}

async function assertNoLaterApRevaluation(
  tx: Prisma.TransactionClient,
  tenantId: string,
  billId: string,
  movementDate: Date,
) {
  const rows = await tx.$queryRaw<Array<{ period: string }>>`
    SELECT fr."period"
    FROM "fx_revaluation_items" fri
    INNER JOIN "fx_revaluations" fr ON fr."id"=fri."fx_revaluation_id"
    WHERE fri."tenant_id"=${tenantId}::uuid
      AND fri."item_type"='AP'
      AND fri."bill_id"=${billId}
      AND fr."status"='POSTED'::fx_revaluation_status
      AND fr."revaluation_date">${movementDate}
    ORDER BY fr."revaluation_date" DESC
    LIMIT 1
  `;
  if (rows[0]) throw new Error(`A later AP FX revaluation (${rows[0].period}) depends on this application. Reverse that revaluation first.`);
}

async function inverseJournal(
  tx: Prisma.TransactionClient,
  tenantId: string,
  userId: string,
  sourceJournalId: string,
  expectedSource: string,
  sourceId: string,
  reversalSource: string,
  reversalDate: Date,
  reason: string,
  reference: string,
  description: string,
) {
  const journal = await tx.journalEntry.findFirst({
    where: { id: sourceJournalId, tenantId, source: expectedSource, sourceId, isLocked: true },
    include: { lines: true },
  });
  if (!journal || !journal.lines.length) throw new Error("Original movement journal evidence is missing.");
  const duplicate = await tx.journalEntry.findFirst({ where: { tenantId, source: reversalSource, sourceId }, select: { id: true } });
  if (duplicate) throw new Error("A reversal journal already exists for this movement.");
  const period = getRecognitionPeriod(reversalDate);
  await assertPeriodOpenInTransaction(tx, tenantId, period);
  const lines: JournalPostingLine[] = journal.lines.map((line) => ({
    accountId: line.accountId,
    description: `Reverse - ${line.description ?? reference}`,
    debit: Number(line.credit),
    credit: Number(line.debit),
    projectId: line.projectId ?? null,
    reportingTags: normaliseReportingTags(line.reportingTags),
  }));
  return postJournalEntryInTransaction(tx, {
    tenantId,
    createdBy: userId,
    entryDate: reversalDate,
    reference,
    description: `${description}: ${reason}`,
    recognitionPeriod: period,
    source: reversalSource,
    sourceId,
    lines,
  });
}

export async function reverseVendorCreditApplication(input: { applicationId: string; reason: string; reversalDate: string }) {
  try {
    const { tenantId, userId } = await actor();
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{
        id: string; vendorCreditId: string; billId: string; amount: unknown; status: string;
        journalEntryId: string; applicationDate: Date; createdAt: Date;
      }>>`
        SELECT "id","vendor_credit_id" AS "vendorCreditId","bill_id" AS "billId","amount","status",
               "journal_entry_id" AS "journalEntryId","application_date" AS "applicationDate","created_at" AS "createdAt"
        FROM "vendor_credit_applications"
        WHERE "id"=${input.applicationId} AND "tenant_id"=${tenantId}::uuid AND "application_type"='LATER'
        LIMIT 1
      `;
      const application = rows[0];
      if (!application) throw new Error("Vendor-credit application not found.");
      if (application.status !== "POSTED") throw new Error("This vendor-credit application has already been reversed.");
      const { reason, reversalDate } = parseReversal(input.reason, input.reversalDate, application.applicationDate);

      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:vendor-credit:${tenantId}:${application.vendorCreditId}`}))`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:bill:${tenantId}:${application.billId}`}))`;
      await assertNoLaterCreditMovement(tx, tenantId, application.vendorCreditId, application.applicationDate, application.createdAt, "APPLICATION", application.id);
      await assertNoLaterCreditRevaluation(tx, tenantId, application.vendorCreditId, application.applicationDate);
      await assertNoLaterApRevaluation(tx, tenantId, application.billId, application.applicationDate);

      const creditRows = await tx.$queryRaw<Array<{ appliedAmount: unknown; remainingAmount: unknown; totalAmount: unknown }>>`
        SELECT "applied_amount" AS "appliedAmount","remaining_amount" AS "remainingAmount","total_amount" AS "totalAmount"
        FROM "vendor_credits" WHERE "id"=${application.vendorCreditId} AND "tenant_id"=${tenantId}::uuid LIMIT 1
      `;
      const credit = creditRows[0];
      if (!credit) throw new Error("Vendor-credit balance evidence is missing.");
      const bill = await tx.bill.findFirst({
        where: { id: application.billId, tenantId },
        select: { id: true, billNumber: true, totalAmount: true, amountPaid: true, amountCredited: true, dueDate: true },
      });
      if (!bill) throw new Error("Target Bill not found.");

      const reversalJournalId = await inverseJournal(
        tx, tenantId, userId, application.journalEntryId, "vendor_credit_application", application.id,
        "vendor_credit_application_reversal", reversalDate, reason,
        `REV-VCAPP-${application.id.slice(0, 8).toUpperCase()}`,
        `Reverse vendor-credit application to ${bill.billNumber}`,
      );

      const updated = await tx.$executeRaw`
        UPDATE "vendor_credit_applications"
        SET "status"='REVERSED',"reversal_journal_entry_id"=${reversalJournalId},"reversed_at"=${reversalDate},
            "reversed_by"=${userId},"reversal_reason"=${reason}
        WHERE "id"=${application.id} AND "tenant_id"=${tenantId}::uuid AND "status"='POSTED'
      `;
      if (updated !== 1) throw new Error("Vendor-credit application status changed before reversal could complete.");

      const amount = roundMoney(Number(application.amount));
      const restoredRemaining = roundMoney(Number(credit.remainingAmount) + amount);
      const restoredApplied = roundMoney(Number(credit.appliedAmount) - amount);
      if (restoredApplied < -0.01 || restoredRemaining - Number(credit.totalAmount) > 0.01) throw new Error("Reversal would corrupt the Vendor Credit balance.");
      await tx.$executeRaw`
        UPDATE "vendor_credits"
        SET "applied_amount"=${Math.max(0, restoredApplied)},"remaining_amount"=${restoredRemaining},"status"='OPEN'
        WHERE "id"=${application.vendorCreditId} AND "tenant_id"=${tenantId}::uuid
      `;

      const restoredCredited = roundMoney(Number(bill.amountCredited) - amount);
      if (restoredCredited < -0.01) throw new Error(`Reversal would make ${bill.billNumber}'s credited amount negative.`);
      const amountCredited = Math.max(0, restoredCredited);
      const outstanding = Math.max(0, roundMoney(Number(bill.totalAmount) - Number(bill.amountPaid) - amountCredited));
      const status = outstanding <= 0.01
        ? (Number(bill.amountPaid) >= Number(bill.totalAmount) - 0.01 ? "PAID" : "SETTLED")
        : bill.dueDate < reversalDate
          ? "OVERDUE"
          : (Number(bill.amountPaid) > 0.01 || amountCredited > 0.01 ? "PARTIAL" : "RECORDED");
      await tx.bill.update({ where: { id: bill.id }, data: { amountCredited, status } });
    });

    revalidatePath("/purchases/vendor-credits");
    revalidatePath("/purchases/bills");
    revalidatePath("/accounting/balance-sheet");
    revalidatePath("/accounting/fx-revaluation");
    return { success: true as const };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Vendor-credit application could not be reversed." };
  }
}

export async function reverseVendorCreditRefund(input: { refundId: string; reason: string; reversalDate: string }) {
  try {
    const { tenantId, userId } = await actor();
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{
        id: string; vendorCreditId: string; amount: unknown; status: string; journalEntryId: string;
        refundedAt: Date; createdAt: Date;
      }>>`
        SELECT "id","vendor_credit_id" AS "vendorCreditId","amount","status","journal_entry_id" AS "journalEntryId",
               "refunded_at" AS "refundedAt","created_at" AS "createdAt"
        FROM "vendor_credit_refunds"
        WHERE "id"=${input.refundId} AND "tenant_id"=${tenantId}::uuid LIMIT 1
      `;
      const refund = rows[0];
      if (!refund) throw new Error("Vendor-credit refund not found.");
      if (refund.status !== "POSTED") throw new Error("This vendor-credit refund has already been reversed.");
      const { reason, reversalDate } = parseReversal(input.reason, input.reversalDate, refund.refundedAt);

      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:vendor-credit:${tenantId}:${refund.vendorCreditId}`}))`;
      await assertNoLaterCreditMovement(tx, tenantId, refund.vendorCreditId, refund.refundedAt, refund.createdAt, "REFUND", refund.id);
      await assertNoLaterCreditRevaluation(tx, tenantId, refund.vendorCreditId, refund.refundedAt);

      const creditRows = await tx.$queryRaw<Array<{ refundedAmount: unknown; remainingAmount: unknown; totalAmount: unknown }>>`
        SELECT "refunded_amount" AS "refundedAmount","remaining_amount" AS "remainingAmount","total_amount" AS "totalAmount"
        FROM "vendor_credits" WHERE "id"=${refund.vendorCreditId} AND "tenant_id"=${tenantId}::uuid LIMIT 1
      `;
      const credit = creditRows[0];
      if (!credit) throw new Error("Vendor-credit balance evidence is missing.");

      const reversalJournalId = await inverseJournal(
        tx, tenantId, userId, refund.journalEntryId, "vendor_credit_refund", refund.id,
        "vendor_credit_refund_reversal", reversalDate, reason,
        `REV-VCREF-${refund.id.slice(0, 8).toUpperCase()}`,
        "Reverse supplier refund of Vendor Credit",
      );

      const updated = await tx.$executeRaw`
        UPDATE "vendor_credit_refunds"
        SET "status"='REVERSED',"reversal_journal_entry_id"=${reversalJournalId},"reversed_at"=${reversalDate},
            "reversed_by"=${userId},"reversal_reason"=${reason}
        WHERE "id"=${refund.id} AND "tenant_id"=${tenantId}::uuid AND "status"='POSTED'
      `;
      if (updated !== 1) throw new Error("Vendor-credit refund status changed before reversal could complete.");

      const amount = roundMoney(Number(refund.amount));
      const restoredRemaining = roundMoney(Number(credit.remainingAmount) + amount);
      const restoredRefunded = roundMoney(Number(credit.refundedAmount) - amount);
      if (restoredRefunded < -0.01 || restoredRemaining - Number(credit.totalAmount) > 0.01) throw new Error("Reversal would corrupt the Vendor Credit balance.");
      await tx.$executeRaw`
        UPDATE "vendor_credits"
        SET "refunded_amount"=${Math.max(0, restoredRefunded)},"remaining_amount"=${restoredRemaining},"status"='OPEN'
        WHERE "id"=${refund.vendorCreditId} AND "tenant_id"=${tenantId}::uuid
      `;
    });

    revalidatePath("/purchases/vendor-credits");
    revalidatePath("/banking");
    revalidatePath("/accounting/balance-sheet");
    revalidatePath("/accounting/fx-revaluation");
    return { success: true as const };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Vendor-credit refund could not be reversed." };
  }
}
