import fs from "fs";
import path from "path";

const root = process.cwd();
const pcDir = path.join(root, "app", "(dashboard)", "accounting", "period-close");
fs.mkdirSync(pcDir, { recursive: true });

// ─── Period Close Actions ─────────────────────────────────────────────────────
const actions = `"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";

async function getOrgAndUser() {
  const session = await auth();
  if (!session?.user?.organizationId) throw new Error("Unauthorized");
  return {
    orgId: session.user.organizationId,
    userId: (session.user as { id?: string }).id ?? "system",
  };
}

/** Ensure AccountingPeriod rows exist for the current year */
export async function ensurePeriodsExist(year: number) {
  const { orgId } = await getOrgAndUser();
  for (let m = 1; m <= 12; m++) {
    const period = year + "-" + String(m).padStart(2, "0");
    await prisma.accountingPeriod.upsert({
      where: { organizationId_period: { organizationId: orgId, period } },
      create: { organizationId: orgId, year, month: m, period, isClosed: false },
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
      where: { organizationId: orgId, recognitionPeriod: period, isLocked: false },
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
        entry: { organizationId: orgId, isLocked: true, recognitionPeriod: { lte: period } },
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
      where: { organizationId_period: { organizationId: orgId, period } },
      create: {
        organizationId: orgId,
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
      where: { organizationId_period: { organizationId: orgId, period } },
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
      where: { organizationId: orgId, year },
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
          organizationId: orgId,
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
    const count = await prisma.journalEntry.count({ where: { organizationId: orgId } });
    const entryNumber = "YEC-" + year + "-" + String(count + 1).padStart(4, "0");

    await prisma.journalEntry.create({
      data: {
        organizationId: orgId,
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
`;

fs.writeFileSync(path.join(pcDir, "actions.ts"), actions);
console.log("Written: period-close/actions.ts");

// ─── Period Close Page ────────────────────────────────────────────────────────
const pcPage = `import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { PeriodCloseActions } from "./period-close-actions";

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default async function PeriodClosePage({
  searchParams,
}: {
  searchParams: { year?: string };
}) {
  const session = await auth();
  const orgId = session?.user?.organizationId;
  if (!orgId) return null;

  const year = parseInt(searchParams.year ?? String(new Date().getFullYear()));

  const periods = await prisma.accountingPeriod.findMany({
    where: { organizationId: orgId, year },
    orderBy: { month: "asc" },
  });

  // Draft entry counts per period
  const draftCounts = await prisma.journalEntry.groupBy({
    by: ["recognitionPeriod"],
    where: {
      organizationId: orgId,
      isLocked: false,
      recognitionPeriod: { gte: year + "-01", lte: year + "-12" },
    },
    _count: { id: true },
  });
  const draftMap = new Map(draftCounts.map((d) => [d.recognitionPeriod, d._count.id]));

  // Entry counts per period
  const entryCounts = await prisma.journalEntry.groupBy({
    by: ["recognitionPeriod"],
    where: {
      organizationId: orgId,
      recognitionPeriod: { gte: year + "-01", lte: year + "-12" },
    },
    _count: { id: true },
  });
  const entryMap = new Map(entryCounts.map((d) => [d.recognitionPeriod, d._count.id]));

  // Equity accounts for year-end close
  const equityAccounts = await prisma.chartOfAccounts.findMany({
    where: { organizationId: orgId, type: "EQUITY", isActive: true },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });

  // Build 12-month grid (create missing months as virtual open periods)
  const periodMap = new Map(periods.map((p) => [p.period, p]));
  const allMonths = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const period = year + "-" + String(m).padStart(2, "0");
    return periodMap.get(period) ?? { period, month: m, year, isClosed: false, closedBy: null, closedAt: null, id: null };
  });

  const allClosed = allMonths.every((m) => m.isClosed);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Accounting Period Management</h1>
          <p className="text-sm text-muted-foreground">
            Close periods to lock entries. Year-end close transfers net profit to retained earnings.
          </p>
        </div>
        {/* Year selector */}
        <form method="GET" className="flex items-center gap-2">
          <select name="year" defaultValue={year}
            className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm">
            {[year - 1, year, year + 1].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button type="submit"
            className="inline-flex h-9 items-center rounded-md border border-input bg-background px-4 text-sm hover:bg-accent">
            Go
          </button>
        </form>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 font-medium">Period</th>
              <th className="text-right p-3 font-medium">Entries</th>
              <th className="text-right p-3 font-medium">Drafts</th>
              <th className="text-left p-3 font-medium">Status</th>
              <th className="text-left p-3 font-medium">Closed By</th>
              <th className="text-left p-3 font-medium">Closed At</th>
              <th className="p-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {allMonths.map((p) => {
              const drafts = draftMap.get(p.period) ?? 0;
              const entries = entryMap.get(p.period) ?? 0;
              return (
                <tr key={p.period} className="border-t">
                  <td className="p-3 font-medium">
                    {MONTH_NAMES[p.month]} {p.year}
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{p.period}</span>
                  </td>
                  <td className="p-3 text-right text-muted-foreground">{entries}</td>
                  <td className="p-3 text-right">
                    {drafts > 0 ? (
                      <span className="text-amber-600 font-medium">{drafts}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="p-3">
                    {p.isClosed ? (
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">Closed</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">Open</span>
                    )}
                  </td>
                  <td className="p-3 text-muted-foreground text-xs">{p.closedBy ?? "—"}</td>
                  <td className="p-3 text-muted-foreground text-xs">
                    {p.closedAt ? new Date(p.closedAt).toLocaleDateString("en-NG") : "—"}
                  </td>
                  <td className="p-3">
                    <PeriodCloseActions
                      period={p.period}
                      isClosed={p.isClosed}
                      hasDrafts={drafts > 0}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Year-end close */}
      <div className="rounded-lg border p-5 space-y-3">
        <h2 className="font-semibold">Year-End Close — {year}</h2>
        <p className="text-sm text-muted-foreground">
          Transfers net profit/loss to Retained Earnings and resets income/expense accounts.
          All 12 periods must be closed first.
        </p>
        {allClosed ? (
          <PeriodCloseActions
            period={String(year)}
            isClosed={false}
            hasDrafts={false}
            isYearEnd
            equityAccounts={equityAccounts}
          />
        ) : (
          <p className="text-sm text-amber-600 font-medium">
            Close all {year} periods before running year-end close.
          </p>
        )}
      </div>
    </div>
  );
}
`;

fs.writeFileSync(path.join(pcDir, "page.tsx"), pcPage);
console.log("Written: period-close/page.tsx");

// ─── Period Close Actions (client) ────────────────────────────────────────────
const pcActions = `"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { closePeriod, reopenPeriod, yearEndClose, ensurePeriodsExist } from "./actions";
import { toast } from "sonner";

interface EquityAccount { id: string; code: string; name: string; }

interface Props {
  period: string;
  isClosed: boolean;
  hasDrafts: boolean;
  isYearEnd?: boolean;
  equityAccounts?: EquityAccount[];
}

export function PeriodCloseActions({ period, isClosed, hasDrafts, isYearEnd, equityAccounts = [] }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showYearEnd, setShowYearEnd] = useState(false);
  const [retainedId, setRetainedId] = useState("");

  function handleClose() {
    if (!confirm("Close period " + period + "? This will lock all entries.")) return;
    startTransition(async () => {
      // Ensure period exists in DB first
      await ensurePeriodsExist(parseInt(period.slice(0, 4)));
      const result = await closePeriod(period);
      if ("error" in result) { toast.error(result.error); return; }
      toast.success("Period " + period + " closed");
      router.refresh();
    });
  }

  function handleReopen() {
    if (!confirm("Reopen period " + period + "? Entries can be modified again.")) return;
    startTransition(async () => {
      const result = await reopenPeriod(period);
      if ("error" in result) { toast.error(result.error); return; }
      toast.success("Period " + period + " reopened");
      router.refresh();
    });
  }

  function handleYearEnd() {
    if (!retainedId) { toast.error("Select Retained Earnings account"); return; }
    startTransition(async () => {
      const result = await yearEndClose(parseInt(period), retainedId);
      if ("error" in result) { toast.error(result.error); return; }
      toast.success("Year-end close complete. Net transferred: " + (result as { netToRetained: number }).netToRetained?.toFixed(2));
      setShowYearEnd(false);
      router.refresh();
    });
  }

  if (isYearEnd) {
    return (
      <>
        <Button type="button" onClick={() => setShowYearEnd(true)} disabled={isPending}>
          Run Year-End Close
        </Button>
        <Dialog open={showYearEnd} onOpenChange={setShowYearEnd}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Year-End Close {period}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">
                All income and expense account balances will be zeroed and transferred to the
                selected Retained Earnings account.
              </p>
              <div className="space-y-1">
                <Label>Retained Earnings Account *</Label>
                <Select value={retainedId} onValueChange={(v) => setRetainedId(v ?? "")}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select equity account" />
                  </SelectTrigger>
                  <SelectContent>
                    {equityAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.code} — {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <DialogClose render={<Button variant="outline" type="button" />}>
                Cancel
              </DialogClose>
              <Button type="button" onClick={handleYearEnd} disabled={isPending || !retainedId}>
                {isPending ? "Processing..." : "Confirm Year-End Close"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  if (isClosed) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={handleReopen} disabled={isPending}>
        Reopen
      </Button>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      onClick={handleClose}
      disabled={isPending || hasDrafts}
      title={hasDrafts ? "Post or delete draft entries first" : undefined}
    >
      {isPending ? "Closing..." : "Close Period"}
    </Button>
  );
}
`;

fs.writeFileSync(path.join(pcDir, "period-close-actions.tsx"), pcActions);
console.log("Written: period-close/period-close-actions.tsx");

console.log("\nPeriod Close module written.");
