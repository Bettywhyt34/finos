/**
 * Financial statement calculation helpers.
 * All figures derived from posted journal entries, filtered by recognitionPeriod.
 * IFRS 15 compliant: revenue recognised by period, not invoice date.
 */
import { prisma } from "@/lib/prisma";

export interface AccountBalance {
  accountId: string;
  code: string;
  name: string;
  type: string;
  subtype: string | null;
  balance: number;
}

const DEBIT_NORMAL = new Set(["ASSET", "EXPENSE"]);

/** Get all account balances up to (and including) the given period. */
export async function getAccountBalances(
  orgId: string,
  periodTo: string,
  periodFrom?: string
): Promise<AccountBalance[]> {
  const accounts = await prisma.chartOfAccounts.findMany({
    where: { tenantId: orgId, isActive: true },
    select: { id: true, code: true, name: true, type: true, subtype: true },
    orderBy: { code: "asc" },
  });

  const lines = await prisma.journalEntryLine.groupBy({
    by: ["accountId"],
    where: {
      entry: {
        tenantId: orgId,
        isLocked: true,
        recognitionPeriod: {
          lte: periodTo,
          ...(periodFrom ? { gte: periodFrom } : {}),
        },
      },
    },
    _sum: { debit: true, credit: true },
  });

  const lineMap = new Map(
    lines.map((l) => [
      l.accountId,
      { debit: Number(l._sum.debit ?? 0), credit: Number(l._sum.credit ?? 0) },
    ])
  );

  return accounts.map((a) => {
    const { debit = 0, credit = 0 } = lineMap.get(a.id) ?? {};
    const balance = DEBIT_NORMAL.has(a.type) ? debit - credit : credit - debit;
    return { accountId: a.id, code: a.code, name: a.name, type: a.type, subtype: a.subtype, balance };
  });
}

export function sumByType(balances: AccountBalance[], type: string): number {
  return balances.filter((b) => b.type === type).reduce((s, b) => s + b.balance, 0);
}
