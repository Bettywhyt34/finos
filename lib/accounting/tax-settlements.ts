import "server-only";

import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  postJournalEntryInTransaction,
  type JournalPostingLine,
} from "@/lib/journal";
import { resolveSystemAccount } from "@/lib/accounting/system-accounts";
import { getRecognitionPeriod } from "@/lib/utils";

type DbClient = Prisma.TransactionClient | typeof prisma;

type BalanceRow = { debit: unknown; credit: unknown };
type TaxSettlementRow = {
  id: string;
  tenantId: string;
  taxType: "VAT" | "WHT";
  taxPeriod: string;
  settlementDate: Date;
  journalEntryId: string;
  status: "POSTED" | "REVERSED";
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function assertTaxPeriod(period: string) {
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new Error("Tax period must use YYYY-MM format.");
  }
  const month = Number(period.slice(5, 7));
  if (month < 1 || month > 12) throw new Error("Tax period month is invalid.");
}

function assertValidDate(date: Date, label: string) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error(`${label} is invalid.`);
  }
}

async function getAccountBalanceAsOf(
  db: DbClient,
  tenantId: string,
  accountId: string,
  asOfDate: Date,
  normalSide: "DEBIT" | "CREDIT",
) {
  const rows = await db.$queryRaw<BalanceRow[]>`
    SELECT
      COALESCE(SUM(jel."debit"), 0) AS "debit",
      COALESCE(SUM(jel."credit"), 0) AS "credit"
    FROM "journal_entry_lines" jel
    INNER JOIN "journal_entries" je
      ON je."id" = jel."entry_id"
    WHERE je."tenant_id" = ${tenantId}::uuid
      AND je."is_locked" = true
      AND jel."account_id" = ${accountId}
      AND je."entry_date" <= ${asOfDate}
  `;
  const debit = Number(rows[0]?.debit ?? 0);
  const credit = Number(rows[0]?.credit ?? 0);
  const balance = normalSide === "DEBIT" ? debit - credit : credit - debit;
  return roundMoney(balance);
}

export interface VatSettlementPreview {
  outputVatPayable: number;
  inputVatRecoverable: number;
  maxInputVatApplicable: number;
  netCashDueAfterFullInputVat: number;
}

/**
 * Read current VAT control balances through the proposed settlement date.
 * The taxPeriod is a filing/reference period; control validation always uses
 * the actual current ledger balances so prior remittances cannot be duplicated.
 */
export async function getVatSettlementPreview(
  tenantId: string,
  settlementDate: Date,
): Promise<VatSettlementPreview> {
  assertValidDate(settlementDate, "Settlement date");
  const [outputVat, inputVat] = await Promise.all([
    resolveSystemAccount(prisma, tenantId, "OUTPUT_VAT", "CL-003"),
    resolveSystemAccount(prisma, tenantId, "INPUT_VAT"),
  ]);
  const [outputBalance, inputBalance] = await Promise.all([
    getAccountBalanceAsOf(prisma, tenantId, outputVat.id, settlementDate, "CREDIT"),
    getAccountBalanceAsOf(prisma, tenantId, inputVat.id, settlementDate, "DEBIT"),
  ]);
  const outputVatPayable = Math.max(0, outputBalance);
  const inputVatRecoverable = Math.max(0, inputBalance);
  const maxInputVatApplicable = roundMoney(Math.min(outputVatPayable, inputVatRecoverable));
  return {
    outputVatPayable,
    inputVatRecoverable,
    maxInputVatApplicable,
    netCashDueAfterFullInputVat: roundMoney(Math.max(0, outputVatPayable - maxInputVatApplicable)),
  };
}

export async function postVatSettlement(input: {
  tenantId: string;
  userId: string;
  taxPeriod: string;
  settlementDate: Date;
  inputVatApplied: number;
  cashPaid: number;
  reference?: string | null;
  notes?: string | null;
}) {
  assertTaxPeriod(input.taxPeriod);
  assertValidDate(input.settlementDate, "Settlement date");

  const inputVatApplied = roundMoney(input.inputVatApplied);
  const cashPaid = roundMoney(input.cashPaid);
  if (!Number.isFinite(inputVatApplied) || inputVatApplied < 0) {
    throw new Error("Input VAT applied cannot be negative.");
  }
  if (!Number.isFinite(cashPaid) || cashPaid < 0) {
    throw new Error("VAT cash paid cannot be negative.");
  }
  const outputVatCleared = roundMoney(inputVatApplied + cashPaid);
  if (outputVatCleared <= 0) {
    throw new Error("VAT settlement must apply Input VAT, pay cash, or both.");
  }

  const settlementId = randomUUID();
  return prisma.$transaction(async (tx) => {
    const [outputVat, inputVat] = await Promise.all([
      resolveSystemAccount(tx, input.tenantId, "OUTPUT_VAT", "CL-003"),
      inputVatApplied > 0
        ? resolveSystemAccount(tx, input.tenantId, "INPUT_VAT")
        : Promise.resolve(null),
    ]);
    const bank = cashPaid > 0
      ? await resolveSystemAccount(tx, input.tenantId, "DEFAULT_BANK", "CA-003")
      : null;

    const [outputBalance, inputBalance] = await Promise.all([
      getAccountBalanceAsOf(tx, input.tenantId, outputVat.id, input.settlementDate, "CREDIT"),
      inputVat
        ? getAccountBalanceAsOf(tx, input.tenantId, inputVat.id, input.settlementDate, "DEBIT")
        : Promise.resolve(0),
    ]);
    const availableOutput = Math.max(0, outputBalance);
    const availableInput = Math.max(0, inputBalance);

    if (outputVatCleared - availableOutput > 0.01) {
      throw new Error(
        `VAT settlement clears ${outputVatCleared.toFixed(2)}, but only ${availableOutput.toFixed(2)} Output VAT is payable as of the settlement date.`,
      );
    }
    if (inputVatApplied - availableInput > 0.01) {
      throw new Error(
        `Input VAT applied is ${inputVatApplied.toFixed(2)}, but only ${availableInput.toFixed(2)} is recoverable as of the settlement date.`,
      );
    }

    const lines: JournalPostingLine[] = [
      {
        accountId: outputVat.id,
        description: `VAT liability settled - ${input.taxPeriod}`,
        debit: outputVatCleared,
        credit: 0,
      },
    ];
    if (inputVat && inputVatApplied > 0) {
      lines.push({
        accountId: inputVat.id,
        description: `Input VAT applied - ${input.taxPeriod}`,
        debit: 0,
        credit: inputVatApplied,
      });
    }
    if (bank && cashPaid > 0) {
      lines.push({
        accountId: bank.id,
        description: `VAT remittance - ${input.taxPeriod}`,
        debit: 0,
        credit: cashPaid,
      });
    }

    const journalEntryId = await postJournalEntryInTransaction(tx, {
      tenantId: input.tenantId,
      createdBy: input.userId,
      entryDate: input.settlementDate,
      reference: input.reference ?? `VAT-${input.taxPeriod}`,
      description: `VAT settlement for ${input.taxPeriod}`,
      recognitionPeriod: getRecognitionPeriod(input.settlementDate),
      source: "vat_settlement",
      sourceId: settlementId,
      lines,
    });

    await tx.$executeRaw`
      INSERT INTO "tax_settlements" (
        "id", "tenant_id", "tax_type", "tax_period", "settlement_date",
        "input_vat_applied", "cash_paid", "wht_amount", "reference", "notes",
        "journal_entry_id", "status", "created_by_user_id"
      ) VALUES (
        ${settlementId}, ${input.tenantId}::uuid, 'VAT', ${input.taxPeriod}, ${input.settlementDate},
        ${inputVatApplied}, ${cashPaid}, 0, ${input.reference ?? null}, ${input.notes ?? null},
        ${journalEntryId}, 'POSTED', ${input.userId}
      )
    `;

    return { settlementId, journalEntryId };
  });
}

export async function postWhtRemittance(input: {
  tenantId: string;
  userId: string;
  taxPeriod: string;
  settlementDate: Date;
  amount: number;
  reference?: string | null;
  notes?: string | null;
}) {
  assertTaxPeriod(input.taxPeriod);
  assertValidDate(input.settlementDate, "Settlement date");
  const amount = roundMoney(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("WHT remittance amount must be greater than zero.");
  }

  const settlementId = randomUUID();
  return prisma.$transaction(async (tx) => {
    const [whtPayable, bank] = await Promise.all([
      resolveSystemAccount(tx, input.tenantId, "WHT_PAYABLE", "CL-002"),
      resolveSystemAccount(tx, input.tenantId, "DEFAULT_BANK", "CA-003"),
    ]);
    const payableBalance = Math.max(
      0,
      await getAccountBalanceAsOf(tx, input.tenantId, whtPayable.id, input.settlementDate, "CREDIT"),
    );
    if (amount - payableBalance > 0.01) {
      throw new Error(
        `WHT remittance is ${amount.toFixed(2)}, but only ${payableBalance.toFixed(2)} WHT Payable is outstanding as of the settlement date.`,
      );
    }

    const journalEntryId = await postJournalEntryInTransaction(tx, {
      tenantId: input.tenantId,
      createdBy: input.userId,
      entryDate: input.settlementDate,
      reference: input.reference ?? `WHT-${input.taxPeriod}`,
      description: `WHT remittance for ${input.taxPeriod}`,
      recognitionPeriod: getRecognitionPeriod(input.settlementDate),
      source: "wht_remittance",
      sourceId: settlementId,
      lines: [
        {
          accountId: whtPayable.id,
          description: `WHT liability remitted - ${input.taxPeriod}`,
          debit: amount,
          credit: 0,
        },
        {
          accountId: bank.id,
          description: `WHT remittance - ${input.taxPeriod}`,
          debit: 0,
          credit: amount,
        },
      ],
    });

    await tx.$executeRaw`
      INSERT INTO "tax_settlements" (
        "id", "tenant_id", "tax_type", "tax_period", "settlement_date",
        "input_vat_applied", "cash_paid", "wht_amount", "reference", "notes",
        "journal_entry_id", "status", "created_by_user_id"
      ) VALUES (
        ${settlementId}, ${input.tenantId}::uuid, 'WHT', ${input.taxPeriod}, ${input.settlementDate},
        0, ${amount}, ${amount}, ${input.reference ?? null}, ${input.notes ?? null},
        ${journalEntryId}, 'POSTED', ${input.userId}
      )
    `;

    return { settlementId, journalEntryId };
  });
}

export async function reverseTaxSettlement(input: {
  tenantId: string;
  userId: string;
  settlementId: string;
  reversalDate: Date;
  reason: string;
}) {
  assertValidDate(input.reversalDate, "Reversal date");
  if (!input.reason.trim()) throw new Error("A reversal reason is required.");

  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<TaxSettlementRow[]>`
      SELECT
        "id",
        "tenant_id"::text AS "tenantId",
        "tax_type" AS "taxType",
        "tax_period" AS "taxPeriod",
        "settlement_date" AS "settlementDate",
        "journal_entry_id" AS "journalEntryId",
        "status"
      FROM "tax_settlements"
      WHERE "id" = ${input.settlementId}
        AND "tenant_id" = ${input.tenantId}::uuid
      LIMIT 1
    `;
    const settlement = rows[0];
    if (!settlement) throw new Error("Tax settlement not found.");
    if (settlement.status !== "POSTED") throw new Error("Tax settlement has already been reversed.");

    const journal = await tx.journalEntry.findFirst({
      where: {
        id: settlement.journalEntryId,
        tenantId: input.tenantId,
        isLocked: true,
      },
      include: { lines: true },
    });
    if (!journal || !journal.lines.length) {
      throw new Error("Original tax settlement journal was not found.");
    }

    const reversalJournalId = await postJournalEntryInTransaction(tx, {
      tenantId: input.tenantId,
      createdBy: input.userId,
      entryDate: input.reversalDate,
      reference: `REV-${journal.entryNumber}`,
      description: `Reversal of ${settlement.taxType} settlement ${settlement.taxPeriod}: ${input.reason.trim()}`,
      recognitionPeriod: getRecognitionPeriod(input.reversalDate),
      source: "tax_settlement_reversal",
      sourceId: settlement.id,
      lines: journal.lines.map((line) => ({
        accountId: line.accountId,
        description: `REVERSAL: ${line.description ?? "Tax settlement"}`,
        debit: Number(line.credit),
        credit: Number(line.debit),
        projectId: line.projectId,
        reportingTags:
          line.reportingTags && typeof line.reportingTags === "object" && !Array.isArray(line.reportingTags)
            ? (line.reportingTags as Record<string, string>)
            : null,
      })),
    });

    await tx.$executeRaw`
      UPDATE "tax_settlements"
      SET
        "status" = 'REVERSED',
        "reversed_at" = NOW(),
        "reversed_by_user_id" = ${input.userId},
        "reversal_reason" = ${input.reason.trim()}
      WHERE "id" = ${settlement.id}
        AND "tenant_id" = ${input.tenantId}::uuid
        AND "status" = 'POSTED'
    `;

    return { settlementId: settlement.id, reversalJournalId };
  });
}
