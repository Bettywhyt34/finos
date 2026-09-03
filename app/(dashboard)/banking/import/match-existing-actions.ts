"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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
    throw new Error("You do not have permission to match bank statement activity.");
  }
  return { tenantId, userId };
}

type StatementRow = {
  id: string;
  bankAccountId: string;
  transactionDate: Date;
  amount: Prisma.Decimal;
  type: "CREDIT" | "DEBIT";
  journalEntryId: string | null;
  currency: string;
  baseCurrency: string;
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
      bt."amount",
      bt."type"::text AS "type",
      bt."journal_entry_id" AS "journalEntryId",
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
  if (!statement.ledgerAccountId) throw new Error("Map this bank account to its Bank/Cash ledger before matching.");
  if (statement.currency !== statement.baseCurrency) {
    throw new Error(`FX-aware statement matching is not enabled yet. This bank account is ${statement.currency}, while FINOS ledger evidence is ${statement.baseCurrency}.`);
  }
  if (statement.journalEntryId) {
    throw new Error("This statement row already has accounting evidence. Match Existing is only for statement activity that was recorded in FINOS before the statement was imported.");
  }
  return statement;
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
    SELECT pg_advisory_xact_lock(
      hashtext(${`finos:bank-statement-review:${tenantId}:${statement.bankAccountId}`})
    )
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

async function matchedOnLedger(
  tx: Prisma.TransactionClient,
  tenantId: string,
  bankAccountId: string,
  journalEntryLineId: string,
  excludingStatementId: string,
) {
  const rows = await tx.$queryRaw<Array<{ matchedAmount: unknown }>>`
    SELECT COALESCE(SUM(brm."matched_amount"), 0) AS "matchedAmount"
    FROM "bank_reconciliation_matches" brm
    INNER JOIN "bank_reconciliation_sessions" brs ON brs."id" = brm."session_id"
    WHERE brs."tenant_id" = ${tenantId}::uuid
      AND brs."bank_account_id" = ${bankAccountId}
      AND brm."journal_entry_line_id" = ${journalEntryLineId}
      AND brm."bank_transaction_id" <> ${excludingStatementId}
  `;
  return Number(rows[0]?.matchedAmount ?? 0);
}

export async function matchStatementExisting(input: {
  bankTransactionId: string;
  allocations: { journalEntryLineId: string; amount: number }[];
}) {
  try {
    const { tenantId, userId } = await context();
    const allocations = input.allocations
      .map((allocation) => ({
        journalEntryLineId: allocation.journalEntryLineId,
        amount: roundMoney(Number(allocation.amount)),
      }))
      .filter((allocation) => allocation.amount > TOLERANCE);

    if (!allocations.length) return { error: "Choose at least one existing FINOS transaction to match." };
    if (new Set(allocations.map((allocation) => allocation.journalEntryLineId)).size !== allocations.length) {
      return { error: "The same FINOS ledger line cannot be selected twice." };
    }

    const result = await prisma.$transaction(async (tx) => {
      const statement = await getStatement(tx, tenantId, input.bankTransactionId);
      const statementAmount = roundMoney(Number(statement.amount));
      const total = roundMoney(allocations.reduce((sum, allocation) => sum + allocation.amount, 0));
      if (Math.abs(total - statementAmount) > 0.01) {
        throw new Error(`Matched total must equal the statement amount (${statementAmount.toFixed(2)} ${statement.currency}).`);
      }

      for (const lockKey of [
        `statement:${statement.id}`,
        ...allocations.map((allocation) => `ledger:${allocation.journalEntryLineId}`),
      ].sort()) {
        await tx.$queryRaw`
          SELECT pg_advisory_xact_lock(
            hashtext(${`finos:bank-match-existing:${tenantId}:${statement.bankAccountId}:${lockKey}`})
          )
        `;
      }

      const targetSessionId = await getTargetSession(tx, tenantId, userId, statement);

      await tx.$executeRaw`
        DELETE FROM "bank_reconciliation_matches" brm
        USING "bank_reconciliation_sessions" brs
        WHERE brm."session_id" = brs."id"
          AND brm."bank_transaction_id" = ${statement.id}
          AND brs."tenant_id" = ${tenantId}::uuid
          AND brs."bank_account_id" = ${statement.bankAccountId}
          AND brs."status" IN ('REVIEW', 'OPEN')
      `;

      const lineIds = allocations.map((allocation) => allocation.journalEntryLineId);
      const lines = await tx.$queryRaw<Array<{
        id: string;
        debit: unknown;
        credit: unknown;
      }>>`
        SELECT jel."id", jel."debit", jel."credit"
        FROM "journal_entry_lines" jel
        INNER JOIN "journal_entries" je ON je."id" = jel."entry_id"
        WHERE je."tenant_id" = ${tenantId}::uuid
          AND jel."account_id" = ${statement.ledgerAccountId}
          AND je."is_locked" = true
          AND jel."id" IN (${Prisma.join(lineIds)})
      `;
      if (lines.length !== lineIds.length) throw new Error("One or more selected FINOS transactions are no longer available for this bank account.");
      const lineMap = new Map(lines.map((line) => [line.id, line]));

      for (const allocation of allocations) {
        const line = lineMap.get(allocation.journalEntryLineId)!;
        const lineAmount = statement.type === "CREDIT" ? Number(line.debit) : Number(line.credit);
        const opposite = statement.type === "CREDIT" ? Number(line.credit) : Number(line.debit);
        if (opposite > TOLERANCE || lineAmount <= TOLERANCE) {
          throw new Error(statement.type === "CREDIT"
            ? "A Money In statement row can only match FINOS bank-ledger debits."
            : "A Money Out statement row can only match FINOS bank-ledger credits.");
        }
        const alreadyMatched = await matchedOnLedger(
          tx,
          tenantId,
          statement.bankAccountId,
          allocation.journalEntryLineId,
          statement.id,
        );
        const remaining = Math.max(0, roundMoney(lineAmount - alreadyMatched));
        if (allocation.amount - remaining > 0.01) {
          throw new Error(`A selected FINOS transaction only has ${remaining.toFixed(2)} ${statement.currency} available to match.`);
        }
      }

      for (const allocation of allocations) {
        await tx.$executeRaw`
          INSERT INTO "bank_reconciliation_matches"
            ("session_id", "bank_transaction_id", "journal_entry_line_id", "matched_amount")
          VALUES
            (${targetSessionId}, ${statement.id}, ${allocation.journalEntryLineId}, ${allocation.amount})
        `;
      }

      return { matchedAmount: total };
    });

    revalidatePath("/banking/reconciliation");
    return { success: true, ...result };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Could not match existing FINOS transactions." };
  }
}
