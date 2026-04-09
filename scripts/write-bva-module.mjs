import fs from "fs";
import path from "path";

const root = process.cwd();

function write(rel, content) {
  const full = path.join(root, "app", "(dashboard)", rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
  console.log("Written:", rel);
}

// ─── reports/budget-vs-actual/page.tsx ────────────────────────────────────────
const bvaPage = `import { auth } from "@/lib/auth";
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
  if (!session?.user?.organizationId) redirect("/login");
  const orgId = session.user.organizationId;

  const budgets = await prisma.budget.findMany({
    where: { organizationId: orgId },
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
          organizationId: orgId,
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
            where: { id: { in: actualAccountIds }, organizationId: orgId },
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
`;

// ─── reports/budget-vs-actual/bva-export.tsx ──────────────────────────────────
const bvaExport = `"use client";

import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

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

interface BvaExportProps {
  rows: BvaRow[];
  periodFrom: string;
  periodTo: string;
  budgetName: string;
  versionLabel: string;
}

export function BvaExport({
  rows,
  periodFrom,
  periodTo,
  budgetName,
  versionLabel,
}: BvaExportProps) {
  async function handleExport() {
    const xlsx = await import("xlsx");
    const data: (string | number | null)[][] = [
      ["Budget vs Actual Report"],
      ["Budget: " + budgetName + " — Version: " + versionLabel],
      ["Period: " + periodFrom + " to " + periodTo],
      [],
      ["Account Code", "Account Name", "Type", "Budget", "Actual", "Variance", "Variance %"],
      ...rows.map((r) => [
        r.code,
        r.name,
        r.type,
        r.budget,
        r.actual,
        r.variance,
        r.variancePct !== null ? r.variancePct / 100 : null,
      ]),
    ];
    const ws = xlsx.utils.aoa_to_sheet(data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Budget vs Actual");
    xlsx.writeFile(wb, "budget-vs-actual-" + periodFrom + "-" + periodTo + ".xlsx");
  }

  return (
    <Button variant="outline" onClick={handleExport} className="flex items-center gap-2">
      <Download className="h-4 w-4" />
      Export Excel
    </Button>
  );
}
`;

// ─── settings/budgets/page.tsx ─────────────────────────────────────────────────
const budgetSettings = `import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Link from "next/link";

export default async function BudgetSettingsPage() {
  const session = await auth();
  if (!session?.user?.organizationId) redirect("/login");
  const orgId = session.user.organizationId;

  const [totalBudgets, activeBudgets, overrideLogs] = await Promise.all([
    prisma.budget.count({ where: { organizationId: orgId } }),
    prisma.budget.count({
      where: { organizationId: orgId, status: { in: ["DRAFT", "SUBMITTED", "APPROVED"] } },
    }),
    prisma.budgetOverrideLog.count({
      where: { budget: { organizationId: orgId } },
    }),
  ]);

  const recentOverrides = await prisma.budgetOverrideLog.findMany({
    where: { budget: { organizationId: orgId } },
    orderBy: { createdAt: "desc" },
    take: 5,
    include: { budget: { select: { name: true, fiscalYear: true } } },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Budget Settings</h1>
        <p className="text-sm text-slate-500 mt-1">
          Configure budgeting defaults and XpenxFlow integration
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Budgets", value: totalBudgets },
          { label: "Active Budgets", value: activeBudgets },
          { label: "Override Decisions", value: overrideLogs },
        ].map((card) => (
          <div key={card.label} className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500">{card.label}</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{card.value}</p>
          </div>
        ))}
      </div>

      {/* Approval Workflow */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-1">Approval Workflow</h2>
        <p className="text-sm text-slate-500 mb-4">
          Default workflow for all budget types.
        </p>
        <div className="flex items-center gap-3">
          {["Draft", "Submitted", "Approved", "Locked"].map((step, i) => (
            <div key={step} className="flex items-center gap-3">
              <span className="px-3 py-1.5 bg-slate-100 rounded-lg text-sm font-medium text-slate-700">
                {step}
              </span>
              {i < 3 && <span className="text-slate-400 text-lg font-light">&#8594;</span>}
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-400 mt-3">
          Configurable multi-level approval with role-based routing coming in Phase 2.
        </p>
      </div>

      {/* XpenxFlow Integration */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-1">XpenxFlow Integration</h2>
        <p className="text-sm text-slate-500 mb-4">
          How FINOS resolves budget conflicts with XpenxFlow data.
        </p>

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
          <p className="text-sm font-medium text-amber-800">Phase 1.5 — Integration Prep</p>
          <p className="text-sm text-amber-700 mt-1">
            XpenxFlow API connectivity will be configured in Phase 2. Override decisions can be
            recorded manually from each budget&#39;s detail page. All decisions are logged to the
            audit table below.
          </p>
        </div>

        <div className="space-y-2">
          {[
            { label: "Override Threshold Alert", desc: "Alert when XpenxFlow variance exceeds this %" },
            { label: "Auto-import Schedule", desc: "Automatically pull budget data from XpenxFlow" },
            { label: "Webhook URL", desc: "Receive real-time budget updates from XpenxFlow" },
            { label: "API Key", desc: "XpenxFlow API authentication token" },
          ].map((item) => (
            <div
              key={item.label}
              className="flex items-center justify-between p-3 border border-slate-200 rounded-lg"
            >
              <div>
                <p className="text-sm font-medium text-slate-700">{item.label}</p>
                <p className="text-xs text-slate-500">{item.desc}</p>
              </div>
              <span className="text-xs text-slate-400 italic bg-slate-50 px-2 py-1 rounded">
                Phase 2
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Override Audit Log */}
      {recentOverrides.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-3 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Recent Override Decisions</h2>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Budget</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Decision</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Approved By</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Date</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Diff %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {recentOverrides.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50">
                  <td className="px-6 py-3 text-sm text-slate-700">
                    <Link href={"/budgets/" + log.budgetId} className="hover:underline">
                      {log.budget.fiscalYear} — {log.budget.name}
                    </Link>
                  </td>
                  <td className="px-6 py-3">
                    <span
                      className={
                        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium " +
                        (log.overrideType === "KEEP_FINOS"
                          ? "bg-blue-50 text-blue-700"
                          : log.overrideType === "USE_EXTERNAL"
                          ? "bg-orange-50 text-orange-700"
                          : "bg-purple-50 text-purple-700")
                      }
                    >
                      {log.overrideType}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-sm text-slate-600">{log.approvedBy}</td>
                  <td className="px-6 py-3 text-sm text-slate-500">
                    {new Date(log.createdAt).toLocaleDateString("en-NG")}
                  </td>
                  <td className="px-6 py-3 text-sm text-right text-slate-600">
                    {log.differencePercent !== null ? Number(log.differencePercent).toFixed(1) + "%" : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {recentOverrides.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 text-center text-slate-500 text-sm">
          No override decisions recorded yet. Use the XpenxFlow Override button on a budget to log decisions.
        </div>
      )}
    </div>
  );
}
`;

// ─── budgets/[id]/xpenxflow-override-dialog.tsx ───────────────────────────────
const overrideDialog = `"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { recordXpenxFlowOverride } from "../actions";

interface XpenxFlowOverrideDialogProps {
  budgetId: string;
  versionId: string;
  budgetName: string;
}

type OverrideType = "KEEP_FINOS" | "USE_EXTERNAL" | "MERGE";

const OVERRIDE_OPTIONS: { value: OverrideType; label: string; desc: string }[] = [
  {
    value: "KEEP_FINOS",
    label: "Keep FINOS",
    desc: "Discard XpenxFlow data, keep the current FINOS budget as-is.",
  },
  {
    value: "USE_EXTERNAL",
    label: "Use External",
    desc: "Replace FINOS budget lines with XpenxFlow data.",
  },
  {
    value: "MERGE",
    label: "Merge",
    desc: "Accept XpenxFlow values for selected accounts, keep FINOS for others.",
  },
];

export function XpenxFlowOverrideDialog({
  budgetId,
  versionId,
  budgetName,
}: XpenxFlowOverrideDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [overrideType, setOverrideType] = useState<OverrideType>("KEEP_FINOS");
  const [notes, setNotes] = useState("");
  const [diffPercent, setDiffPercent] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const result = await recordXpenxFlowOverride({
      budgetId,
      versionId,
      overrideType,
      notes: notes.trim() || undefined,
      differencePercent: diffPercent ? parseFloat(diffPercent) : undefined,
    });
    setLoading(false);
    if ("error" in result && result.error) {
      toast.error(result.error);
    } else {
      toast.success("Override decision recorded in audit log");
      setOpen(false);
      setNotes("");
      setDiffPercent("");
      router.refresh();
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        XpenxFlow Override
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>XpenxFlow Budget Override</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-slate-500">
              Record a conflict resolution decision for{" "}
              <span className="font-medium text-slate-700">{budgetName}</span>. This creates an
              audit trail in the override log.
            </p>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Override Decision</label>
              <div className="space-y-2">
                {OVERRIDE_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className="flex items-start gap-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 has-[:checked]:border-slate-900 has-[:checked]:bg-slate-50"
                  >
                    <input
                      type="radio"
                      name="overrideType"
                      value={opt.value}
                      checked={overrideType === opt.value}
                      onChange={() => setOverrideType(opt.value)}
                      className="mt-0.5 accent-slate-900"
                    />
                    <div>
                      <p className="text-sm font-medium text-slate-700">{opt.label}</p>
                      <p className="text-xs text-slate-500">{opt.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">
                Max Difference Detected (%)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={diffPercent}
                onChange={(e) => setDiffPercent(e.target.value)}
                placeholder="e.g. 15.50"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
              />
              <p className="text-xs text-slate-400">
                Largest variance between FINOS and XpenxFlow (optional)
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Reason for this decision…"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 resize-none"
              />
            </div>

            <div className="flex gap-3 justify-end pt-2 border-t border-slate-100">
              <DialogClose render={<Button variant="outline" type="button" />}>
                Cancel
              </DialogClose>
              <Button type="submit" disabled={loading}>
                {loading ? "Recording…" : "Record Override"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
`;

write("reports/budget-vs-actual/page.tsx", bvaPage);
write("reports/budget-vs-actual/bva-export.tsx", bvaExport);
write("settings/budgets/page.tsx", budgetSettings);
write("budgets/[id]/xpenxflow-override-dialog.tsx", overrideDialog);

console.log("\nBudget vs Actual + XpenxFlow override module written.");
