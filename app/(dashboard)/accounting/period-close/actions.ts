"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";

async function getOrgAndUser() {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Unauthorized");
  return {
    orgId: session.user.tenantId,
    userId: (session.user as { id?: string }).id ?? "system",
  };
}

/** Ensure AccountingPeriod rows exist for the current year */
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

    // Check for unposted (draft) entries in this period
    const draftCount = await prisma.journalEntry.count({
      where: { tenantId: orgId, recognitionPeriod: period, isLocked: false },
    });
    if (draftCount > 0) {
      return {
        error:
          "Cannot close period: " + draftCount + " draft journal entr" +
          (draftCount === 1 ? "y" : "ies") + " must be posted or deleted first.",
      };
    }

    // Validate trial balance (total debits = total credits)
    const agg = await prisma.journalEntryLine.aggregate({
      where: {
        entry: { tenantId: orgId, isLocked: true, recognitionPeriod: { lte: period } },
      },
      _sum: { debit: true, credit: true },
    });
    const totalDebit = Number(agg._sum.debit ?? 0);
    const totalCredit = Number(agg._sum.credit ?? 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      return {
        error: "Cannot close period: trial balance is out of balance by " +
          Math.abs(totalDebit - totalCredit).toFixed(2),
      };
    }

    await prisma.accountingPeriod.upsert({
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

    revalidatePath("/accounting/period-close");
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to close period" };
  }
}

export async function reopenPeriod(period: string) {
  try {
    const { orgId } = await getOrgAndUser();
    await prisma.accountingPeriod.update({
      where: { tenantId_period: { tenantId: orgId, period } },
      data: { isClosed: false, closedBy: null, closedAt: null },
    });
    revalidatePath("/accounting/period-close");
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to reopen period" };
  }
}

/** Year-end close: create closing entries (net profit → retained earnings) */
export async function yearEndClose(year: number, retainedEarningsAccountId: string) {
  try {
    const { orgId, userId } = await getOrgAndUser();

    // Check all 12 periods of the year are closed
    const periods = await prisma.accountingPeriod.findMany({
      where: { tenantId: orgId, year },
    });
    const openPeriods = periods.filter((p) => !p.isClosed);
    if (openPeriods.length > 0) {
      return {
        error: "Close all " + year + " periods first. Open: " + openPeriods.map((p) => p.period).join(", "),
      };
    }

    // Get all income/expense account balances for the year
    const lines = await prisma.journalEntryLine.groupBy({
      by: ["accountId"],
      where: {
        entry: {
          tenantId: orgId,
          isLocked: true,
          recognitionPeriod: { gte: year + "-01", lte: year + "-12" },
        },
      },
      _sum: { debit: true, credit: true },
    });

    const accountIds = lines.map((l) => l.accountId);
    const accounts = await prisma.chartOfAccounts.findMany({
      where: { id: { in: accountIds }, type: { in: ["INCOME", "EXPENSE"] } },
      select: { id: true, code: true, name: true, type: true },
    });
    const accountMap = new Map(accounts.map((a) => [a.id, a]));

    const closingLines: { accountId: string; description: string; debit: number; credit: number }[] = [];
    let netToRetained = 0;

    for (const l of lines) {
      const acct = accountMap.get(l.accountId);
      if (!acct) continue;
      const debit = Number(l._sum.debit ?? 0);
      const credit = Number(l._sum.credit ?? 0);
      // Close income accounts (credit balance → debit to zero)
      if (acct.type === "INCOME") {
        const balance = credit - debit;
        if (Math.abs(balance) > 0.005) {
          closingLines.push({
            accountId: l.accountId,
            description: "Year-end close: " + acct.name,
            debit: balance,
            credit: 0,
          });
          netToRetained += balance;
        }
      }
      // Close expense accounts (debit balance → credit to zero)
      if (acct.type === "EXPENSE") {
        const balance = debit - credit;
        if (Math.abs(balance) > 0.005) {
          closingLines.push({
            accountId: l.accountId,
            description: "Year-end close: " + acct.name,
            debit: 0,
            credit: balance,
          });
          netToRetained -= balance;
        }
      }
    }

    if (closingLines.length === 0) {
      return { error: "No income/expense balances to close" };
    }

    // Offset goes to retained earnings
    closingLines.push({
      accountId: retainedEarningsAccountId,
      description: "Year-end close: Transfer to Retained Earnings",
      debit: netToRetained < 0 ? Math.abs(netToRetained) : 0,
      credit: netToRetained > 0 ? netToRetained : 0,
    });

    // Create closing journal entry
    const count = await prisma.journalEntry.count({ where: { tenantId: orgId } });
    const entryNumber = "YEC-" + year + "-" + String(count + 1).padStart(4, "0");

    await prisma.journalEntry.create({
      data: {
        tenantId: orgId,
        entryNumber,
        entryDate: new Date(year + "-12-31"),
        reference: "YEC-" + year,
        description: "Year-end closing entry — " + year,
        recognitionPeriod: year + "-12",
        isLocked: true,
        source: "year-end-close",
        sourceId: String(year),
        createdBy: userId,
        lines: { create: closingLines },
      },
    });

    revalidatePath("/accounting/period-close");
    return { success: true, netToRetained };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Year-end close failed" };
  }
}
