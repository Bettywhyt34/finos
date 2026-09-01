"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

async function getSessionContext() {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  const userId = session?.user?.id;
  if (!tenantId || !userId) throw new Error("Unauthorized");
  return { tenantId, userId };
}

function startOfDay(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid statement date");
  return date;
}

function endExclusive(value: string) {
  const date = startOfDay(value);
  date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

type BankMappingRow = {
  bankAccountId: string;
  ledgerAccountId: string | null;
  accountName: string;
  currency: string;
};

type ResolvedBankMapping = Omit<BankMappingRow, "ledgerAccountId"> & { ledgerAccountId: string };

type LedgerLineRow = {
  id: string;
  entryId: string;
  entryNumber: string;
  entryDate: Date;
  reference: string | null;
  description: string | null;
  source: string | null;
  debit: unknown;
  credit: unknown;
  matchedBankTransactionId: string | null;
};

async function getBankMapping(tenantId: string, bankAccountId: string): Promise<ResolvedBankMapping> {
  const rows = await prisma.$queryRaw<BankMappingRow[]>`
    SELECT
      ba."id" AS "bankAccountId",
      ba."ledger_account_id" AS "ledgerAccountId",
      ba."account_name" AS "accountName",
      ba."currency"
    FROM "bank_accounts" ba
    WHERE ba."id" = ${bankAccountId}
      AND ba."tenant_id" = ${tenantId}::uuid
    LIMIT 1
  `;
  const account = rows[0];
  if (!account) throw new Error("Bank account not found");
  if (!account.ledgerAccountId) {
    throw new Error("Map this bank account to its Chart of Accounts Bank/Cash ledger before reconciliation.");
  }
  return { ...account, ledgerAccountId: account.ledgerAccountId };
}

async function getLedgerClosingBalance(tenantId: string, ledgerAccountId: string, to: string) {
  const rows = await prisma.$queryRaw<Array<{ balance: unknown }>>`
    SELECT COALESCE(SUM(jel."debit" - jel."credit"), 0) AS "balance"
    FROM "journal_entry_lines" jel
    INNER JOIN "journal_entries" je ON je."id" = jel."entry_id"
    WHERE je."tenant_id" = ${tenantId}::uuid
      AND jel."account_id" = ${ledgerAccountId}
      AND je."is_locked" = true
      AND je."entry_date" < ${endExclusive(to)}
  `;
  return Number(rows[0]?.balance ?? 0);
}

async function getOrCreateOpenSession(
  tenantId: string,
  bankAccountId: string,
  from: string,
  to: string,
  statementClosingBalance: number,
) {
  const existing = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "bank_reconciliation_sessions"
    WHERE "tenant_id" = ${tenantId}::uuid
      AND "bank_account_id" = ${bankAccountId}
      AND "statement_from" = ${from}::date
      AND "statement_to" = ${to}::date
      AND "status" = 'OPEN'
    ORDER BY "created_at" DESC
    LIMIT 1
  `;
  if (existing[0]) {
    await prisma.$executeRaw`
      UPDATE "bank_reconciliation_sessions"
      SET "statement_closing_balance" = ${statementClosingBalance}
      WHERE "id" = ${existing[0].id}
    `;
    return existing[0].id;
  }

  const created = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "bank_reconciliation_sessions"
      ("tenant_id", "bank_account_id", "statement_from", "statement_to", "statement_closing_balance")
    VALUES
      (${tenantId}::uuid, ${bankAccountId}, ${from}::date, ${to}::date, ${statementClosingBalance})
    RETURNING "id"
  `;
  return created[0].id;
}

export async function fetchReconciliationData(bankAccountId: string, from: string, to: string) {
  try {
    const { tenantId } = await getSessionContext();
    if (!from || !to || startOfDay(to) < startOfDay(from)) return { error: "Select a valid statement date range" };

    const account = await getBankMapping(tenantId, bankAccountId);
    const fromDate = startOfDay(from);
    const toExclusive = endExclusive(to);

    const [transactions, ledgerLines, completed, ledgerClosingBalance] = await Promise.all([
      prisma.bankTransaction.findMany({
        where: {
          bankAccountId,
          transactionDate: { gte: fromDate, lt: toExclusive },
        },
        orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }],
      }),
      prisma.$queryRaw<LedgerLineRow[]>`
        SELECT
          jel."id",
          je."id" AS "entryId",
          je."entry_number" AS "entryNumber",
          je."entry_date" AS "entryDate",
          je."reference",
          COALESCE(jel."description", je."description") AS "description",
          je."source",
          jel."debit",
          jel."credit",
          brm."bank_transaction_id" AS "matchedBankTransactionId"
        FROM "journal_entry_lines" jel
        INNER JOIN "journal_entries" je ON je."id" = jel."entry_id"
        LEFT JOIN "bank_reconciliation_matches" brm
          ON brm."journal_entry_line_id" = jel."id"
        WHERE je."tenant_id" = ${tenantId}::uuid
          AND jel."account_id" = ${account.ledgerAccountId}
          AND je."is_locked" = true
          AND je."entry_date" >= ${fromDate}
          AND je."entry_date" < ${toExclusive}
        ORDER BY je."entry_date" ASC, je."entry_number" ASC
      `,
      prisma.$queryRaw<Array<{ id: string; statementClosingBalance: unknown; completedAt: Date | null }>>`
        SELECT "id", "statement_closing_balance" AS "statementClosingBalance", "completed_at" AS "completedAt"
        FROM "bank_reconciliation_sessions"
        WHERE "tenant_id" = ${tenantId}::uuid
          AND "bank_account_id" = ${bankAccountId}
          AND "statement_from" = ${from}::date
          AND "statement_to" = ${to}::date
          AND "status" = 'COMPLETED'
        ORDER BY "completed_at" DESC
        LIMIT 1
      `,
      getLedgerClosingBalance(tenantId, account.ledgerAccountId, to),
    ]);

    const matchedRows = await prisma.$queryRaw<Array<{ bankTransactionId: string; journalEntryLineId: string }>>`
      SELECT brm."bank_transaction_id" AS "bankTransactionId", brm."journal_entry_line_id" AS "journalEntryLineId"
      FROM "bank_reconciliation_matches" brm
      INNER JOIN "bank_reconciliation_sessions" brs ON brs."id" = brm."session_id"
      WHERE brs."tenant_id" = ${tenantId}::uuid
        AND brs."bank_account_id" = ${bankAccountId}
        AND brs."statement_from" = ${from}::date
        AND brs."statement_to" = ${to}::date
    `;
    const matchByStatement = new Map(matchedRows.map((row) => [row.bankTransactionId, row.journalEntryLineId]));

    return {
      bankAccountId,
      accountName: account.accountName,
      currency: account.currency,
      ledgerAccountId: account.ledgerAccountId,
      ledgerClosingBalance,
      completed: Boolean(completed[0]),
      completedAt: completed[0]?.completedAt?.toISOString() ?? null,
      statementClosingBalance: completed[0] ? Number(completed[0].statementClosingBalance) : null,
      transactions: transactions.map((transaction) => ({
        id: transaction.id,
        transactionDate: transaction.transactionDate.toISOString(),
        description: transaction.description,
        reference: transaction.reference,
        amount: Number(transaction.amount),
        type: transaction.type,
        matchedJournalLineId: matchByStatement.get(transaction.id) ?? null,
      })),
      ledgerLines: ledgerLines.map((line) => ({
        id: line.id,
        entryId: line.entryId,
        entryNumber: line.entryNumber,
        entryDate: line.entryDate.toISOString(),
        reference: line.reference,
        description: line.description,
        source: line.source,
        debit: Number(line.debit),
        credit: Number(line.credit),
        matchedBankTransactionId: line.matchedBankTransactionId,
      })),
    };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Failed to load reconciliation" };
  }
}

export async function matchReconciliationItem(input: {
  bankAccountId: string;
  from: string;
  to: string;
  statementClosingBalance: number;
  bankTransactionId: string;
  journalEntryLineId: string;
}) {
  try {
    const { tenantId } = await getSessionContext();
    const account = await getBankMapping(tenantId, input.bankAccountId);
    if (!Number.isFinite(input.statementClosingBalance)) return { error: "Enter the statement closing balance first" };

    await prisma.$transaction(async (tx) => {
      const statement = await tx.bankTransaction.findFirst({
        where: {
          id: input.bankTransactionId,
          bankAccountId: input.bankAccountId,
          transactionDate: { gte: startOfDay(input.from), lt: endExclusive(input.to) },
        },
        select: { id: true, amount: true, type: true },
      });
      if (!statement) throw new Error("Statement transaction not found in this reconciliation period");

      const ledger = await tx.$queryRaw<Array<{ id: string; debit: unknown; credit: unknown }>>`
        SELECT jel."id", jel."debit", jel."credit"
        FROM "journal_entry_lines" jel
        INNER JOIN "journal_entries" je ON je."id" = jel."entry_id"
        WHERE jel."id" = ${input.journalEntryLineId}
          AND je."tenant_id" = ${tenantId}::uuid
          AND jel."account_id" = ${account.ledgerAccountId}
          AND je."is_locked" = true
          AND je."entry_date" >= ${startOfDay(input.from)}
          AND je."entry_date" < ${endExclusive(input.to)}
        LIMIT 1
      `;
      if (!ledger[0]) throw new Error("Ledger line not found in this bank account and period");

      const statementAmount = Number(statement.amount);
      const ledgerAmount = statement.type === "CREDIT" ? Number(ledger[0].debit) : Number(ledger[0].credit);
      const oppositeAmount = statement.type === "CREDIT" ? Number(ledger[0].credit) : Number(ledger[0].debit);
      if (oppositeAmount > 0.005) {
        throw new Error(statement.type === "CREDIT" ? "A bank credit must match a debit in the bank ledger" : "A bank debit must match a credit in the bank ledger");
      }
      if (Math.abs(statementAmount - ledgerAmount) > 0.005) {
        throw new Error("Statement and ledger amounts must match exactly");
      }

      const existingMatch = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "bank_reconciliation_matches"
        WHERE "bank_transaction_id" = ${statement.id}
           OR "journal_entry_line_id" = ${ledger[0].id}
        LIMIT 1
      `;
      if (existingMatch.length) throw new Error("One of these items is already matched");

      const sessionId = await (async () => {
        const rows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "bank_reconciliation_sessions"
          WHERE "tenant_id" = ${tenantId}::uuid
            AND "bank_account_id" = ${input.bankAccountId}
            AND "statement_from" = ${input.from}::date
            AND "statement_to" = ${input.to}::date
            AND "status" = 'OPEN'
          ORDER BY "created_at" DESC LIMIT 1
        `;
        if (rows[0]) {
          await tx.$executeRaw`UPDATE "bank_reconciliation_sessions" SET "statement_closing_balance" = ${input.statementClosingBalance} WHERE "id" = ${rows[0].id}`;
          return rows[0].id;
        }
        const created = await tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO "bank_reconciliation_sessions"
            ("tenant_id", "bank_account_id", "statement_from", "statement_to", "statement_closing_balance")
          VALUES (${tenantId}::uuid, ${input.bankAccountId}, ${input.from}::date, ${input.to}::date, ${input.statementClosingBalance})
          RETURNING "id"
        `;
        return created[0].id;
      })();

      await tx.$executeRaw`
        INSERT INTO "bank_reconciliation_matches"
          ("session_id", "bank_transaction_id", "journal_entry_line_id", "matched_amount")
        VALUES (${sessionId}, ${statement.id}, ${ledger[0].id}, ${statementAmount})
      `;
      await tx.bankTransaction.update({ where: { id: statement.id }, data: { isReconciled: true } });
    });

    revalidatePath("/banking/reconciliation");
    return { success: true };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Failed to match transaction" };
  }
}

export async function unmatchReconciliationItem(bankTransactionId: string) {
  try {
    const { tenantId } = await getSessionContext();
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT brm."id", brs."status"
        FROM "bank_reconciliation_matches" brm
        INNER JOIN "bank_reconciliation_sessions" brs ON brs."id" = brm."session_id"
        WHERE brm."bank_transaction_id" = ${bankTransactionId}
          AND brs."tenant_id" = ${tenantId}::uuid
        LIMIT 1
      `;
      if (!rows[0]) throw new Error("Match not found");
      if (rows[0].status === "COMPLETED") throw new Error("Completed reconciliations cannot be changed");
      await tx.$executeRaw`DELETE FROM "bank_reconciliation_matches" WHERE "id" = ${rows[0].id}`;
      await tx.bankTransaction.update({ where: { id: bankTransactionId }, data: { isReconciled: false } });
    });
    revalidatePath("/banking/reconciliation");
    return { success: true };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Failed to remove match" };
  }
}

export async function completeReconciliation(input: {
  bankAccountId: string;
  from: string;
  to: string;
  statementClosingBalance: number;
}) {
  try {
    const { tenantId, userId } = await getSessionContext();
    const account = await getBankMapping(tenantId, input.bankAccountId);
    if (!Number.isFinite(input.statementClosingBalance)) return { error: "Enter the statement closing balance" };

    const ledgerClosingBalance = await getLedgerClosingBalance(tenantId, account.ledgerAccountId, input.to);
    if (Math.abs(ledgerClosingBalance - input.statementClosingBalance) > 0.005) {
      return { error: `Statement and ledger closing balances differ by ${Math.abs(ledgerClosingBalance - input.statementClosingBalance).toFixed(2)}` };
    }

    const statementRows = await prisma.bankTransaction.count({
      where: {
        bankAccountId: input.bankAccountId,
        transactionDate: { gte: startOfDay(input.from), lt: endExclusive(input.to) },
      },
    });
    const matchedRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS "count"
      FROM "bank_reconciliation_matches" brm
      INNER JOIN "bank_reconciliation_sessions" brs ON brs."id" = brm."session_id"
      WHERE brs."tenant_id" = ${tenantId}::uuid
        AND brs."bank_account_id" = ${input.bankAccountId}
        AND brs."statement_from" = ${input.from}::date
        AND brs."statement_to" = ${input.to}::date
        AND brs."status" = 'OPEN'
    `;
    if (Number(matchedRows[0]?.count ?? 0) !== statementRows) {
      return { error: "Match every bank statement transaction before completing reconciliation" };
    }

    const sessionId = await getOrCreateOpenSession(tenantId, input.bankAccountId, input.from, input.to, input.statementClosingBalance);
    await prisma.$executeRaw`
      UPDATE "bank_reconciliation_sessions"
      SET "status" = 'COMPLETED', "completed_at" = CURRENT_TIMESTAMP, "completed_by" = ${userId}
      WHERE "id" = ${sessionId}
    `;

    revalidatePath("/banking/reconciliation");
    return { success: true, ledgerClosingBalance };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Failed to complete reconciliation" };
  }
}
