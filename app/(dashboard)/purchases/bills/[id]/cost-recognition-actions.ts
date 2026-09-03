"use server";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertPeriodOpenInTransaction, postJournalEntryInTransaction, type JournalPostingLine } from "@/lib/journal";
import { resolveSystemAccount } from "@/lib/accounting/system-accounts";
import { getRecognitionPeriod } from "@/lib/utils";

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normaliseTags(value: Prisma.JsonValue | null): Record<string, string> | null {
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
    throw new Error("You do not have permission to recognise prepaid costs.");
  }
  return { tenantId, userId };
}

interface PrepaidLineRow {
  id: string;
  billId: string;
  billNumber: string;
  billDate: Date;
  billStatus: string;
  exchangeRate: unknown;
  amount: unknown;
  description: string;
  accountId: string;
  projectId: string | null;
  reportingTags: Prisma.JsonValue | null;
  recognisedAmount: unknown;
  creditedAmount: unknown;
  recognisedCreditReversal: unknown;
  latestVendorCreditDate: Date | null;
}

async function getPrepaidLine(tx: Prisma.TransactionClient, tenantId: string, billLineId: string) {
  const rows = await tx.$queryRaw<PrepaidLineRow[]>`
    SELECT bl."id", bl."bill_id" AS "billId", b."bill_number" AS "billNumber", b."bill_date" AS "billDate",
           b."status"::text AS "billStatus", b."exchange_rate" AS "exchangeRate", bl."amount", bl."description",
           bl."account_id" AS "accountId", bl."project_id" AS "projectId", bl."reporting_tags" AS "reportingTags",
           COALESCE((SELECT SUM(r."amount") FROM "bill_line_cost_recognitions" r
                     WHERE r."tenant_id"=${tenantId}::uuid AND r."bill_line_id"=bl."id" AND r."status"='POSTED'),0) AS "recognisedAmount",
           COALESCE((SELECT SUM(vcl."service_amount")
                     FROM "vendor_credit_lines" vcl
                     INNER JOIN "vendor_credits" vc ON vc."id"=vcl."vendor_credit_id"
                     WHERE vcl."tenant_id"=${tenantId}::uuid AND vcl."source_bill_line_id"=bl."id" AND vc."status"<>'REVERSED'),0) AS "creditedAmount",
           COALESCE((SELECT SUM(vcl."recognised_cost_reversal")
                     FROM "vendor_credit_lines" vcl
                     INNER JOIN "vendor_credits" vc ON vc."id"=vcl."vendor_credit_id"
                     WHERE vcl."tenant_id"=${tenantId}::uuid AND vcl."source_bill_line_id"=bl."id" AND vc."status"<>'REVERSED'),0) AS "recognisedCreditReversal",
           (SELECT MAX(vc."credit_date")
            FROM "vendor_credit_lines" vcl
            INNER JOIN "vendor_credits" vc ON vc."id"=vcl."vendor_credit_id"
            WHERE vcl."tenant_id"=${tenantId}::uuid AND vcl."source_bill_line_id"=bl."id" AND vc."status"<>'REVERSED') AS "latestVendorCreditDate"
    FROM "bill_lines" bl
    INNER JOIN "bills" b ON b."id"=bl."bill_id"
    WHERE bl."id"=${billLineId} AND b."tenant_id"=${tenantId}::uuid AND bl."cost_recognition_mode"='PREPAID'
    LIMIT 1
  `;
  const line = rows[0];
  if (!line) throw new Error("Prepaid Bill line not found.");
  if (line.billStatus === "DRAFT") throw new Error("Post the Bill before recognising prepaid cost.");
  return line;
}

export async function recognisePrepaidCost(input: {
  billLineId: string;
  recognitionDate: string;
  amount: number;
}) {
  try {
    const { tenantId, userId } = await actor();
    const recognitionDate = new Date(`${input.recognitionDate}T00:00:00`);
    if (Number.isNaN(recognitionDate.getTime()) || recognitionDate > new Date()) throw new Error("Enter a valid recognition date.");
    const amount = roundMoney(Number(input.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Recognition amount must be greater than zero.");

    const recognitionId = randomUUID();
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:prepaid-line:${tenantId}:${input.billLineId}`}))`;
      const line = await getPrepaidLine(tx, tenantId, input.billLineId);
      if (recognitionDate < new Date(line.billDate)) throw new Error("Recognition date cannot be before the Bill date.");
      if (line.latestVendorCreditDate && recognitionDate < new Date(line.latestVendorCreditDate)) {
        throw new Error("Recognition date cannot be before an existing Vendor Credit on this prepaid line. Reverse/repost that credit first if the historical order is wrong.");
      }

      const netAmount = roundMoney(Number(line.amount) - Number(line.creditedAmount));
      const effectiveRecognised = roundMoney(Number(line.recognisedAmount) - Number(line.recognisedCreditReversal));
      if (netAmount < -0.01 || effectiveRecognised < -0.01 || effectiveRecognised - netAmount > 0.01) {
        throw new Error("Prepaid cost evidence is inconsistent after Vendor Credits. Review the Bill before recognising more cost.");
      }
      const remaining = roundMoney(netAmount - effectiveRecognised);
      if (remaining <= 0.005) throw new Error("This prepaid cost has already been fully recognised.");
      if (amount - remaining > 0.01) throw new Error("Recognition exceeds the remaining prepaid amount after Vendor Credits.");

      const rate = Number(line.exchangeRate);
      if (!Number.isFinite(rate) || rate <= 0) throw new Error("Original Bill exchange rate is invalid.");
      const baseAmount = roundMoney(amount * rate);
      const prepaidAccount = await resolveSystemAccount(tx, tenantId, "PREPAID_EXPENSE");
      const period = getRecognitionPeriod(recognitionDate);
      await assertPeriodOpenInTransaction(tx, tenantId, period);

      const lines: JournalPostingLine[] = [
        {
          accountId: line.accountId,
          description: `Recognise prepaid cost - ${line.billNumber}`,
          debit: baseAmount,
          credit: 0,
          projectId: line.projectId,
          reportingTags: normaliseTags(line.reportingTags),
        },
        {
          accountId: prepaidAccount.id,
          description: `Release prepaid expense - ${line.billNumber}`,
          debit: 0,
          credit: baseAmount,
          projectId: line.projectId,
          reportingTags: normaliseTags(line.reportingTags),
        },
      ];

      const journalEntryId = await postJournalEntryInTransaction(tx, {
        tenantId,
        createdBy: userId,
        entryDate: recognitionDate,
        reference: `PCR-${recognitionId.slice(0, 8).toUpperCase()}`,
        description: `Recognise prepaid cost from ${line.billNumber}: ${line.description}`,
        recognitionPeriod: period,
        source: "prepaid_cost_recognition",
        sourceId: recognitionId,
        lines,
      });

      await tx.$executeRaw`
        INSERT INTO "bill_line_cost_recognitions" (
          "id","tenant_id","bill_line_id","recognition_date","amount","historical_exchange_rate","base_amount",
          "journal_entry_id","status","created_by"
        ) VALUES (
          ${recognitionId},${tenantId}::uuid,${line.id},${recognitionDate},${amount},${rate},${baseAmount},
          ${journalEntryId},'POSTED',${userId}
        )
      `;
    });

    revalidatePath("/purchases/bills");
    return { success: true as const, recognitionId };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Prepaid cost could not be recognised." };
  }
}

export async function reversePrepaidCostRecognition(input: {
  recognitionId: string;
  reversalDate: string;
  reason: string;
}) {
  try {
    const { tenantId, userId } = await actor();
    const reason = input.reason.trim();
    if (!reason) throw new Error("Enter a reversal reason.");
    if (reason.length > 2000) throw new Error("Reversal reason is too long.");
    const reversalDate = new Date(`${input.reversalDate}T00:00:00`);
    if (Number.isNaN(reversalDate.getTime()) || reversalDate > new Date()) throw new Error("Enter a valid reversal date.");

    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{
        id: string; billLineId: string; recognitionDate: Date; createdAt: Date; journalEntryId: string; status: string;
      }>>`
        SELECT "id","bill_line_id" AS "billLineId","recognition_date" AS "recognitionDate","created_at" AS "createdAt",
               "journal_entry_id" AS "journalEntryId","status"
        FROM "bill_line_cost_recognitions"
        WHERE "id"=${input.recognitionId} AND "tenant_id"=${tenantId}::uuid LIMIT 1
      `;
      const recognition = rows[0];
      if (!recognition) throw new Error("Prepaid cost recognition not found.");
      if (recognition.status !== "POSTED") throw new Error("This recognition has already been reversed.");
      if (reversalDate < recognition.recognitionDate) throw new Error("Reversal date cannot be before the recognition date.");

      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:prepaid-line:${tenantId}:${recognition.billLineId}`}))`;
      const later = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "bill_line_cost_recognitions"
        WHERE "tenant_id"=${tenantId}::uuid AND "bill_line_id"=${recognition.billLineId} AND "status"='POSTED'
          AND "id"<>${recognition.id}
          AND ("recognition_date">${recognition.recognitionDate}
               OR ("recognition_date"=${recognition.recognitionDate} AND "created_at">${recognition.createdAt}))
        ORDER BY "recognition_date" DESC,"created_at" DESC LIMIT 1
      `;
      if (later[0]) throw new Error("Reverse the later prepaid-cost recognition first.");

      const dependentCredit = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT vc."id"
        FROM "vendor_credit_lines" vcl
        INNER JOIN "vendor_credits" vc ON vc."id"=vcl."vendor_credit_id"
        WHERE vcl."tenant_id"=${tenantId}::uuid
          AND vcl."source_bill_line_id"=${recognition.billLineId}
          AND vc."status"<>'REVERSED'
          AND vcl."recognised_cost_reversal">0.005
          AND (vc."credit_date">${recognition.recognitionDate}
               OR (vc."credit_date"=${recognition.recognitionDate} AND vc."created_at">${recognition.createdAt}))
        ORDER BY vc."credit_date" DESC,vc."created_at" DESC
        LIMIT 1
      `;
      if (dependentCredit[0]) throw new Error("Reverse the later Vendor Credit first because its prepaid/recognised split depends on this recognition.");

      const journal = await tx.journalEntry.findFirst({
        where: { id: recognition.journalEntryId, tenantId, source: "prepaid_cost_recognition", sourceId: recognition.id, isLocked: true },
        include: { lines: true },
      });
      if (!journal || !journal.lines.length) throw new Error("Original prepaid recognition journal evidence is missing.");
      const duplicate = await tx.journalEntry.findFirst({
        where: { tenantId, source: "prepaid_cost_recognition_reversal", sourceId: recognition.id }, select: { id: true },
      });
      if (duplicate) throw new Error("A reversal journal already exists for this recognition.");

      const period = getRecognitionPeriod(reversalDate);
      await assertPeriodOpenInTransaction(tx, tenantId, period);
      const reversalLines: JournalPostingLine[] = journal.lines.map((line) => ({
        accountId: line.accountId,
        description: `Reverse - ${line.description ?? "prepaid cost recognition"}`,
        debit: Number(line.credit),
        credit: Number(line.debit),
        projectId: line.projectId ?? null,
        reportingTags: normaliseTags(line.reportingTags),
      }));
      const reversalJournalId = await postJournalEntryInTransaction(tx, {
        tenantId,
        createdBy: userId,
        entryDate: reversalDate,
        reference: `REV-PCR-${recognition.id.slice(0, 8).toUpperCase()}`,
        description: `Reverse prepaid cost recognition: ${reason}`,
        recognitionPeriod: period,
        source: "prepaid_cost_recognition_reversal",
        sourceId: recognition.id,
        lines: reversalLines,
      });

      const updated = await tx.$executeRaw`
        UPDATE "bill_line_cost_recognitions"
        SET "status"='REVERSED',"reversal_journal_entry_id"=${reversalJournalId},"reversed_at"=${reversalDate},
            "reversed_by"=${userId},"reversal_reason"=${reason}
        WHERE "id"=${recognition.id} AND "tenant_id"=${tenantId}::uuid AND "status"='POSTED'
      `;
      if (updated !== 1) throw new Error("Recognition status changed before reversal could complete.");
    });

    revalidatePath("/purchases/bills");
    return { success: true as const };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Prepaid cost recognition could not be reversed." };
  }
}
