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

export async function reverseSourceVendorCredit(input: { vendorCreditId: string; reason: string; reversalDate: string }) {
  try {
    const session = await auth();
    const tenantId = session?.user?.tenantId;
    const userId = session?.user?.id;
    const role = session?.user?.role;
    if (!tenantId || !userId) return { error: "Unauthorized" };
    if (!role || !["OWNER", "ADMIN", "ACCOUNTANT"].includes(role)) return { error: "You do not have permission to reverse Vendor Credits." };

    const reason = input.reason.trim();
    if (!reason) return { error: "Enter a reversal reason." };
    if (reason.length > 2000) return { error: "Reversal reason is too long." };
    const reversalDate = new Date(`${input.reversalDate}T00:00:00`);
    if (Number.isNaN(reversalDate.getTime()) || reversalDate > new Date()) return { error: "Enter a valid reversal date." };

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:vendor-credit:${tenantId}:${input.vendorCreditId}`}))`;

      const rows = await tx.$queryRaw<Array<{
        id: string;
        creditNumber: string;
        creditDate: Date;
        sourceBillId: string;
        status: string;
        journalEntryId: string;
      }>>`
        SELECT "id","credit_number" AS "creditNumber","credit_date" AS "creditDate",
               "source_bill_id" AS "sourceBillId","status","journal_entry_id" AS "journalEntryId"
        FROM "vendor_credits"
        WHERE "id"=${input.vendorCreditId} AND "tenant_id"=${tenantId}::uuid
        LIMIT 1
      `;
      const credit = rows[0];
      if (!credit) throw new Error("Vendor Credit not found.");
      if (credit.status === "REVERSED") throw new Error("This Vendor Credit has already been reversed.");
      if (reversalDate < new Date(credit.creditDate)) throw new Error("Reversal date cannot be before the Vendor Credit date.");

      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:bill:${tenantId}:${credit.sourceBillId}`}))`;

      const laterMovements = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT (
          (SELECT COUNT(*) FROM "vendor_credit_applications" vca
           WHERE vca."tenant_id"=${tenantId}::uuid AND vca."vendor_credit_id"=${credit.id}
             AND vca."application_type"='LATER' AND vca."status"='POSTED')
          +
          (SELECT COUNT(*) FROM "vendor_credit_refunds" vcr
           WHERE vcr."tenant_id"=${tenantId}::uuid AND vcr."vendor_credit_id"=${credit.id} AND vcr."status"='POSTED')
        )::bigint AS "count"
      `;
      if (Number(laterMovements[0]?.count ?? 0) > 0) throw new Error("Reverse all later Vendor Credit applications and supplier refunds first.");

      const vendorCreditReval = await tx.$queryRaw<Array<{ period: string }>>`
        SELECT fr."period"
        FROM "fx_revaluation_items" fri
        JOIN "fx_revaluations" fr ON fr."id"=fri."fx_revaluation_id"
        WHERE fri."tenant_id"=${tenantId}::uuid AND fri."item_type"='VENDOR_CREDIT'
          AND fri."vendor_credit_id"=${credit.id} AND fr."status"='POSTED'::fx_revaluation_status
        ORDER BY fr."revaluation_date" DESC LIMIT 1
      `;
      if (vendorCreditReval[0]) throw new Error(`Reverse the posted Vendor Credit FX revaluation (${vendorCreditReval[0].period}) first.`);

      const sourceApplications = await tx.$queryRaw<Array<{ id: string; amount: unknown; status: string }>>`
        SELECT "id","amount","status"
        FROM "vendor_credit_applications"
        WHERE "tenant_id"=${tenantId}::uuid AND "vendor_credit_id"=${credit.id} AND "application_type"='SOURCE'
        LIMIT 1
      `;
      const sourceApplication = sourceApplications[0];
      if (sourceApplication && sourceApplication.status !== "POSTED") throw new Error("Source Vendor Credit application evidence is inconsistent.");
      const sourceAppliedAmount = sourceApplication ? roundMoney(Number(sourceApplication.amount)) : 0;

      if (sourceAppliedAmount > 0.005) {
        const laterApReval = await tx.$queryRaw<Array<{ period: string }>>`
          SELECT fr."period"
          FROM "fx_revaluation_items" fri
          JOIN "fx_revaluations" fr ON fr."id"=fri."fx_revaluation_id"
          WHERE fri."tenant_id"=${tenantId}::uuid AND fri."item_type"='AP' AND fri."bill_id"=${credit.sourceBillId}
            AND fr."status"='POSTED'::fx_revaluation_status AND fr."revaluation_date">${credit.creditDate}
          ORDER BY fr."revaluation_date" DESC LIMIT 1
        `;
        if (laterApReval[0]) throw new Error(`Reverse the later AP FX revaluation (${laterApReval[0].period}) first.`);
      }

      const originalJournal = await tx.journalEntry.findFirst({
        where: { id: credit.journalEntryId, tenantId, source: "vendor_credit", sourceId: credit.id, isLocked: true },
        include: { lines: true },
      });
      if (!originalJournal || !originalJournal.lines.length) throw new Error("Original Vendor Credit journal evidence is missing.");
      const duplicate = await tx.journalEntry.findFirst({ where: { tenantId, source: "vendor_credit_reversal", sourceId: credit.id }, select: { id: true } });
      if (duplicate) throw new Error("A reversal journal already exists for this Vendor Credit.");

      const period = getRecognitionPeriod(reversalDate);
      await assertPeriodOpenInTransaction(tx, tenantId, period);
      const reversalLines: JournalPostingLine[] = originalJournal.lines.map((line) => ({
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
        description: `Reverse Vendor Credit ${credit.creditNumber}: ${reason}`,
        recognitionPeriod: period,
        source: "vendor_credit_reversal",
        sourceId: credit.id,
        lines: reversalLines,
      });

      if (sourceApplication) {
        const sourceUpdated = await tx.$executeRaw`
          UPDATE "vendor_credit_applications"
          SET "status"='REVERSED',"reversal_journal_entry_id"=${reversalJournalId},"reversed_at"=${reversalDate},
              "reversed_by"=${userId},"reversal_reason"=${reason}
          WHERE "id"=${sourceApplication.id} AND "tenant_id"=${tenantId}::uuid AND "status"='POSTED'
        `;
        if (sourceUpdated !== 1) throw new Error("Source application changed before reversal could complete.");
      }

      if (sourceAppliedAmount > 0.005) {
        const bill = await tx.bill.findFirst({
          where: { id: credit.sourceBillId, tenantId },
          select: { id: true, billNumber: true, totalAmount: true, amountPaid: true, amountCredited: true, dueDate: true },
        });
        if (!bill) throw new Error("Source Bill not found.");
        const restoredCredited = roundMoney(Number(bill.amountCredited) - sourceAppliedAmount);
        if (restoredCredited < -0.01) throw new Error(`Reversal would make ${bill.billNumber}'s credited amount negative.`);
        const amountCredited = Math.max(0, restoredCredited);
        const outstanding = Math.max(0, roundMoney(Number(bill.totalAmount) - Number(bill.amountPaid) - amountCredited));
        const status = outstanding <= 0.01
          ? (Number(bill.amountPaid) >= Number(bill.totalAmount) - 0.01 ? "PAID" : "SETTLED")
          : bill.dueDate < reversalDate
            ? "OVERDUE"
            : (Number(bill.amountPaid) > 0.01 || amountCredited > 0.01 ? "PARTIAL" : "RECORDED");
        await tx.bill.update({ where: { id: bill.id }, data: { amountCredited, status } });
      }

      const updated = await tx.$executeRaw`
        UPDATE "vendor_credits"
        SET "status"='REVERSED',"reversal_journal_entry_id"=${reversalJournalId},"reversed_at"=${reversalDate},
            "reversed_by"=${userId},"reversal_reason"=${reason}
        WHERE "id"=${credit.id} AND "tenant_id"=${tenantId}::uuid AND "status"<>'REVERSED'
      `;
      if (updated !== 1) throw new Error("Vendor Credit status changed before reversal could complete.");
    });

    revalidatePath("/purchases/vendor-credits");
    revalidatePath("/purchases/bills");
    revalidatePath("/accounting/balance-sheet");
    revalidatePath("/accounting/fx-revaluation");
    return { success: true as const };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Vendor Credit could not be reversed." };
  }
}
