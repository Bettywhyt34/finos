"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import {
  lockAccountingPeriodInTransaction,
  postJournalEntryInTransaction,
} from "@/lib/journal";

async function getOrgAndUser() {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Unauthorized");
  return {
    orgId: session.user.tenantId,
    userId: (session.user as { id?: string }).id ?? "system",
  };
}

/** Ensure AccountingPeriod rows exist for the selected year. */
export async function ensurePeriodsExist(year: number) {
  const { orgId } = await getOrgAndUser();
  for (let m = 1; m <= 12; m++) {
    const period = year + "-" + String(m).padStart(2, "0");
    await prisma.accountingPeriod.upsert({
      where: { tenantId_period: { tenantId: orgId, period } },
      create: { tenantId: orgId, year, month: m, period, isClosed: false },
      update: {},
    });
  }
  revalidatePath("/accounting/period-close");
  return { success: true };
}

export async function closePeriod(period: string) {
  try {
    const { orgId, userId } = await getOrgAndUser();

    if (!/^\d{4}-\d{2}$/.test(period)) {
      return { error: "Invalid accounting period" };
    }
    if (period.endsWith("-12")) {
      return {
        error: "December is closed through Year-End Close so retained earnings and the period lock are completed together.",
      };
    }

    await prisma.$transaction(async (tx) => {
      await lockAccountingPeriodInTransaction(tx, orgId, period);

      const current = await tx.accountingPeriod.findUnique({
        where: { tenantId_period: { tenantId: orgId, period } },
        select: { isClosed: true },
      });
      if (current?.isClosed) return;

      const draftCount = await tx.journalEntry.count({
        where: { tenantId: orgId, recognitionPeriod: period, isLocked: false },
      });
      if (draftCount > 0) {
        throw new Error(
          "Cannot close period: " + draftCount + " draft journal entr" +
          (draftCount === 1 ? "y" : "ies") + " must be posted or deleted first.",
        );
      }

      const agg = await tx.journalEntryLine.aggregate({
        where: {
          entry: { tenantId: orgId, isLocked: true, recognitionPeriod: { lte: period } },
        },
        _sum: { debit: true, credit: true },
      });
      const totalDebit = Number(agg._sum.debit ?? 0);
      const totalCredit = Number(agg._sum.credit ?? 0);
      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        throw new Error(
          "Cannot close period: trial balance is out of balance by " +
          Math.abs(totalDebit - totalCredit).toFixed(2),
        );
      }

      await tx.accountingPeriod.upsert({
        where: { tenantId_period: { tenantId: orgId, period } },
        create: {
          tenantId: orgId,
          year: parseInt(period.slice(0, 4)),
          month: parseInt(period.slice(5, 7)),
          period,
          isClosed: true,
          closedBy: userId,
          closedAt: new Date(),
        },
        update: { isClosed: true, closedBy: userId, closedAt: new Date() },
      });
    });

    revalidatePath("/accounting/period-close");
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to close period" };
  }
}

export async function reopenPeriod(period: string) {
  try {
    const { orgId } = await getOrgAndUser();

    await prisma.$transaction(async (tx) => {
      await lockAccountingPeriodInTransaction(tx, orgId, period);

      if (period.endsWith("-12")) {
        const year = period.slice(0, 4);
        const yearEndJournal = await tx.journalEntry.findFirst({
          where: { tenantId: orgId, source: "year-end-close", sourceId: year },
          select: { id: true },
        });
        if (yearEndJournal) {
          throw new Error(
            "December cannot be reopened after Year-End Close while the closing journal exists. Use a controlled year-end reversal/reopen workflow instead.",
          );
        }
      }

      await tx.accountingPeriod.update({
        where: { tenantId_period: { tenantId: orgId, period } },
        data: { isClosed: false, closedBy: null, closedAt: null },
      });
    });

    revalidatePath("/accounting/period-close");
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to reopen period" };
  }
}

/**
 * Year-end close sequence:
 * 1) January-November must already be closed.
 * 2) December must still be open.
 * 3) The year-end closing journal is posted into December.
 * 4) December is closed in the SAME database transaction.
 */
export async function yearEndClose(year: number, retainedEarningsAccountId: string) {
  try {
    const { orgId, userId } = await getOrgAndUser();
    const december = `${year}-12`;

    const result = await prisma.$transaction(async (tx) => {
      await lockAccountingPeriodInTransaction(tx, orgId, december);

      const periods = await tx.accountingPeriod.findMany({
        where: { tenantId: orgId, year },
        orderBy: { month: "asc" },
      });
      const periodByMonth = new Map(periods.map((p) => [p.month, p]));
      const missing = Array.from({ length: 12 }, (_, i) => i + 1).filter((m) => !periodByMonth.has(m));
      if (missing.length) {
        throw new Error("Create all 12 accounting periods before running Year-End Close.");
      }

      const openPriorPeriods = periods.filter((p) => p.month <= 11 && !p.isClosed);
      if (openPriorPeriods.length > 0) {
        throw new Error(
          "Close January-November first. Open: " + openPriorPeriods.map((p) => p.period).join(", "),
        );
      }

      const decemberPeriod = periodByMonth.get(12)!;
      if (decemberPeriod.isClosed) {
        throw new Error("December is already closed. Reopen it before running Year-End Close.");
      }

      const existingYearEnd = await tx.journalEntry.findFirst({
        where: { tenantId: orgId, source: "year-end-close", sourceId: String(year) },
        select: { id: true },
      });
      if (existingYearEnd) {
        throw new Error(`Year-End Close for ${year} has already been posted.`);
      }

      const retained = await tx.chartOfAccounts.findFirst({
        where: {
          id: retainedEarningsAccountId,
          tenantId: orgId,
          type: "EQUITY",
          isActive: true,
        },
        select: { id: true },
      });
      if (!retained) {
        throw new Error("Select an active Equity account belonging to this entity for Retained Earnings.");
      }

      const draftCount = await tx.journalEntry.count({
        where: { tenantId: orgId, recognitionPeriod: december, isLocked: false },
      });
      if (draftCount > 0) {
        throw new Error(
          `Cannot run Year-End Close: ${draftCount} December draft journal entr${draftCount === 1 ? "y" : "ies"} must be posted or deleted first.`,
        );
      }

      const lines = await tx.journalEntryLine.groupBy({
        by: ["accountId"],
        where: {
          entry: {
            tenantId: orgId,
            isLocked: true,
            recognitionPeriod: { gte: `${year}-01`, lte: december },
            source: { not: "year-end-close" },
          },
        },
        _sum: { debit: true, credit: true },
      });

      const accountIds = lines.map((l) => l.accountId);
      const accounts = await tx.chartOfAccounts.findMany({
        where: {
          tenantId: orgId,
          id: { in: accountIds },
          type: { in: ["INCOME", "EXPENSE"] },
        },
        select: { id: true, name: true, type: true },
      });
      const accountMap = new Map(accounts.map((a) => [a.id, a]));

      const closingLines: {
        accountId: string;
        description: string;
        debit: number;
        credit: number;
      }[] = [];
      let netToRetained = 0;

      for (const line of lines) {
        const account = accountMap.get(line.accountId);
        if (!account) continue;
        const debit = Number(line._sum.debit ?? 0);
        const credit = Number(line._sum.credit ?? 0);

        if (account.type === "INCOME") {
          const balance = credit - debit;
          if (Math.abs(balance) > 0.005) {
            closingLines.push({
              accountId: line.accountId,
              description: `Year-end close: ${account.name}`,
              debit: balance,
              credit: 0,
            });
            netToRetained += balance;
          }
        } else {
          const balance = debit - credit;
          if (Math.abs(balance) > 0.005) {
            closingLines.push({
              accountId: line.accountId,
              description: `Year-end close: ${account.name}`,
              debit: 0,
              credit: balance,
            });
            netToRetained -= balance;
          }
        }
      }

      if (closingLines.length > 0) {
        closingLines.push({
          accountId: retained.id,
          description: "Year-end close: Transfer to Retained Earnings",
          debit: netToRetained < 0 ? Math.abs(netToRetained) : 0,
          credit: netToRetained > 0 ? netToRetained : 0,
        });

        await postJournalEntryInTransaction(tx, {
          tenantId: orgId,
          createdBy: userId,
          entryDate: new Date(`${year}-12-31T12:00:00.000Z`),
          reference: `YEC-${year}`,
          description: `Year-end closing entry — ${year}`,
          recognitionPeriod: december,
          source: "year-end-close",
          sourceId: String(year),
          lines: closingLines,
        });
      }

      const agg = await tx.journalEntryLine.aggregate({
        where: {
          entry: { tenantId: orgId, isLocked: true, recognitionPeriod: { lte: december } },
        },
        _sum: { debit: true, credit: true },
      });
      const totalDebit = Number(agg._sum.debit ?? 0);
      const totalCredit = Number(agg._sum.credit ?? 0);
      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        throw new Error(
          "Cannot complete Year-End Close: trial balance is out of balance by " +
          Math.abs(totalDebit - totalCredit).toFixed(2),
        );
      }

      await tx.accountingPeriod.update({
        where: { tenantId_period: { tenantId: orgId, period: december } },
        data: { isClosed: true, closedBy: userId, closedAt: new Date() },
      });

      return { netToRetained };
    });

    revalidatePath("/accounting/period-close");
    revalidatePath("/reports/profit-loss");
    revalidatePath("/reports/balance-sheet");
    return { success: true, netToRetained: result.netToRetained };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Year-end close failed" };
  }
}
