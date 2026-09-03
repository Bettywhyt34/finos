"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

const MATCH_TOLERANCE = 0.005;

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

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function dateKey(value: Date | string) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

type BankMappingRow = {
  bankAccountId: string;
  ledgerAccountId: string | null;
  accountName: string;
  currency: string;
  baseCurrency: string;
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
};

type MatchRow = {
  id: string;
  sessionId: string;
  sessionStatus: string;
  statementFrom: Date | string;
  statementTo: Date | string;
  bankTransactionId: string;
  journalEntryLineId: string;
  matchedAmount: unknown;
  entryNumber: string;
  entryDate: Date;
  entryReference: string | null;
  entryDescription: string | null;
};

type CoverageRow = {
  id: string;
  amount: unknown;
  matchedAmount: unknown;
};

async function getBankMapping(
  tenantId: string,
  bankAccountId: string,
): Promise<ResolvedBankMapping> {
  const rows = await prisma.$queryRaw<BankMappingRow[]>`
    SELECT
      ba."id" AS "bankAccountId",
      ba."ledger_account_id" AS "ledgerAccountId",
      ba."account_name" AS "accountName",
      UPPER(ba."currency") AS "currency",
      UPPER(t."currency") AS "baseCurrency"
    FROM "bank_accounts" ba
    INNER JOIN "tenants" t ON t."id" = ba."tenant_id"
    WHERE ba."id" = ${bankAccountId}
      AND ba."tenant_id" = ${tenantId}::uuid
      AND ba."is_active" = true
    LIMIT 1
  `;
  const account = rows[0];
  if (!account) throw new Error("Bank account not found");
  if (!account.ledgerAccountId) {
    throw new Error("Map this bank account to its Chart of Accounts Bank/Cash ledger before reconciliation.");
  }
  return { ...account, ledgerAccountId: account.ledgerAccountId };
}

function matchingBlockedReason(account: ResolvedBankMapping) {
  if (account.currency === account.baseCurrency) return null;
  return `FX-aware bank reconciliation is not enabled yet. ${account.accountName} is ${account.currency}, while the FINOS ledger is ${account.baseCurrency}. Matching these amounts directly would be unsafe.`;
}

async function getLedgerClosingBalance(
  tenantId: string,
  ledgerAccountId: string,
  to: string,
) {
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

async function getOrCreateOpenSessionInTransaction(
  tx: Prisma.TransactionClient,
  tenantId: string,
  bankAccountId: string,
  from: string,
  to: string,
  statementClosingBalance: number,
) {
  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(
      hashtext(${`finos:bank-reconciliation-session:${tenantId}:${bankAccountId}:${from}:${to}`})
    )
  `;

  const completed = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "bank_reconciliation_sessions"
    WHERE "tenant_id" = ${tenantId}::uuid
      AND "bank_account_id" = ${bankAccountId}
      AND "statement_from" = ${from}::date
      AND "statement_to" = ${to}::date
      AND "status" = 'COMPLETED'
    ORDER BY "completed_at" DESC
    LIMIT 1
  `;
  if (completed[0]) throw new Error("This reconciliation period is completed and its match evidence is locked.");

  const existing = await tx.$queryRaw<Array<{ id: string }>>`
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
    await tx.$executeRaw`
      UPDATE "bank_reconciliation_sessions"
      SET "statement_closing_balance" = ${statementClosingBalance}
      WHERE "id" = ${existing[0].id}
    `;
    return existing[0].id;
  }

  const created = await tx.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "bank_reconciliation_sessions"
      ("tenant_id", "bank_account_id", "statement_from", "statement_to", "statement_closing_balance")
    VALUES
      (${tenantId}::uuid, ${bankAccountId}, ${from}::date, ${to}::date, ${statementClosingBalance})
    RETURNING "id"
  `;
  return created[0].id;
}

async function sumStatementMatches(
  tx: Prisma.TransactionClient,
  tenantId: string,
  bankAccountId: string,
  bankTransactionId: string,
) {
  const rows = await tx.$queryRaw<Array<{ matchedAmount: unknown }>>`
    SELECT COALESCE(SUM(brm."matched_amount"), 0) AS "matchedAmount"
    FROM "bank_reconciliation_matches" brm
    INNER JOIN "bank_reconciliation_sessions" brs ON brs."id" = brm."session_id"
    WHERE brs."tenant_id" = ${tenantId}::uuid
      AND brs."bank_account_id" = ${bankAccountId}
      AND brm."bank_transaction_id" = ${bankTransactionId}
  `;
  return Number(rows[0]?.matchedAmount ?? 0);
}

async function sumLedgerMatches(
  tx: Prisma.TransactionClient,
  tenantId: string,
  bankAccountId: string,
  journalEntryLineId: string,
) {
  const rows = await tx.$queryRaw<Array<{ matchedAmount: unknown }>>`
    SELECT COALESCE(SUM(brm."matched_amount"), 0) AS "matchedAmount"
    FROM "bank_reconciliation_matches" brm
    INNER JOIN "bank_reconciliation_sessions" brs ON brs."id" = brm."session_id"
    WHERE brs."tenant_id" = ${tenantId}::uuid
      AND brs."bank_account_id" = ${bankAccountId}
      AND brm."journal_entry_line_id" = ${journalEntryLineId}
  `;
  return Number(rows[0]?.matchedAmount ?? 0);
}

export async function fetchReconciliationData(bankAccountId: string, from: string, to: string) {
  try {
    const { tenantId } = await getSessionContext();
    if (!from || !to || startOfDay(to) < startOfDay(from)) {
      return { error: "Select a valid statement date range" };
    }

    const account = await getBankMapping(tenantId, bankAccountId);
    const fromDate = startOfDay(from);
    const toExclusive = endExclusive(to);

    const [transactions, ledgerLines, sessions, ledgerClosingBalance, allMatches] = await Promise.all([
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
          jel."credit"
        FROM "journal_entry_lines" jel
        INNER JOIN "journal_entries" je ON je."id" = jel."entry_id"
        WHERE je."tenant_id" = ${tenantId}::uuid
          AND jel."account_id" = ${account.ledgerAccountId}
          AND je."is_locked" = true
          AND je."entry_date" >= ${fromDate}
          AND je."entry_date" < ${toExclusive}
        ORDER BY je."entry_date" ASC, je."entry_number" ASC
      `,
      prisma.$queryRaw<Array<{
        id: string;
        status: string;
        statementClosingBalance: unknown;
        completedAt: Date | null;
        createdAt: Date;
      }>>`
        SELECT
          "id",
          "status",
          "statement_closing_balance" AS "statementClosingBalance",
          "completed_at" AS "completedAt",
          "created_at" AS "createdAt"
        FROM "bank_reconciliation_sessions"
        WHERE "tenant_id" = ${tenantId}::uuid
          AND "bank_account_id" = ${bankAccountId}
          AND "statement_from" = ${from}::date
          AND "statement_to" = ${to}::date
        ORDER BY
          CASE WHEN "status" = 'COMPLETED' THEN 0 ELSE 1 END,
          COALESCE("completed_at", "created_at") DESC
      `,
      getLedgerClosingBalance(tenantId, account.ledgerAccountId, to),
      prisma.$queryRaw<MatchRow[]>`
        SELECT
          brm."id",
          brs."id" AS "sessionId",
          brs."status" AS "sessionStatus",
          brs."statement_from" AS "statementFrom",
          brs."statement_to" AS "statementTo",
          brm."bank_transaction_id" AS "bankTransactionId",
          brm."journal_entry_line_id" AS "journalEntryLineId",
          brm."matched_amount" AS "matchedAmount",
          je."entry_number" AS "entryNumber",
          je."entry_date" AS "entryDate",
          je."reference" AS "entryReference",
          COALESCE(jel."description", je."description") AS "entryDescription"
        FROM "bank_reconciliation_matches" brm
        INNER JOIN "bank_reconciliation_sessions" brs ON brs."id" = brm."session_id"
        INNER JOIN "journal_entry_lines" jel ON jel."id" = brm."journal_entry_line_id"
        INNER JOIN "journal_entries" je ON je."id" = jel."entry_id"
        WHERE brs."tenant_id" = ${tenantId}::uuid
          AND brs."bank_account_id" = ${bankAccountId}
      `,
    ]);

    const transactionIds = new Set(transactions.map((transaction) => transaction.id));
    const ledgerLineIds = new Set(ledgerLines.map((line) => line.id));
    const relevantMatches = allMatches.filter(
      (match) => transactionIds.has(match.bankTransactionId) || ledgerLineIds.has(match.journalEntryLineId),
    );

    const matchedByStatement = new Map<string, number>();
    const matchedByLedger = new Map<string, number>();
    for (const match of relevantMatches) {
      const amount = Number(match.matchedAmount);
      matchedByStatement.set(
        match.bankTransactionId,
        (matchedByStatement.get(match.bankTransactionId) ?? 0) + amount,
      );
      matchedByLedger.set(
        match.journalEntryLineId,
        (matchedByLedger.get(match.journalEntryLineId) ?? 0) + amount,
      );
    }

    const periodMatch = (match: MatchRow) =>
      dateKey(match.statementFrom) === from &&
      dateKey(match.statementTo) === to;

    const completedSession = sessions.find((session) => session.status === "COMPLETED") ?? null;
    const openSession = sessions.find((session) => session.status === "OPEN") ?? null;
    const activeSession = completedSession ?? openSession;
    const blockedReason = matchingBlockedReason(account);

    return {
      bankAccountId,
      accountName: account.accountName,
      currency: account.currency,
      baseCurrency: account.baseCurrency,
      ledgerAccountId: account.ledgerAccountId,
      ledgerClosingBalance,
      matchingBlockedReason: blockedReason,
      completed: Boolean(completedSession),
      completedAt: completedSession?.completedAt?.toISOString() ?? null,
      statementClosingBalance: activeSession ? Number(activeSession.statementClosingBalance) : null,
      transactions: transactions.map((transaction) => {
        const amount = Number(transaction.amount);
        const matchedAmount = roundMoney(matchedByStatement.get(transaction.id) ?? 0);
        const remainingAmount = Math.max(0, roundMoney(amount - matchedAmount));
        return {
          id: transaction.id,
          transactionDate: transaction.transactionDate.toISOString(),
          description: transaction.description,
          reference: transaction.reference,
          amount,
          type: transaction.type,
          matchedAmount,
          remainingAmount,
          isFullyMatched: remainingAmount <= MATCH_TOLERANCE,
          matches: relevantMatches
            .filter((match) => match.bankTransactionId === transaction.id)
            .map((match) => ({
              id: match.id,
              journalEntryLineId: match.journalEntryLineId,
              matchedAmount: Number(match.matchedAmount),
              entryNumber: match.entryNumber,
              entryDate: match.entryDate.toISOString(),
              reference: match.entryReference,
              description: match.entryDescription,
              status: match.sessionStatus,
              canRemove: periodMatch(match) && match.sessionStatus === "OPEN",
            })),
        };
      }),
      ledgerLines: ledgerLines.map((line) => {
        const debit = Number(line.debit);
        const credit = Number(line.credit);
        const statementType =
          debit > MATCH_TOLERANCE && credit <= MATCH_TOLERANCE
            ? "CREDIT"
            : credit > MATCH_TOLERANCE && debit <= MATCH_TOLERANCE
              ? "DEBIT"
              : null;
        const eligibleAmount = statementType === "CREDIT" ? debit : statementType === "DEBIT" ? credit : 0;
        const matchedAmount = roundMoney(matchedByLedger.get(line.id) ?? 0);
        const remainingAmount = Math.max(0, roundMoney(eligibleAmount - matchedAmount));
        return {
          id: line.id,
          entryId: line.entryId,
          entryNumber: line.entryNumber,
          entryDate: line.entryDate.toISOString(),
          reference: line.reference,
          description: line.description,
          source: line.source,
          debit,
          credit,
          statementType,
          eligibleAmount,
          matchedAmount,
          remainingAmount,
          isFullyMatched: eligibleAmount > MATCH_TOLERANCE && remainingAmount <= MATCH_TOLERANCE,
        };
      }),
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
  matchedAmount?: number;
}) {
  try {
    const { tenantId } = await getSessionContext();
    if (!input.from || !input.to || startOfDay(input.to) < startOfDay(input.from)) {
      return { error: "Select a valid statement date range" };
    }
    if (!Number.isFinite(input.statementClosingBalance)) {
      return { error: "Enter the statement closing balance first" };
    }

    const account = await getBankMapping(tenantId, input.bankAccountId);
    const blockedReason = matchingBlockedReason(account);
    if (blockedReason) return { error: blockedReason };

    const result = await prisma.$transaction(async (tx) => {
      for (const lockKey of [
        `ledger:${input.journalEntryLineId}`,
        `statement:${input.bankTransactionId}`,
      ].sort()) {
        await tx.$queryRaw`
          SELECT pg_advisory_xact_lock(
            hashtext(${`finos:bank-reconciliation-match:${tenantId}:${input.bankAccountId}:${lockKey}`})
          )
        `;
      }

      const sessionId = await getOrCreateOpenSessionInTransaction(
        tx,
        tenantId,
        input.bankAccountId,
        input.from,
        input.to,
        input.statementClosingBalance,
      );

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
      if (oppositeAmount > MATCH_TOLERANCE || ledgerAmount <= MATCH_TOLERANCE) {
        throw new Error(
          statement.type === "CREDIT"
            ? "A Money In statement row can only match a debit in the bank ledger."
            : "A Money Out statement row can only match a credit in the bank ledger.",
        );
      }

      const [statementMatched, ledgerMatched] = await Promise.all([
        sumStatementMatches(tx, tenantId, input.bankAccountId, statement.id),
        sumLedgerMatches(tx, tenantId, input.bankAccountId, ledger[0].id),
      ]);
      const statementRemaining = Math.max(0, roundMoney(statementAmount - statementMatched));
      const ledgerRemaining = Math.max(0, roundMoney(ledgerAmount - ledgerMatched));

      if (statementRemaining <= MATCH_TOLERANCE) throw new Error("This statement row is already fully matched.");
      if (ledgerRemaining <= MATCH_TOLERANCE) throw new Error("This FINOS ledger line is already fully matched.");

      const automaticAmount = Math.min(statementRemaining, ledgerRemaining);
      const allocationAmount =
        input.matchedAmount == null ? automaticAmount : roundMoney(Number(input.matchedAmount));

      if (!Number.isFinite(allocationAmount) || allocationAmount <= MATCH_TOLERANCE) {
        throw new Error("Match amount must be greater than zero.");
      }
      if (allocationAmount - statementRemaining > MATCH_TOLERANCE) {
        throw new Error(`Match amount exceeds the statement amount remaining (${statementRemaining.toFixed(2)}).`);
      }
      if (allocationAmount - ledgerRemaining > MATCH_TOLERANCE) {
        throw new Error(`Match amount exceeds the FINOS ledger amount remaining (${ledgerRemaining.toFixed(2)}).`);
      }

      const existingPair = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "bank_reconciliation_matches"
        WHERE "session_id" = ${sessionId}
          AND "bank_transaction_id" = ${statement.id}
          AND "journal_entry_line_id" = ${ledger[0].id}
        LIMIT 1
      `;

      if (existingPair[0]) {
        await tx.$executeRaw`
          UPDATE "bank_reconciliation_matches"
          SET "matched_amount" = "matched_amount" + ${allocationAmount}
          WHERE "id" = ${existingPair[0].id}
        `;
      } else {
        await tx.$executeRaw`
          INSERT INTO "bank_reconciliation_matches"
            ("session_id", "bank_transaction_id", "journal_entry_line_id", "matched_amount")
          VALUES
            (${sessionId}, ${statement.id}, ${ledger[0].id}, ${allocationAmount})
        `;
      }

      const remainingAfter = Math.max(0, roundMoney(statementRemaining - allocationAmount));
      await tx.bankTransaction.update({
        where: { id: statement.id },
        data: { isReconciled: remainingAfter <= MATCH_TOLERANCE },
      });

      return { matchedAmount: allocationAmount, remainingAmount: remainingAfter };
    });

    revalidatePath("/banking/reconciliation");
    return { success: true, ...result };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Failed to match transaction" };
  }
}

export async function unmatchReconciliationItem(matchId: string) {
  try {
    const { tenantId } = await getSessionContext();
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{
        id: string;
        sessionId: string;
        bankAccountId: string;
        statementFrom: Date | string;
        statementTo: Date | string;
        bankTransactionId: string;
        journalEntryLineId: string;
      }>>`
        SELECT
          brm."id",
          brs."id" AS "sessionId",
          brs."bank_account_id" AS "bankAccountId",
          brs."statement_from" AS "statementFrom",
          brs."statement_to" AS "statementTo",
          brm."bank_transaction_id" AS "bankTransactionId",
          brm."journal_entry_line_id" AS "journalEntryLineId"
        FROM "bank_reconciliation_matches" brm
        INNER JOIN "bank_reconciliation_sessions" brs ON brs."id" = brm."session_id"
        WHERE brm."id" = ${matchId}
          AND brs."tenant_id" = ${tenantId}::uuid
        LIMIT 1
      `;
      const match = rows[0];
      if (!match) throw new Error("Match allocation not found");

      for (const lockKey of [
        `ledger:${match.journalEntryLineId}`,
        `statement:${match.bankTransactionId}`,
      ].sort()) {
        await tx.$queryRaw`
          SELECT pg_advisory_xact_lock(
            hashtext(${`finos:bank-reconciliation-match:${tenantId}:${match.bankAccountId}:${lockKey}`})
          )
        `;
      }

      const statementFrom = dateKey(match.statementFrom);
      const statementTo = dateKey(match.statementTo);
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtext(${`finos:bank-reconciliation-session:${tenantId}:${match.bankAccountId}:${statementFrom}:${statementTo}`})
        )
      `;

      const liveSession = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT "status"
        FROM "bank_reconciliation_sessions"
        WHERE "id" = ${match.sessionId}
          AND "tenant_id" = ${tenantId}::uuid
        LIMIT 1
      `;
      if (!liveSession[0]) throw new Error("Reconciliation session no longer exists");
      if (liveSession[0].status === "COMPLETED") {
        throw new Error("Completed reconciliations cannot be changed");
      }

      await tx.$executeRaw`
        DELETE FROM "bank_reconciliation_matches"
        WHERE "id" = ${match.id}
      `;

      const statement = await tx.bankTransaction.findFirst({
        where: { id: match.bankTransactionId, bankAccountId: match.bankAccountId },
        select: { id: true, amount: true },
      });
      if (!statement) throw new Error("Statement transaction no longer exists");

      const matchedAmount = await sumStatementMatches(
        tx,
        tenantId,
        match.bankAccountId,
        match.bankTransactionId,
      );
      const remaining = Math.max(0, roundMoney(Number(statement.amount) - matchedAmount));
      await tx.bankTransaction.update({
        where: { id: statement.id },
        data: { isReconciled: remaining <= MATCH_TOLERANCE },
      });
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
    if (!input.from || !input.to || startOfDay(input.to) < startOfDay(input.from)) {
      return { error: "Select a valid statement date range" };
    }
    if (!Number.isFinite(input.statementClosingBalance)) {
      return { error: "Enter the statement closing balance" };
    }

    const account = await getBankMapping(tenantId, input.bankAccountId);
    const blockedReason = matchingBlockedReason(account);
    if (blockedReason) return { error: blockedReason };

    const existingCompleted = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "bank_reconciliation_sessions"
      WHERE "tenant_id" = ${tenantId}::uuid
        AND "bank_account_id" = ${input.bankAccountId}
        AND "statement_from" = ${input.from}::date
        AND "statement_to" = ${input.to}::date
        AND "status" = 'COMPLETED'
      LIMIT 1
    `;
    if (existingCompleted[0]) return { success: true };

    const ledgerClosingBalance = await getLedgerClosingBalance(
      tenantId,
      account.ledgerAccountId,
      input.to,
    );
    if (Math.abs(ledgerClosingBalance - input.statementClosingBalance) > MATCH_TOLERANCE) {
      return {
        error: `Statement and ledger closing balances differ by ${Math.abs(
          ledgerClosingBalance - input.statementClosingBalance,
        ).toFixed(2)}`,
      };
    }

    await prisma.$transaction(async (tx) => {
      const sessionId = await getOrCreateOpenSessionInTransaction(
        tx,
        tenantId,
        input.bankAccountId,
        input.from,
        input.to,
        input.statementClosingBalance,
      );

      const coverage = await tx.$queryRaw<CoverageRow[]>`
        SELECT
          bt."id",
          bt."amount",
          COALESCE(SUM(brm."matched_amount"), 0) AS "matchedAmount"
        FROM "bank_transactions" bt
        LEFT JOIN "bank_reconciliation_matches" brm
          ON brm."bank_transaction_id" = bt."id"
         AND brm."session_id" = ${sessionId}
        WHERE bt."bank_account_id" = ${input.bankAccountId}
          AND bt."transaction_date" >= ${startOfDay(input.from)}
          AND bt."transaction_date" < ${endExclusive(input.to)}
        GROUP BY bt."id", bt."amount"
      `;

      if (!coverage.length) {
        throw new Error("There are no imported statement transactions in this period.");
      }

      const incomplete = coverage.filter(
        (row) => Math.abs(Number(row.amount) - Number(row.matchedAmount)) > MATCH_TOLERANCE,
      );
      if (incomplete.length) {
        throw new Error(
          `${incomplete.length} statement item${incomplete.length === 1 ? " is" : "s are"} not fully matched.`,
        );
      }

      await tx.$executeRaw`
        UPDATE "bank_reconciliation_sessions"
        SET
          "statement_closing_balance" = ${input.statementClosingBalance},
          "status" = 'COMPLETED',
          "completed_at" = now(),
          "completed_by" = ${userId}
        WHERE "id" = ${sessionId}
          AND "status" = 'OPEN'
      `;

      await tx.bankTransaction.updateMany({
        where: {
          bankAccountId: input.bankAccountId,
          transactionDate: { gte: startOfDay(input.from), lt: endExclusive(input.to) },
        },
        data: { isReconciled: true },
      });
    });

    revalidatePath("/banking/reconciliation");
    return { success: true };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Failed to complete reconciliation" };
  }
}
