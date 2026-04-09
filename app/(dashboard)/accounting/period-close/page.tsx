import { prisma } from "@/lib/prisma";
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
