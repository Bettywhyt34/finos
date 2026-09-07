"use server";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { postJournalEntryInTransaction } from "@/lib/journal";
import { getRecognitionPeriod } from "@/lib/utils";

const TOLERANCE = 0.005;

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

async function context() {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  const userId = session?.user?.id;
  const role = session?.user?.role;
  if (!tenantId || !userId) throw new Error("Unauthorized");
  if (!role || !["OWNER", "ADMIN", "ACCOUNTANT"].includes(role)) {
    throw new Error("You do not have permission to record bank transfers.");
  }
  return { tenantId, userId };
}

type StatementRow = {
  id: string;
  bankAccountId: string;
  transactionDate: Date;
  description: string;
  reference: string | null;
  amount: Prisma.Decimal;
  type: "CREDIT" | "DEBIT";
  journalEntryId: string | null;
  accountName: string;
  currency: string;
  baseCurrency: string;
  ledgerAccountId: string | null;
};

type BankSide = {
  id: string;
  accountName: string;
  currency: string;
  ledgerAccountId: string | null;
};

async function getStatement(
  tx: Prisma.TransactionClient,
  tenantId: string,
  bankTransactionId: string,
): Promise<StatementRow> {
  const rows = await tx.$queryRaw<StatementRow[]>`
    SELECT
      bt."id",
      bt."bank_account_id" AS "bankAccountId",
      bt."transaction_date" AS "transactionDate",
      bt."description",
      bt."reference",
      bt."amount",
      bt."type"::text AS "type",
      bt."journal_entry_id" AS "journalEntryId",
      ba."account_name" AS "accountName",
      UPPER(ba."currency") AS "currency",
      UPPER(t."currency") AS "baseCurrency",
      ba."ledger_account_id" AS "ledgerAccountId"
    FROM "bank_transactions" bt
    INNER JOIN "bank_accounts" ba ON ba."id" = bt."bank_account_id"
    INNER JOIN "tenants" t ON t."id" = ba."tenant_id"
    WHERE bt."id" = ${bankTransactionId}
      AND ba."tenant_id" = ${tenantId}::uuid
      AND ba."is_active" = true
    LIMIT 1
  `;
  const statement = rows[0];
  if (!statement) throw new Error("Statement row not found in this organisation.");
  if (!statement.ledgerAccountId) throw new Error("Map this bank account to its Bank/Cash ledger before recording a transfer.");
  if (statement.journalEntryId) {
    throw new Error("This statement row already created or linked accounting evidence and cannot also become a bank transfer.");
  }
  return statement;
}

async function getOtherBank(
  tx: Prisma.TransactionClient,
  tenantId: string,
  bankAccountId: string,
): Promise<BankSide> {
  const rows = await tx.$queryRaw<BankSide[]>`
    SELECT
      "id",
      "account_name" AS "accountName",
      UPPER("currency") AS "currency",
      "ledger_account_id" AS "ledgerAccountId"
    FROM "bank_accounts"
    WHERE "id" = ${bankAccountId}
      AND "tenant_id" = ${tenantId}::uuid
      AND "is_active" = true
    LIMIT 1
  `;
  const bank = rows[0];
  if (!bank) throw new Error("The other bank account was not found in this organisation.");
  if (!bank.ledgerAccountId) throw new Error(`Map ${bank.accountName} to its Bank/Cash ledger before recording a transfer.`);
  return bank;
}

async function getTargetSession(
  tx: Prisma.TransactionClient,
  tenantId: string,
  userId: string,
  statement: StatementRow,
) {
  const date = statement.transactionDate.toISOString().slice(0, 10);
  const completed = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "bank_reconciliation_sessions"
    WHERE "tenant_id" = ${tenantId}::uuid
      AND "bank_account_id" = ${statement.bankAccountId}
      AND "status" = 'COMPLETED'
      AND ${date}::date BETWEEN "statement_from" AND "statement_to"
    LIMIT 1
  `;
  if (completed[0]) throw new Error("This statement date is already inside a completed reconciliation period.");

  const open = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "bank_reconciliation_sessions"
    WHERE "tenant_id" = ${tenantId}::uuid
      AND "bank_account_id" = ${statement.bankAccountId}
      AND "status" = 'OPEN'
      AND ${date}::date BETWEEN "statement_from" AND "statement_to"
    ORDER BY "created_at" DESC
    LIMIT 1
  `;
  if (open[0]) return open[0].id;

  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(hashtext(${`finos:bank-statement-review:${tenantId}:${statement.bankAccountId}`}))
  `;
  const review = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "bank_reconciliation_sessions"
    WHERE "tenant_id" = ${tenantId}::uuid
      AND "bank_account_id" = ${statement.bankAccountId}
      AND "status" = 'REVIEW'
    ORDER BY "created_at" DESC
    LIMIT 1
  `;
  if (review[0]) return review[0].id;

  const created = await tx.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "bank_reconciliation_sessions"
      ("tenant_id", "bank_account_id", "statement_from", "statement_to", "statement_closing_balance", "status", "completed_by")
    VALUES
      (${tenantId}::uuid, ${statement.bankAccountId}, '1900-01-01'::date, '2999-12-31'::date, 0, 'REVIEW', ${userId})
    RETURNING "id"
  `;
  return created[0].id;
}

async function attachStatementToTransferLine(
  tx: Prisma.TransactionClient,
  tenantId: string,
  userId: string,
  statement: StatementRow,
  journalEntryId: string,
) {
  const lines = await tx.$queryRaw<Array<{ id: string; debit: unknown; credit: unknown }>>`
    SELECT "id", "debit", "credit"
    FROM "journal_entry_lines"
    WHERE "entry_id" = ${journalEntryId}
      AND "account_id" = ${statement.ledgerAccountId!}
  `;
  if (lines.length !== 1) throw new Error("The transfer journal does not contain exactly one ledger line for this bank account.");

  const line = lines[0];
  const lineAmount = statement.type === "CREDIT" ? Number(line.debit) : Number(line.credit);
  const opposite = statement.type === "CREDIT" ? Number(line.credit) : Number(line.debit);
  const statementAmount = roundMoney(Number(statement.amount));
  if (opposite > TOLERANCE || Math.abs(lineAmount - statementAmount) > 0.01) {
    throw new Error("The transfer journal side does not agree with this statement row.");
  }

  const sessionId = await getTargetSession(tx, tenantId, userId, statement);
  const existing = await tx.$queryRaw<Array<{ id: string; matchedAmount: unknown }>>`
    SELECT brm."id", brm."matched_amount" AS "matchedAmount"
    FROM "bank_reconciliation_matches" brm
    WHERE brm."session_id" = ${sessionId}
      AND brm."bank_transaction_id" = ${statement.id}
      AND brm."journal_entry_line_id" = ${line.id}
    LIMIT 1
  `;
  if (existing[0]) {
    if (Math.abs(Number(existing[0].matchedAmount) - statementAmount) <= 0.01) return;
    throw new Error("This statement row already has a different transfer match allocation.");
  }

  const otherMatches = await tx.$queryRaw<Array<{ matchedAmount: unknown }>>`
    SELECT COALESCE(SUM(brm."matched_amount"), 0) AS "matchedAmount"
    FROM "bank_reconciliation_matches" brm
    INNER JOIN "bank_reconciliation_sessions" brs ON brs."id" = brm."session_id"
    WHERE brs."tenant_id" = ${tenantId}::uuid
      AND brs."bank_account_id" = ${statement.bankAccountId}
      AND brm."journal_entry_line_id" = ${line.id}
      AND brm."bank_transaction_id" <> ${statement.id}
  `;
  const remaining = Math.max(0, roundMoney(lineAmount - Number(otherMatches[0]?.matchedAmount ?? 0)));
  if (statementAmount - remaining > 0.01) {
    throw new Error("This transfer side has already been matched to another statement row.");
  }

  await tx.$executeRaw`
    INSERT INTO "bank_reconciliation_matches"
      ("session_id", "bank_transaction_id", "journal_entry_line_id", "matched_amount")
    VALUES
      (${sessionId}, ${statement.id}, ${line.id}, ${statementAmount})
  `;
}

export async function postStatementBankTransfer(input: {
  bankTransactionId: string;
  otherBankAccountId: string;
}) {
  try {
    const { tenantId, userId } = await context();
    const result = await prisma.$transaction(async (tx) => {
      const statement = await getStatement(tx, tenantId, input.bankTransactionId);
      if (statement.bankAccountId === input.otherBankAccountId) {
        throw new Error("Choose a different bank account for the other side of the transfer.");
      }
      const otherBank = await getOtherBank(tx, tenantId, input.otherBankAccountId);

      if (statement.currency !== otherBank.currency) {
        throw new Error(`V1 bank transfers require the same currency on both accounts. ${statement.accountName} is ${statement.currency}; ${otherBank.accountName} is ${otherBank.currency}.`);
      }
      if (statement.currency !== statement.baseCurrency) {
        throw new Error(`FX-aware bank-transfer reconciliation is not enabled yet. For now, transfer matching is limited to ${statement.baseCurrency} bank accounts.`);
      }

      const sourceBankAccountId = statement.type === "DEBIT" ? statement.bankAccountId : otherBank.id;
      const destinationBankAccountId = statement.type === "CREDIT" ? statement.bankAccountId : otherBank.id;
      const sourceLedgerAccountId = statement.type === "DEBIT" ? statement.ledgerAccountId! : otherBank.ledgerAccountId!;
      const destinationLedgerAccountId = statement.type === "CREDIT" ? statement.ledgerAccountId! : otherBank.ledgerAccountId!;
      const amount = roundMoney(Number(statement.amount));
      const statementDate = statement.transactionDate.toISOString().slice(0, 10);

      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtext(${`finos:bank-transfer:${tenantId}:${[sourceBankAccountId, destinationBankAccountId].sort().join(":")}:${amount}`})
        )
      `;

      const candidates = await tx.$queryRaw<Array<{
        id: string;
        journalEntryId: string;
        transferNumber: string;
        reference: string | null;
      }>>`
        SELECT
          bt."id",
          bt."journal_entry_id" AS "journalEntryId",
          bt."transfer_number" AS "transferNumber",
          bt."reference"
        FROM "bank_transfers" bt
        WHERE bt."tenant_id" = ${tenantId}::uuid
          AND bt."source_bank_account_id" = ${sourceBankAccountId}
          AND bt."destination_bank_account_id" = ${destinationBankAccountId}
          AND UPPER(bt."currency") = ${statement.currency}
          AND bt."amount" = ${amount}
          AND bt."transfer_date" BETWEEN (${statementDate}::date - 3) AND (${statementDate}::date + 3)
        ORDER BY
          CASE WHEN ${statement.reference} IS NOT NULL AND bt."reference" = ${statement.reference} THEN 0 ELSE 1 END,
          ABS(bt."transfer_date" - ${statementDate}::date),
          bt."created_at" DESC
      `;

      let transferId: string;
      let journalEntryId: string;
      let transferNumber: string;

      if (candidates.length > 1) {
        const exactReference = statement.reference
          ? candidates.filter((candidate) => candidate.reference === statement.reference)
          : [];
        if (exactReference.length !== 1) {
          throw new Error("More than one existing transfer could match this statement row. Resolve this item from Bank Reconciliation instead of creating a duplicate transfer.");
        }
        transferId = exactReference[0].id;
        journalEntryId = exactReference[0].journalEntryId;
        transferNumber = exactReference[0].transferNumber;
      } else if (candidates.length === 1) {
        transferId = candidates[0].id;
        journalEntryId = candidates[0].journalEntryId;
        transferNumber = candidates[0].transferNumber;
      } else {
        transferId = randomUUID();
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:bank-transfer-number:${tenantId}`}))`;
        const countRows = await tx.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*)::bigint AS "count"
          FROM "bank_transfers"
          WHERE "tenant_id" = ${tenantId}::uuid
        `;
        transferNumber = `BTR-${String(Number(countRows[0]?.count ?? 0n) + 1).padStart(5, "0")}`;

        journalEntryId = await postJournalEntryInTransaction(tx, {
          tenantId,
          createdBy: userId,
          entryDate: statement.transactionDate,
          reference: transferNumber,
          description: `Bank transfer ${transferNumber} - ${statement.description}`,
          recognitionPeriod: getRecognitionPeriod(statement.transactionDate),
          source: "bank_transfer",
          sourceId: transferId,
          lines: [
            {
              accountId: destinationLedgerAccountId,
              description: `Transfer in - ${transferNumber}`,
              debit: amount,
              credit: 0,
            },
            {
              accountId: sourceLedgerAccountId,
              description: `Transfer out - ${transferNumber}`,
              debit: 0,
              credit: amount,
            },
          ],
        });

        await tx.$executeRaw`
          INSERT INTO "bank_transfers"
            ("id", "tenant_id", "transfer_number", "transfer_date", "source_bank_account_id", "destination_bank_account_id", "currency", "amount", "reference", "description", "journal_entry_id", "created_by")
          VALUES
            (${transferId}, ${tenantId}::uuid, ${transferNumber}, ${statementDate}::date, ${sourceBankAccountId}, ${destinationBankAccountId}, ${statement.currency}, ${amount}, ${statement.reference}, ${statement.description}, ${journalEntryId}, ${userId})
        `;
      }

      await attachStatementToTransferLine(tx, tenantId, userId, statement, journalEntryId);
      return { transferId, transferNumber, journalEntryId, reusedExisting: candidates.length > 0 };
    });

    revalidatePath("/banking/reconciliation");
    revalidatePath("/banking/accounts");
    return { success: true, ...result };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Could not record the bank transfer." };
  }
}
