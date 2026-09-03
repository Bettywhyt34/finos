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

function normaliseTags(value: Prisma.JsonValue | null | undefined): Record<string, string> | null {
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
  if (!role || !["OWNER", "ADMIN", "ACCOUNTANT"].includes(role)) throw new Error("You do not have permission to manage accruals.");
  return { tenantId, userId };
}

export async function createAccrual(input: {
  accrualDate: string;
  description: string;
  amount: number;
  accountId: string;
  vendorId?: string | null;
  projectId?: string | null;
  reportingTags?: Record<string, string> | null;
}) {
  try {
    const { tenantId, userId } = await actor();
    const accrualDate = new Date(`${input.accrualDate}T00:00:00`);
    if (Number.isNaN(accrualDate.getTime()) || accrualDate > new Date()) throw new Error("Enter a valid accrual date.");
    const description = input.description.trim();
    if (!description) throw new Error("Enter an accrual description.");
    const amount = roundMoney(Number(input.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Accrual amount must be greater than zero.");

    const [tenant, account, vendor, project] = await Promise.all([
      prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } }),
      prisma.chartOfAccounts.findFirst({ where: { id: input.accountId, tenantId, isActive: true, type: "EXPENSE" }, select: { id: true } }),
      input.vendorId ? prisma.vendor.findFirst({ where: { id: input.vendorId, tenantId }, select: { id: true } }) : Promise.resolve(null),
      input.projectId ? prisma.project.findFirst({ where: { id: input.projectId, tenantId }, select: { id: true } }) : Promise.resolve(null),
    ]);
    if (!tenant) throw new Error("Organisation not found.");
    if (!account) throw new Error("Select an active Expense account.");
    if (input.vendorId && !vendor) throw new Error("Selected vendor is invalid for this organisation.");
    if (input.projectId && !project) throw new Error("Selected Project is invalid for this organisation.");

    const accrualId = randomUUID();
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:accrual-number:${tenantId}`}))`;
      const countRows = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "accruals" WHERE "tenant_id"=${tenantId}::uuid`;
      const accrualNumber = `ACCR-${String(Number(countRows[0]?.count ?? 0) + 1).padStart(5, "0")}`;
      const accruedAccount = await resolveSystemAccount(tx, tenantId, "ACCRUED_EXPENSES");
      const period = getRecognitionPeriod(accrualDate);
      await assertPeriodOpenInTransaction(tx, tenantId, period);
      const tags = input.reportingTags ?? null;
      const lines: JournalPostingLine[] = [
        { accountId: account.id, description: `Accrued cost - ${accrualNumber}`, debit: amount, credit: 0, projectId: input.projectId ?? null, reportingTags: tags },
        { accountId: accruedAccount.id, description: `Accrued expenses - ${accrualNumber}`, debit: 0, credit: amount, projectId: input.projectId ?? null, reportingTags: tags },
      ];
      const journalEntryId = await postJournalEntryInTransaction(tx, {
        tenantId,
        createdBy: userId,
        entryDate: accrualDate,
        reference: accrualNumber,
        description: `Accrual ${accrualNumber}: ${description}`,
        recognitionPeriod: period,
        source: "accrual",
        sourceId: accrualId,
        lines,
      });
      await tx.$executeRaw`
        INSERT INTO "accruals" (
          "id","tenant_id","accrual_number","accrual_date","description","vendor_id","account_id","project_id","reporting_tags","currency","amount","journal_entry_id","status","created_by"
        ) VALUES (
          ${accrualId},${tenantId}::uuid,${accrualNumber},${accrualDate},${description},${input.vendorId ?? null},${account.id},${input.projectId ?? null},${tags ? JSON.stringify(tags) : null}::jsonb,
          ${tenant.currency.trim().toUpperCase()},${amount},${journalEntryId},'POSTED',${userId}
        )
      `;
    });
    revalidatePath("/purchases/accruals");
    return { success: true as const, id: accrualId };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Accrual could not be created." };
  }
}

interface AccrualRow {
  id: string; accrualNumber: string; accrualDate: Date; amount: unknown; accountId: string; vendorId: string | null;
  projectId: string | null; reportingTags: Prisma.JsonValue | null; journalEntryId: string; status: string;
}

async function getAccrual(tx: Prisma.TransactionClient, tenantId: string, accrualId: string) {
  const rows = await tx.$queryRaw<AccrualRow[]>`
    SELECT "id","accrual_number" AS "accrualNumber","accrual_date" AS "accrualDate","amount","account_id" AS "accountId","vendor_id" AS "vendorId",
           "project_id" AS "projectId","reporting_tags" AS "reportingTags","journal_entry_id" AS "journalEntryId","status"
    FROM "accruals" WHERE "id"=${accrualId} AND "tenant_id"=${tenantId}::uuid LIMIT 1
  `;
  const row = rows[0];
  if (!row) throw new Error("Accrual not found.");
  return row;
}

export async function settleAccrual(input: { accrualId: string; billLineId: string; settlementDate: string; amount: number }) {
  try {
    const { tenantId, userId } = await actor();
    const settlementDate = new Date(`${input.settlementDate}T00:00:00`);
    if (Number.isNaN(settlementDate.getTime()) || settlementDate > new Date()) throw new Error("Enter a valid settlement date.");
    const amount = roundMoney(Number(input.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Settlement amount must be greater than zero.");
    const settlementId = randomUUID();

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:accrual:${tenantId}:${input.accrualId}`}))`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:accrual-bill-line:${tenantId}:${input.billLineId}`}))`;
      const accrual = await getAccrual(tx, tenantId, input.accrualId);
      if (accrual.status !== "POSTED") throw new Error("This accrual is no longer active.");

      const billRows = await tx.$queryRaw<Array<{
        billNumber: string; billDate: Date; billStatus: string; exchangeRate: unknown; serviceAmount: unknown; accountId: string;
        projectId: string | null; reportingTags: Prisma.JsonValue | null; costRecognitionMode: string; accountType: string; vendorId: string;
      }>>`
        SELECT b."bill_number" AS "billNumber",b."bill_date" AS "billDate",b."status"::text AS "billStatus",b."exchange_rate" AS "exchangeRate",
               bl."amount" AS "serviceAmount",bl."account_id" AS "accountId",bl."project_id" AS "projectId",bl."reporting_tags" AS "reportingTags",
               bl."cost_recognition_mode" AS "costRecognitionMode",coa."type"::text AS "accountType",b."vendor_id" AS "vendorId"
        FROM "bill_lines" bl JOIN "bills" b ON b."id"=bl."bill_id" JOIN "chart_of_accounts" coa ON coa."id"=bl."account_id" AND coa."tenant_id"=b."tenant_id"
        WHERE bl."id"=${input.billLineId} AND b."tenant_id"=${tenantId}::uuid LIMIT 1
      `;
      const billLine = billRows[0];
      if (!billLine || billLine.billStatus === "DRAFT") throw new Error("Select a posted Bill line.");
      if (billLine.costRecognitionMode !== "IMMEDIATE" || billLine.accountType !== "EXPENSE") throw new Error("Only immediate Expense Bill lines can settle an accrual.");
      if (billLine.accountId !== accrual.accountId) throw new Error("Bill Expense account must match the accrual Expense account.");
      if (accrual.vendorId && billLine.vendorId !== accrual.vendorId) throw new Error("Bill vendor must match the accrual vendor.");
      if (accrual.projectId && billLine.projectId !== accrual.projectId) throw new Error("Bill Project must match the accrual Project.");
      if (JSON.stringify(normaliseTags(accrual.reportingTags)) !== JSON.stringify(normaliseTags(billLine.reportingTags))) throw new Error("Bill Reporting Tags must match the accrual Reporting Tags.");
      if (settlementDate < accrual.accrualDate || settlementDate < billLine.billDate) throw new Error("Settlement date cannot be before the accrual or Bill date.");

      const [usedRows, lineUsedRows] = await Promise.all([
        tx.$queryRaw<Array<{ used: unknown }>>`
          SELECT COALESCE((SELECT SUM("amount") FROM "accrual_settlements" WHERE "tenant_id"=${tenantId}::uuid AND "accrual_id"=${accrual.id} AND "status"='POSTED'),0)
               + COALESCE((SELECT SUM("amount") FROM "accrual_releases" WHERE "tenant_id"=${tenantId}::uuid AND "accrual_id"=${accrual.id} AND "status"='POSTED'),0) AS "used"
        `,
        tx.$queryRaw<Array<{ used: unknown }>>`
          SELECT COALESCE(SUM("amount"),0) AS "used" FROM "accrual_settlements" WHERE "tenant_id"=${tenantId}::uuid AND "bill_line_id"=${input.billLineId} AND "status"='POSTED'
        `,
      ]);
      const accrualRemaining = roundMoney(Number(accrual.amount) - Number(usedRows[0]?.used ?? 0));
      const billCapacity = roundMoney(Number(billLine.serviceAmount) * Number(billLine.exchangeRate));
      const billRemaining = roundMoney(billCapacity - Number(lineUsedRows[0]?.used ?? 0));
      if (amount - accrualRemaining > 0.01) throw new Error("Settlement exceeds the remaining accrual balance.");
      if (amount - billRemaining > 0.01) throw new Error("Settlement exceeds the available base-currency amount on the Bill line.");

      const accruedAccount = await resolveSystemAccount(tx, tenantId, "ACCRUED_EXPENSES");
      const period = getRecognitionPeriod(settlementDate);
      await assertPeriodOpenInTransaction(tx, tenantId, period);
      const tags = normaliseTags(billLine.reportingTags);
      const journalEntryId = await postJournalEntryInTransaction(tx, {
        tenantId,
        createdBy: userId,
        entryDate: settlementDate,
        reference: `ACS-${settlementId.slice(0, 8).toUpperCase()}`,
        description: `Settle ${accrual.accrualNumber} against ${billLine.billNumber}`,
        recognitionPeriod: period,
        source: "accrual_settlement",
        sourceId: settlementId,
        lines: [
          { accountId: accruedAccount.id, description: `Clear accrued expense - ${accrual.accrualNumber}`, debit: amount, credit: 0, projectId: billLine.projectId, reportingTags: tags },
          { accountId: billLine.accountId, description: `Reverse duplicate Bill cost - ${billLine.billNumber}`, debit: 0, credit: amount, projectId: billLine.projectId, reportingTags: tags },
        ],
      });
      await tx.$executeRaw`
        INSERT INTO "accrual_settlements" ("id","tenant_id","accrual_id","bill_line_id","settlement_date","amount","journal_entry_id","status","created_by")
        VALUES (${settlementId},${tenantId}::uuid,${accrual.id},${input.billLineId},${settlementDate},${amount},${journalEntryId},'POSTED',${userId})
      `;
    });

    revalidatePath("/purchases/accruals");
    return { success: true as const, id: settlementId };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Accrual could not be settled." };
  }
}

export async function releaseAccrual(input: { accrualId: string; releaseDate: string; amount: number; reason: string }) {
  try {
    const { tenantId, userId } = await actor();
    const releaseDate = new Date(`${input.releaseDate}T00:00:00`);
    if (Number.isNaN(releaseDate.getTime()) || releaseDate > new Date()) throw new Error("Enter a valid release date.");
    const amount = roundMoney(Number(input.amount));
    const reason = input.reason.trim();
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Release amount must be greater than zero.");
    if (!reason) throw new Error("Enter a release reason.");
    const releaseId = randomUUID();

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:accrual:${tenantId}:${input.accrualId}`}))`;
      const accrual = await getAccrual(tx, tenantId, input.accrualId);
      if (accrual.status !== "POSTED") throw new Error("This accrual is no longer active.");
      if (releaseDate < accrual.accrualDate) throw new Error("Release date cannot be before the accrual date.");
      const usedRows = await tx.$queryRaw<Array<{ used: unknown }>>`
        SELECT COALESCE((SELECT SUM("amount") FROM "accrual_settlements" WHERE "tenant_id"=${tenantId}::uuid AND "accrual_id"=${accrual.id} AND "status"='POSTED'),0)
             + COALESCE((SELECT SUM("amount") FROM "accrual_releases" WHERE "tenant_id"=${tenantId}::uuid AND "accrual_id"=${accrual.id} AND "status"='POSTED'),0) AS "used"
      `;
      const remaining = roundMoney(Number(accrual.amount) - Number(usedRows[0]?.used ?? 0));
      if (amount - remaining > 0.01) throw new Error("Release exceeds the remaining accrual balance.");
      const accruedAccount = await resolveSystemAccount(tx, tenantId, "ACCRUED_EXPENSES");
      const period = getRecognitionPeriod(releaseDate);
      await assertPeriodOpenInTransaction(tx, tenantId, period);
      const tags = normaliseTags(accrual.reportingTags);
      const journalEntryId = await postJournalEntryInTransaction(tx, {
        tenantId,
        createdBy: userId,
        entryDate: releaseDate,
        reference: `ACR-${releaseId.slice(0, 8).toUpperCase()}`,
        description: `Release ${accrual.accrualNumber}: ${reason}`,
        recognitionPeriod: period,
        source: "accrual_release",
        sourceId: releaseId,
        lines: [
          { accountId: accruedAccount.id, description: `Release accrued liability - ${accrual.accrualNumber}`, debit: amount, credit: 0, projectId: accrual.projectId, reportingTags: tags },
          { accountId: accrual.accountId, description: `Reverse unused accrued cost - ${accrual.accrualNumber}`, debit: 0, credit: amount, projectId: accrual.projectId, reportingTags: tags },
        ],
      });
      await tx.$executeRaw`
        INSERT INTO "accrual_releases" ("id","tenant_id","accrual_id","release_date","amount","reason","journal_entry_id","status","created_by")
        VALUES (${releaseId},${tenantId}::uuid,${accrual.id},${releaseDate},${amount},${reason},${journalEntryId},'POSTED',${userId})
      `;
    });
    revalidatePath("/purchases/accruals");
    return { success: true as const, id: releaseId };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Accrual balance could not be released." };
  }
}

async function reverseJournalEvidence(tx: Prisma.TransactionClient, input: {
  tenantId: string; userId: string; journalEntryId: string; source: string; sourceId: string; reversalSource: string;
  reversalDate: Date; reason: string; reference: string; description: string;
}) {
  const journal = await tx.journalEntry.findFirst({
    where: { id: input.journalEntryId, tenantId: input.tenantId, source: input.source, sourceId: input.sourceId, isLocked: true }, include: { lines: true },
  });
  if (!journal || !journal.lines.length) throw new Error("Original journal evidence is missing.");
  const duplicate = await tx.journalEntry.findFirst({ where: { tenantId: input.tenantId, source: input.reversalSource, sourceId: input.sourceId }, select: { id: true } });
  if (duplicate) throw new Error("A reversal journal already exists for this item.");
  const period = getRecognitionPeriod(input.reversalDate);
  await assertPeriodOpenInTransaction(tx, input.tenantId, period);
  return postJournalEntryInTransaction(tx, {
    tenantId: input.tenantId,
    createdBy: input.userId,
    entryDate: input.reversalDate,
    reference: input.reference,
    description: input.description,
    recognitionPeriod: period,
    source: input.reversalSource,
    sourceId: input.sourceId,
    lines: journal.lines.map((line) => ({
      accountId: line.accountId,
      description: `Reverse - ${line.description ?? "accrual posting"}`,
      debit: Number(line.credit),
      credit: Number(line.debit),
      projectId: line.projectId ?? null,
      reportingTags: normaliseTags(line.reportingTags),
    })),
  });
}

export async function reverseAccrualMovement(input: { kind: "SETTLEMENT" | "RELEASE"; id: string; reversalDate: string; reason: string }) {
  try {
    const { tenantId, userId } = await actor();
    const reversalDate = new Date(`${input.reversalDate}T00:00:00`);
    const reason = input.reason.trim();
    if (Number.isNaN(reversalDate.getTime()) || reversalDate > new Date()) throw new Error("Enter a valid reversal date.");
    if (!reason) throw new Error("Enter a reversal reason.");
    const table = input.kind === "SETTLEMENT" ? "accrual_settlements" : "accrual_releases";
    const dateColumn = input.kind === "SETTLEMENT" ? "settlement_date" : "release_date";
    const source = input.kind === "SETTLEMENT" ? "accrual_settlement" : "accrual_release";
    const reversalSource = input.kind === "SETTLEMENT" ? "accrual_settlement_reversal" : "accrual_release_reversal";

    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ id: string; accrualId: string; movementDate: Date; journalEntryId: string; status: string }>>(
        `SELECT "id","accrual_id" AS "accrualId","${dateColumn}" AS "movementDate","journal_entry_id" AS "journalEntryId","status" FROM "${table}" WHERE "id"=$1 AND "tenant_id"=$2::uuid LIMIT 1`,
        input.id, tenantId,
      );
      const row = rows[0];
      if (!row) throw new Error("Accrual movement not found.");
      if (row.status !== "POSTED") throw new Error("This accrual movement has already been reversed.");
      if (reversalDate < row.movementDate) throw new Error("Reversal date cannot be before the original movement date.");
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:accrual:${tenantId}:${row.accrualId}`}))`;
      const reversalJournalId = await reverseJournalEvidence(tx, {
        tenantId, userId, journalEntryId: row.journalEntryId, source, sourceId: row.id, reversalSource,
        reversalDate, reason, reference: `REV-${row.id.slice(0, 8).toUpperCase()}`, description: `Reverse accrual movement: ${reason}`,
      });
      await tx.$executeRawUnsafe(
        `UPDATE "${table}" SET "status"='REVERSED',"reversal_journal_entry_id"=$1,"reversed_at"=$2,"reversed_by"=$3,"reversal_reason"=$4 WHERE "id"=$5 AND "tenant_id"=$6::uuid AND "status"='POSTED'`,
        reversalJournalId, reversalDate, userId, reason, row.id, tenantId,
      );
    });
    revalidatePath("/purchases/accruals");
    return { success: true as const };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Accrual movement could not be reversed." };
  }
}

export async function reverseAccrual(input: { accrualId: string; reversalDate: string; reason: string }) {
  try {
    const { tenantId, userId } = await actor();
    const reversalDate = new Date(`${input.reversalDate}T00:00:00`);
    const reason = input.reason.trim();
    if (Number.isNaN(reversalDate.getTime()) || reversalDate > new Date()) throw new Error("Enter a valid reversal date.");
    if (!reason) throw new Error("Enter a reversal reason.");

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:accrual:${tenantId}:${input.accrualId}`}))`;
      const accrual = await getAccrual(tx, tenantId, input.accrualId);
      if (accrual.status !== "POSTED") throw new Error("This accrual has already been reversed.");
      if (reversalDate < accrual.accrualDate) throw new Error("Reversal date cannot be before the accrual date.");
      const dependencies = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT (
          (SELECT COUNT(*) FROM "accrual_settlements" WHERE "tenant_id"=${tenantId}::uuid AND "accrual_id"=${accrual.id} AND "status"='POSTED')
          + (SELECT COUNT(*) FROM "accrual_releases" WHERE "tenant_id"=${tenantId}::uuid AND "accrual_id"=${accrual.id} AND "status"='POSTED')
        )::bigint AS "count"
      `;
      if (Number(dependencies[0]?.count ?? 0) > 0) throw new Error("Reverse active settlements/releases before reversing this accrual.");
      const reversalJournalId = await reverseJournalEvidence(tx, {
        tenantId, userId, journalEntryId: accrual.journalEntryId, source: "accrual", sourceId: accrual.id, reversalSource: "accrual_reversal",
        reversalDate, reason, reference: `REV-${accrual.accrualNumber}`, description: `Reverse ${accrual.accrualNumber}: ${reason}`,
      });
      const updated = await tx.$executeRaw`
        UPDATE "accruals" SET "status"='REVERSED',"reversal_journal_entry_id"=${reversalJournalId},"reversed_at"=${reversalDate},"reversed_by"=${userId},"reversal_reason"=${reason}
        WHERE "id"=${accrual.id} AND "tenant_id"=${tenantId}::uuid AND "status"='POSTED'
      `;
      if (updated !== 1) throw new Error("Accrual status changed before reversal could complete.");
    });
    revalidatePath("/purchases/accruals");
    return { success: true as const };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Accrual could not be reversed." };
  }
}
