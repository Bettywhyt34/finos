import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { PeriodCloseActions } from "./period-close-actions";

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default async function PeriodClosePage(
  props: {
    searchParams: Promise<{ year?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const session = await auth();
  const orgId = session?.user?.tenantId;
  if (!orgId) return null;

  const year = parseInt(searchParams.year ?? String(new Date().getFullYear()));

  const [periods, yearEndJournal] = await Promise.all([
    prisma.accountingPeriod.findMany({
      where: { tenantId: orgId, year },
      orderBy: { month: "asc" },
    }),
    prisma.journalEntry.findFirst({
      where: { tenantId: orgId, source: "year-end-close", sourceId: String(year) },
      select: { id: true, entryNumber: true, entryDate: true },
    }),
  ]);

  // Draft entry counts per period
  const draftCounts = await prisma.journalEntry.groupBy({
    by: ["recognitionPeriod"],
    where: {
      tenantId: orgId,
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
      tenantId: orgId,
      recognitionPeriod: { gte: year + "-01", lte: year + "-12" },
    },
    _count: { id: true },
  });
  const entryMap = new Map(entryCounts.map((d) => [d.recognitionPeriod, d._count.id]));

  // Equity accounts for year-end close
  const equityAccounts = await prisma.chartOfAccounts.findMany({
    where: { tenantId: orgId, type: "EQUITY", isActive: true },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });

  // Build 12-month grid (missing rows are displayed as open until created).
  const periodMap = new Map(periods.map((p) => [p.period, p]));
  const allMonths = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const period = year + "-" + String(m).padStart(2, "0");
    return periodMap.get(period) ?? { period, month: m, year, isClosed: false, closedBy: null, closedAt: null, id: null };
  });

  const priorMonthsClosed = allMonths.slice(0, 11).every((m) => m.isClosed);
  const december = allMonths[11];
  const yearEndPosted = Boolean(yearEndJournal);
  const canRunYearEnd = priorMonthsClosed && !december.isClosed && !yearEndPosted;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Accounting Period Management</h1>
          <p className="text-sm text-muted-foreground">
            Close periods to lock accounting activity. Year-End Close posts retained earnings and closes December together.
          </p>
        </div>
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
              const isDecember = p.month === 12;
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
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                        {isDecember && yearEndPosted ? "Year-end closed" : "Closed"}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">Open</span>
                    )}
                  </td>
                  <td className="p-3 text-muted-foreground text-xs">{p.closedBy ?? "—"}</td>
                  <td className="p-3 text-muted-foreground text-xs">
                    {p.closedAt ? new Date(p.closedAt).toLocaleDateString("en-NG") : "—"}
                  </td>
                  <td className="p-3 text-center">
                    {isDecember && yearEndPosted ? (
                      <span className="text-xs font-medium text-emerald-700">Year-End Close complete</span>
                    ) : isDecember && !p.isClosed ? (
                      <span className="text-xs text-muted-foreground">Use Year-End Close below</span>
                    ) : (
                      <PeriodCloseActions
                        period={p.period}
                        isClosed={p.isClosed}
                        hasDrafts={drafts > 0}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border p-5 space-y-3">
        <h2 className="font-semibold">Year-End Close — {year}</h2>
        <p className="text-sm text-muted-foreground">
          Transfers the year&apos;s net profit or loss to Retained Earnings, resets income and expense accounts,
          then closes December in the same accounting transaction.
        </p>

        {yearEndPosted ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Year-End Close completed{yearEndJournal?.entryNumber ? ` — ${yearEndJournal.entryNumber}` : ""}.
            December is locked.
          </div>
        ) : canRunYearEnd ? (
          <PeriodCloseActions
            period={String(year)}
            isClosed={false}
            hasDrafts={false}
            isYearEnd
            equityAccounts={equityAccounts}
          />
        ) : !priorMonthsClosed ? (
          <p className="text-sm text-amber-600 font-medium">
            Close January through November {year} before running Year-End Close. Keep December open.
          </p>
        ) : december.isClosed ? (
          <p className="text-sm text-amber-600 font-medium">
            December is closed without a Year-End Close journal. Reopen December, then run Year-End Close.
          </p>
        ) : (
          <p className="text-sm text-amber-600 font-medium">Year-End Close is not available.</p>
        )}
      </div>
    </div>
  );
}
