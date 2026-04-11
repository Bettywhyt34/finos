import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { BvaExport } from "./bva-export";

interface BvaRow {
  accountId: string;
  code: string;
  name: string;
  type: string;
  budget: number;
  actual: number;
  variance: number;
  variancePct: number | null;
}

const DEBIT_NORMAL = new Set(["ASSET", "EXPENSE"]);

function fmt(n: number): string {
  return n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pct(v: number | null): string {
  if (v === null) return "—";
  return (v >= 0 ? "+" : "") + v.toFixed(1) + "%";
}

export default async function BvaPage({
  searchParams,
}: {
  searchParams: { budgetId?: string; versionId?: string; periodFrom?: string; periodTo?: string };
}) {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");
  const orgId = session.user.tenantId;

  const budgets = await prisma.budget.findMany({
    where: { tenantId: orgId },
    include: { versions: { orderBy: { versionNumber: "asc" } } },
    orderBy: [{ fiscalYear: "desc" }, { name: "asc" }],
  });

  const selectedBudgetId = searchParams.budgetId;
  const selectedVersionId = searchParams.versionId;
  const selectedBudget = selectedBudgetId ? budgets.find((b) => b.id === selectedBudgetId) : null;
  const selectedVersion =
    selectedBudget && selectedVersionId
      ? selectedBudget.versions.find((v) => v.id === selectedVersionId)
      : (selectedBudget?.versions.find((v) => v.status === "APPROVED" || v.status === "LOCKED") ??
          selectedBudget?.versions[0]);

  const periodFrom =
    searchParams.periodFrom ?? (selectedBudget ? String(selectedBudget.fiscalYear) + "-01" : "");
  const periodTo =
    searchParams.periodTo ?? (selectedBudget ? String(selectedBudget.fiscalYear) + "-12" : "");

  let rows: BvaRow[] = [];
  let totalBudgetIncome = 0,
    totalActualIncome = 0;
  let totalBudgetExpense = 0,
    totalActualExpense = 0;

  if (selectedBudget && selectedVersion && periodFrom && periodTo) {
    const budgetLines = await prisma.budgetLine.findMany({
      where: { budgetVersionId: selectedVersion.id },
      include: { account: { select: { id: true, code: true, name: true, type: true } } },
    });

    const budgetByAccount = new Map<
      string,
      { account: { id: string; code: string; name: string; type: string }; total: number }
    >();
    for (const line of budgetLines) {
      if (line.period >= periodFrom && line.period <= periodTo) {
        const existing = budgetByAccount.get(line.accountId);
        if (existing) {
          existing.total += Number(line.amount);
        } else {
          budgetByAccount.set(line.accountId, { account: line.account, total: Number(line.amount) });
        }
      }
    }

    const actualLines = await prisma.journalEntryLine.groupBy({
      by: ["accountId"],
      where: {
        entry: {
          tenantId: orgId,
          isLocked: true,
          recognitionPeriod: { gte: periodFrom, lte: periodTo },
        },
      },
      _sum: { debit: true, credit: true },
    });

    const actualAccountIds = actualLines.map((l) => l.accountId);
    const actualAccounts =
      actualAccountIds.length > 0
        ? await prisma.chartOfAccounts.findMany({
            where: { id: { in: actualAccountIds }, tenantId: orgId },
            select: { id: true, type: true },
          })
        : [];
    const actualTypeMap = new Map(actualAccounts.map((a) => [a.id, a.type]));

    const actualByAccount = new Map<string, number>();
    for (const line of actualLines) {
      const type = actualTypeMap.get(line.accountId);
      if (!type) continue;
      const debit = Number(line._sum.debit ?? 0);
      const credit = Number(line._sum.credit ?? 0);
      const balance = DEBIT_NORMAL.has(type) ? debit - credit : credit - debit;
      actualByAccount.set(line.accountId, balance);
    }

    rows = Array.from(budgetByAccount.entries())
      .map(([accountId, { account, total: budget }]) => {
        const actual = actualByAccount.get(accountId) ?? 0;
        const variance = budget - actual;
        const variancePct = budget !== 0 ? (variance / Math.abs(budget)) * 100 : null;
        return {
          accountId,
          code: account.code,
          name: account.name,
          type: account.type,
          budget,
          actual,
          variance,
          variancePct,
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code));

    for (const row of rows) {
      if (row.type === "INCOME") {
        totalBudgetIncome += row.budget;
        totalActualIncome += row.actual;
      }
      if (row.type === "EXPENSE") {
        totalBudgetExpense += row.budget;
        totalActualExpense += row.actual;
      }
    }
  }

  const incomeRows = rows.filter((r) => r.type === "INCOME");
  const expenseRows = rows.filter((r) => r.type === "EXPENSE");
  const netBudget = totalBudgetIncome - totalBudgetExpense;
  const netActual = totalActualIncome - totalActualExpense;
  const netVariance = netBudget - netActual;
  const netVariancePct = netBudget !== 0 ? (netVariance / Math.abs(netBudget)) * 100 : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Budget vs Actual</h1>
          <p className="text-sm text-slate-500 mt-1">
            Compare budgeted amounts against posted journal entries
          </p>
        </div>
        {rows.length > 0 && (
          <BvaExport
            rows={rows}
            periodFrom={periodFrom}
            periodTo={periodTo}
            budgetName={selectedBudget?.name ?? ""}
            versionLabel={selectedVersion?.label ?? ""}
          />
        )}
      </div>

      {/* Filter bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <form className="flex flex-wrap gap-4 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Budget</label>
            <select
              name="budgetId"
              defaultValue={selectedBudgetId ?? ""}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-300 min-w-[220px]"
            >
              <option value="">Select a budget…</option>
              {budgets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.fiscalYear} — {b.name} ({b.type})
                </option>
              ))}
            </select>
          </div>
          {selectedBudget && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">Version</label>
              <select
                name="versionId"
                defaultValue={selectedVersion?.id ?? ""}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
              >
                {selectedBudget.versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.versionNumber} — {v.label} ({v.status})
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">From Period</label>
            <input
              type="month"
              name="periodFrom"
              defaultValue={periodFrom}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">To Period</label>
            <input
              type="month"
              name="periodTo"
              defaultValue={periodTo}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-slate-900 text-white text-sm rounded-lg hover:bg-slate-700 transition-colors"
          >
            Apply
          </button>
        </form>
      </div>

      {!selectedBudget && (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-slate-500">
          Select a budget above to view the comparison.
        </div>
      )}

      {selectedBudget && rows.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-slate-500">
          No budget lines found for the selected period range.{" "}
          <Link href={"/budgets/" + (selectedBudget?.id ?? "")} className="underline text-slate-700">
            Go to budget
          </Link>{" "}
          to add lines.
        </div>
      )}

      {rows.length > 0 && (
        <div className="space-y-6">
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Net Budget", value: fmt(netBudget), sub: "Revenue minus Expenses" },
              { label: "Net Actual", value: fmt(netActual), sub: "Revenue minus Expenses" },
              {
                label: "Budget Revenue",
                value: fmt(totalBudgetIncome),
                sub: "vs " + fmt(totalActualIncome) + " actual",
              },
              {
                label: "Budget Expenses",
                value: fmt(totalBudgetExpense),
                sub: "vs " + fmt(totalActualExpense) + " actual",
              },
            ].map((card) => (
              <div key={card.label} className="bg-white border border-slate-200 rounded-xl p-4">
                <p className="text-xs text-slate-500">{card.label}</p>
                <p className="text-xl font-bold text-slate-900 mt-1">{card.value}</p>
                <p className="text-xs text-slate-400 mt-0.5">{card.sub}</p>
              </div>
            ))}
          </div>

          {/* Revenue section */}
          {incomeRows.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-6 py-3 bg-slate-50 border-b border-slate-200">
                <h2 className="text-sm font-semibold text-slate-700">Revenue</h2>
              </div>
              <BvaTable rows={incomeRows} fmt={fmt} pct={pct} />
              <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 grid grid-cols-[1fr_repeat(4,140px)] gap-2 text-sm font-semibold text-slate-700">
                <span>Total Revenue</span>
                <span className="text-right">{fmt(totalBudgetIncome)}</span>
                <span className="text-right">{fmt(totalActualIncome)}</span>
                <span
                  className={
                    totalBudgetIncome - totalActualIncome >= 0
                      ? "text-right text-green-600"
                      : "text-right text-red-600"
                  }
                >
                  {fmt(totalBudgetIncome - totalActualIncome)}
                </span>
                <span
                  className={
                    totalBudgetIncome - totalActualIncome >= 0
                      ? "text-right text-green-600"
                      : "text-right text-red-600"
                  }
                >
                  {pct(
                    totalBudgetIncome !== 0
                      ? ((totalBudgetIncome - totalActualIncome) / Math.abs(totalBudgetIncome)) * 100
                      : null
                  )}
                </span>
              </div>
            </div>
          )}

          {/* Expenses section */}
          {expenseRows.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-6 py-3 bg-slate-50 border-b border-slate-200">
                <h2 className="text-sm font-semibold text-slate-700">Expenses</h2>
              </div>
              <BvaTable rows={expenseRows} fmt={fmt} pct={pct} />
              <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 grid grid-cols-[1fr_repeat(4,140px)] gap-2 text-sm font-semibold text-slate-700">
                <span>Total Expenses</span>
                <span className="text-right">{fmt(totalBudgetExpense)}</span>
                <span className="text-right">{fmt(totalActualExpense)}</span>
                <span
                  className={
                    totalBudgetExpense - totalActualExpense >= 0
                      ? "text-right text-green-600"
                      : "text-right text-red-600"
                  }
                >
                  {fmt(totalBudgetExpense - totalActualExpense)}
                </span>
                <span
                  className={
                    totalBudgetExpense - totalActualExpense >= 0
                      ? "text-right text-green-600"
                      : "text-right text-red-600"
                  }
                >
                  {pct(
                    totalBudgetExpense !== 0
                      ? ((totalBudgetExpense - totalActualExpense) / Math.abs(totalBudgetExpense)) * 100
                      : null
                  )}
                </span>
              </div>
            </div>
          )}

          {/* Net Income row */}
          <div className="bg-white border-2 border-slate-300 rounded-xl overflow-hidden">
            <div className="px-6 py-4 grid grid-cols-[1fr_repeat(4,140px)] gap-2 text-sm font-bold text-slate-900">
              <span>Net Income</span>
              <span className="text-right">{fmt(netBudget)}</span>
              <span className="text-right">{fmt(netActual)}</span>
              <span
                className={netVariance >= 0 ? "text-right text-green-600" : "text-right text-red-600"}
              >
                {fmt(netVariance)}
              </span>
              <span
                className={netVariance >= 0 ? "text-right text-green-600" : "text-right text-red-600"}
              >
                {pct(netVariancePct)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BvaTable({
  rows,
  fmt,
  pct,
}: {
  rows: BvaRow[];
  fmt: (n: number) => string;
  pct: (v: number | null) => string;
}) {
  return (
    <table className="w-full">
      <thead>
        <tr className="border-b border-slate-100">
          <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
            Account
          </th>
          <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wide w-36">
            Budget
          </th>
          <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wide w-36">
            Actual
          </th>
          <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wide w-36">
            Variance
          </th>
          <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wide w-20">
            Var %
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-50">
        {rows.map((row) => (
          <tr key={row.accountId} className="hover:bg-slate-50">
            <td className="px-6 py-3 text-sm text-slate-700">
              <span className="text-slate-400 text-xs mr-2">{row.code}</span>
              <Link
                href={"/reports/general-ledger?accountId=" + row.accountId}
                className="hover:underline"
              >
                {row.name}
              </Link>
            </td>
            <td className="px-6 py-3 text-sm text-right text-slate-600">{fmt(row.budget)}</td>
            <td className="px-6 py-3 text-sm text-right text-slate-600">{fmt(row.actual)}</td>
            <td
              className={
                "px-6 py-3 text-sm text-right font-medium " +
                (row.variance >= 0 ? "text-green-600" : "text-red-600")
              }
            >
              {fmt(row.variance)}
            </td>
            <td
              className={
                "px-6 py-3 text-sm text-right " +
                (row.variance >= 0 ? "text-green-600" : "text-red-600")
              }
            >
              {pct(row.variancePct)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
