import fs from "fs";
import path from "path";

const root = process.cwd();

// ─── Shared: lib/statements.ts ────────────────────────────────────────────────
const statementsLib = `/**
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
    where: { organizationId: orgId, isActive: true },
    select: { id: true, code: true, name: true, type: true, subtype: true },
    orderBy: { code: "asc" },
  });

  const lines = await prisma.journalEntryLine.groupBy({
    by: ["accountId"],
    where: {
      entry: {
        organizationId: orgId,
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
`;

fs.mkdirSync(path.join(root, "lib"), { recursive: true });
fs.writeFileSync(path.join(root, "lib", "statements.ts"), statementsLib);
console.log("Written: lib/statements.ts");

// ─── P&L ──────────────────────────────────────────────────────────────────────
const pnlDir = path.join(root, "app", "(dashboard)", "reports", "profit-loss");
fs.mkdirSync(pnlDir, { recursive: true });

const pnlPage = `import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { getAccountBalances, sumByType } from "@/lib/statements";
import { formatCurrency } from "@/lib/utils";
import { PnLExport } from "./pnl-export";

function pct(current: number, prior: number): string {
  if (prior === 0) return current > 0 ? "N/A" : "—";
  return ((current - prior) / Math.abs(prior) * 100).toFixed(1) + "%";
}

export default async function ProfitLossPage({
  searchParams,
}: {
  searchParams: { periodFrom?: string; periodTo?: string; compare?: string };
}) {
  const session = await auth();
  const orgId = session?.user?.organizationId;
  if (!orgId) return null;

  const today = new Date().toISOString().slice(0, 7);
  const periodTo = searchParams.periodTo ?? today;
  const yearStart = periodTo.slice(0, 4) + "-01";
  const periodFrom = searchParams.periodFrom ?? yearStart;

  // Prior period: same duration, one year back
  const priorFrom = (parseInt(periodFrom.slice(0, 4)) - 1) + periodFrom.slice(4);
  const priorTo = (parseInt(periodTo.slice(0, 4)) - 1) + periodTo.slice(4);

  const [currentBalances, priorBalances] = await Promise.all([
    getAccountBalances(orgId, periodTo, periodFrom),
    getAccountBalances(orgId, priorTo, priorFrom),
  ]);

  const currentIncome = currentBalances.filter((b) => b.type === "INCOME");
  const currentExpense = currentBalances.filter((b) => b.type === "EXPENSE");
  const priorIncomeMap = new Map(
    priorBalances.filter((b) => b.type === "INCOME").map((b) => [b.accountId, b.balance])
  );
  const priorExpenseMap = new Map(
    priorBalances.filter((b) => b.type === "EXPENSE").map((b) => [b.accountId, b.balance])
  );

  const totalRevenue = sumByType(currentBalances, "INCOME");
  const totalExpenses = sumByType(currentBalances, "EXPENSE");
  const netProfit = totalRevenue - totalExpenses;

  const priorRevenue = sumByType(priorBalances, "INCOME");
  const priorExpenses = sumByType(priorBalances, "EXPENSE");
  const priorNetProfit = priorRevenue - priorExpenses;

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Profit & Loss Statement</h1>
          <p className="text-sm text-muted-foreground">
            Period: {periodFrom} to {periodTo} &mdash; recognition-period based (IFRS 15)
          </p>
        </div>
        <PnLExport
          currentIncome={currentIncome}
          currentExpense={currentExpense}
          totalRevenue={totalRevenue}
          totalExpenses={totalExpenses}
          netProfit={netProfit}
          periodFrom={periodFrom}
          periodTo={periodTo}
        />
      </div>

      {/* Period selector */}
      <form method="GET" className="flex gap-3 items-end flex-wrap">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">From Period</label>
          <input type="month" name="periodFrom" defaultValue={periodFrom}
            className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">To Period</label>
          <input type="month" name="periodTo" defaultValue={periodTo}
            className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm" />
        </div>
        <button type="submit"
          className="inline-flex items-center justify-center h-9 rounded-md border border-input bg-background px-4 text-sm hover:bg-accent">
          Apply
        </button>
      </form>

      {/* KPI row */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Revenue", value: totalRevenue, prior: priorRevenue },
          { label: "Total Expenses", value: totalExpenses, prior: priorExpenses },
          { label: "Net Profit", value: netProfit, prior: priorNetProfit, highlight: true },
        ].map((kpi) => (
          <div key={kpi.label} className={"rounded-lg border p-4 " + (kpi.highlight ? (netProfit >= 0 ? "bg-green-50" : "bg-red-50") : "")}>
            <p className="text-xs text-muted-foreground mb-1">{kpi.label}</p>
            <p className={"text-2xl font-bold " + (kpi.highlight ? (kpi.value >= 0 ? "text-green-700" : "text-red-700") : "")}>
              {formatCurrency(kpi.value)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Prior: {formatCurrency(kpi.prior)} &nbsp;
              <span className={kpi.value >= kpi.prior ? "text-green-600" : "text-red-600"}>
                ({pct(kpi.value, kpi.prior)})
              </span>
            </p>
          </div>
        ))}
      </div>

      {/* Revenue */}
      <div className="rounded-lg border overflow-hidden">
        <div className="p-3 border-b bg-muted/30 font-semibold text-sm flex justify-between">
          <span>Revenue</span>
          <span className="text-muted-foreground font-normal text-xs">vs Prior Period</span>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 font-medium">Account</th>
              <th className="text-right p-3 font-medium">Current</th>
              <th className="text-right p-3 font-medium">Prior</th>
              <th className="text-right p-3 font-medium">Change %</th>
            </tr>
          </thead>
          <tbody>
            {currentIncome.filter((b) => b.balance !== 0).map((b) => {
              const prior = priorIncomeMap.get(b.accountId) ?? 0;
              return (
                <tr key={b.accountId} className="border-t hover:bg-muted/20">
                  <td className="p-3">
                    <span className="font-mono text-xs text-muted-foreground mr-2">{b.code}</span>
                    {b.name}
                  </td>
                  <td className="p-3 text-right">{formatCurrency(b.balance)}</td>
                  <td className="p-3 text-right text-muted-foreground">{formatCurrency(prior)}</td>
                  <td className={"p-3 text-right text-xs " + (b.balance >= prior ? "text-green-600" : "text-red-600")}>
                    {pct(b.balance, prior)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t bg-muted/30 font-semibold">
            <tr>
              <td className="p-3">Total Revenue</td>
              <td className="p-3 text-right">{formatCurrency(totalRevenue)}</td>
              <td className="p-3 text-right text-muted-foreground">{formatCurrency(priorRevenue)}</td>
              <td className={"p-3 text-right text-xs " + (totalRevenue >= priorRevenue ? "text-green-600" : "text-red-600")}>
                {pct(totalRevenue, priorRevenue)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Expenses */}
      <div className="rounded-lg border overflow-hidden">
        <div className="p-3 border-b bg-muted/30 font-semibold text-sm">Expenses</div>
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 font-medium">Account</th>
              <th className="text-right p-3 font-medium">Current</th>
              <th className="text-right p-3 font-medium">Prior</th>
              <th className="text-right p-3 font-medium">Change %</th>
            </tr>
          </thead>
          <tbody>
            {currentExpense.filter((b) => b.balance !== 0).map((b) => {
              const prior = priorExpenseMap.get(b.accountId) ?? 0;
              return (
                <tr key={b.accountId} className="border-t hover:bg-muted/20">
                  <td className="p-3">
                    <span className="font-mono text-xs text-muted-foreground mr-2">{b.code}</span>
                    {b.name}
                  </td>
                  <td className="p-3 text-right">{formatCurrency(b.balance)}</td>
                  <td className="p-3 text-right text-muted-foreground">{formatCurrency(prior)}</td>
                  <td className={"p-3 text-right text-xs " + (b.balance <= prior ? "text-green-600" : "text-red-600")}>
                    {pct(b.balance, prior)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t bg-muted/30 font-semibold">
            <tr>
              <td className="p-3">Total Expenses</td>
              <td className="p-3 text-right">{formatCurrency(totalExpenses)}</td>
              <td className="p-3 text-right text-muted-foreground">{formatCurrency(priorExpenses)}</td>
              <td className={"p-3 text-right text-xs " + (totalExpenses <= priorExpenses ? "text-green-600" : "text-red-600")}>
                {pct(totalExpenses, priorExpenses)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Net Profit Summary */}
      <div className={"rounded-lg border p-4 flex items-center justify-between " + (netProfit >= 0 ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200")}>
        <div>
          <p className="font-semibold">Net {netProfit >= 0 ? "Profit" : "Loss"}</p>
          <p className="text-sm text-muted-foreground">
            Revenue {formatCurrency(totalRevenue)} &minus; Expenses {formatCurrency(totalExpenses)}
          </p>
        </div>
        <p className={"text-2xl font-bold " + (netProfit >= 0 ? "text-green-700" : "text-red-700")}>
          {formatCurrency(Math.abs(netProfit))}
        </p>
      </div>
    </div>
  );
}
`;

fs.writeFileSync(path.join(pnlDir, "page.tsx"), pnlPage);
console.log("Written: reports/profit-loss/page.tsx");

// ─── P&L Export ───────────────────────────────────────────────────────────────
const pnlExport = `"use client";

import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

interface AccountBalance { code: string; name: string; balance: number; }

export function PnLExport({
  currentIncome, currentExpense, totalRevenue, totalExpenses, netProfit, periodFrom, periodTo,
}: {
  currentIncome: AccountBalance[];
  currentExpense: AccountBalance[];
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
  periodFrom: string;
  periodTo: string;
}) {
  async function handleExport() {
    const XLSX = (await import("xlsx")).default;
    const rows: (string | number)[][] = [
      ["PROFIT & LOSS STATEMENT"],
      ["Period: " + periodFrom + " to " + periodTo],
      [],
      ["REVENUE"],
      ["Code", "Account", "Amount"],
      ...currentIncome.filter((b) => b.balance !== 0).map((b) => [b.code, b.name, b.balance]),
      ["", "Total Revenue", totalRevenue],
      [],
      ["EXPENSES"],
      ["Code", "Account", "Amount"],
      ...currentExpense.filter((b) => b.balance !== 0).map((b) => [b.code, b.name, b.balance]),
      ["", "Total Expenses", totalExpenses],
      [],
      ["", "NET PROFIT / (LOSS)", netProfit],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 14 }, { wch: 36 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "P&L");
    XLSX.writeFile(wb, "pnl-" + periodFrom + "-" + periodTo + ".xlsx");
  }

  return (
    <Button type="button" variant="outline" onClick={handleExport}>
      <Download size={14} className="mr-2" />
      Export Excel
    </Button>
  );
}
`;

fs.writeFileSync(path.join(pnlDir, "pnl-export.tsx"), pnlExport);
console.log("Written: reports/profit-loss/pnl-export.tsx");

// ─── Balance Sheet ────────────────────────────────────────────────────────────
const bsDir = path.join(root, "app", "(dashboard)", "reports", "balance-sheet");
fs.mkdirSync(bsDir, { recursive: true });

const bsPage = `import { auth } from "@/lib/auth";
import { getAccountBalances, sumByType } from "@/lib/statements";
import { formatCurrency } from "@/lib/utils";
import { BalanceSheetExport } from "./balance-sheet-export";

export default async function BalanceSheetPage({
  searchParams,
}: {
  searchParams: { asOf?: string; compareAsOf?: string };
}) {
  const session = await auth();
  const orgId = session?.user?.organizationId;
  if (!orgId) return null;

  const today = new Date().toISOString().slice(0, 7);
  const asOf = searchParams.asOf ?? today;
  const compareAsOf = searchParams.compareAsOf ?? (parseInt(asOf.slice(0, 4)) - 1) + asOf.slice(4);

  const [current, prior] = await Promise.all([
    getAccountBalances(orgId, asOf),
    getAccountBalances(orgId, compareAsOf),
  ]);

  const totalAssets = sumByType(current, "ASSET");
  const totalLiabilities = sumByType(current, "LIABILITY");
  const totalEquity = sumByType(current, "EQUITY");

  // Retained earnings = cumulative net profit (Income - Expense) added to equity
  const cumulativeProfit = sumByType(current, "INCOME") - sumByType(current, "EXPENSE");
  const totalLiabEquity = totalLiabilities + totalEquity + cumulativeProfit;
  const isBalanced = Math.abs(totalAssets - totalLiabEquity) < 1;

  const priorAssets = sumByType(prior, "ASSET");
  const priorLiabilities = sumByType(prior, "LIABILITY");
  const priorEquity = sumByType(prior, "EQUITY");
  const priorProfit = sumByType(prior, "INCOME") - sumByType(prior, "EXPENSE");

  function Section({
    title, balances, priorBalances, bold,
  }: {
    title: string;
    balances: typeof current;
    priorBalances: typeof prior;
    bold?: boolean;
  }) {
    const priorMap = new Map(priorBalances.map((b) => [b.accountId, b.balance]));
    const items = balances.filter((b) => b.balance !== 0);
    const total = items.reduce((s, b) => s + b.balance, 0);
    return (
      <>
        <tr className="border-t bg-muted/40">
          <td colSpan={3} className="p-2 pl-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {title}
          </td>
        </tr>
        {items.map((b) => (
          <tr key={b.accountId} className="border-t hover:bg-muted/20">
            <td className="p-3 pl-6">
              <span className="font-mono text-xs text-muted-foreground mr-2">{b.code}</span>
              {b.name}
            </td>
            <td className="p-3 text-right">{formatCurrency(b.balance)}</td>
            <td className="p-3 text-right text-muted-foreground">
              {formatCurrency(priorMap.get(b.accountId) ?? 0)}
            </td>
          </tr>
        ))}
        <tr className={"border-t bg-muted/30 " + (bold ? "font-bold" : "font-semibold")}>
          <td className="p-3 pl-3">Total {title}</td>
          <td className="p-3 text-right">{formatCurrency(total)}</td>
          <td className="p-3 text-right text-muted-foreground">
            {formatCurrency(priorBalances.filter((b) => b.type === balances[0]?.type).reduce((s, b) => s + b.balance, 0))}
          </td>
        </tr>
      </>
    );
  }

  const assets = current.filter((b) => b.type === "ASSET");
  const liabilities = current.filter((b) => b.type === "LIABILITY");
  const equity = current.filter((b) => b.type === "EQUITY");
  const priorAssetBals = prior.filter((b) => b.type === "ASSET");
  const priorLiabBals = prior.filter((b) => b.type === "LIABILITY");
  const priorEqBals = prior.filter((b) => b.type === "EQUITY");

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Balance Sheet</h1>
          <p className="text-sm text-muted-foreground">
            As of {asOf} &mdash; cumulative from inception
          </p>
        </div>
        <BalanceSheetExport
          assets={assets} liabilities={liabilities} equity={equity}
          totalAssets={totalAssets} totalLiabilities={totalLiabilities}
          totalEquity={totalEquity} cumulativeProfit={cumulativeProfit} asOf={asOf}
        />
      </div>

      <form method="GET" className="flex gap-3 items-end flex-wrap">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">As of Period</label>
          <input type="month" name="asOf" defaultValue={asOf}
            className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Compare As of</label>
          <input type="month" name="compareAsOf" defaultValue={compareAsOf}
            className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm" />
        </div>
        <button type="submit"
          className="inline-flex items-center justify-center h-9 rounded-md border border-input bg-background px-4 text-sm hover:bg-accent">
          Apply
        </button>
      </form>

      {/* Balance check */}
      <div className={"rounded-lg border px-4 py-3 flex items-center gap-3 " + (isBalanced ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200")}>
        <span className={"text-lg " + (isBalanced ? "text-green-600" : "text-red-600")}>
          {isBalanced ? "\u2713" : "\u26a0"}
        </span>
        <p className={"text-sm font-medium " + (isBalanced ? "text-green-700" : "text-red-700")}>
          {isBalanced
            ? "Balance sheet balances: Assets = Liabilities + Equity"
            : "OUT OF BALANCE — difference: " + formatCurrency(Math.abs(totalAssets - totalLiabEquity))}
        </p>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <div className="p-3 border-b bg-muted/30 flex justify-between text-sm font-medium">
          <span>Account</span>
          <div className="flex gap-12">
            <span>{asOf}</span>
            <span className="text-muted-foreground">{compareAsOf}</span>
          </div>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {/* Assets */}
            <Section title="Assets" balances={assets} priorBalances={priorAssetBals} bold />

            {/* Liabilities */}
            <Section title="Liabilities" balances={liabilities} priorBalances={priorLiabBals} bold />

            {/* Equity */}
            <Section title="Equity" balances={equity} priorBalances={priorEqBals} />
            <tr className="border-t">
              <td className="p-3 pl-6">Retained Earnings (Net Profit)</td>
              <td className="p-3 text-right">{formatCurrency(cumulativeProfit)}</td>
              <td className="p-3 text-right text-muted-foreground">{formatCurrency(priorProfit)}</td>
            </tr>
            <tr className="border-t bg-muted/30 font-bold">
              <td className="p-3">Total Equity (inc. Retained Earnings)</td>
              <td className="p-3 text-right">{formatCurrency(totalEquity + cumulativeProfit)}</td>
              <td className="p-3 text-right text-muted-foreground">{formatCurrency(priorEquity + priorProfit)}</td>
            </tr>

            {/* Grand total */}
            <tr className="border-t-2 bg-muted/50 font-bold">
              <td className="p-3">Total Liabilities + Equity</td>
              <td className={"p-3 text-right " + (isBalanced ? "text-green-700" : "text-red-600")}>
                {formatCurrency(totalLiabEquity)}
              </td>
              <td className="p-3 text-right text-muted-foreground">
                {formatCurrency(priorLiabilities + priorEquity + priorProfit)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
`;

fs.writeFileSync(path.join(bsDir, "page.tsx"), bsPage);
console.log("Written: reports/balance-sheet/page.tsx");

// ─── Balance Sheet Export ─────────────────────────────────────────────────────
const bsExport = `"use client";

import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

interface B { code: string; name: string; balance: number; }

export function BalanceSheetExport({
  assets, liabilities, equity, totalAssets, totalLiabilities, totalEquity, cumulativeProfit, asOf,
}: {
  assets: B[]; liabilities: B[]; equity: B[];
  totalAssets: number; totalLiabilities: number; totalEquity: number;
  cumulativeProfit: number; asOf: string;
}) {
  async function handleExport() {
    const XLSX = (await import("xlsx")).default;
    const rows: (string | number)[][] = [
      ["BALANCE SHEET — As of " + asOf],
      [],
      ["ASSETS"],
      ["Code", "Account", "Balance"],
      ...assets.filter((b) => b.balance !== 0).map((b) => [b.code, b.name, b.balance]),
      ["", "Total Assets", totalAssets],
      [],
      ["LIABILITIES"],
      ...liabilities.filter((b) => b.balance !== 0).map((b) => [b.code, b.name, b.balance]),
      ["", "Total Liabilities", totalLiabilities],
      [],
      ["EQUITY"],
      ...equity.filter((b) => b.balance !== 0).map((b) => [b.code, b.name, b.balance]),
      ["", "Retained Earnings", cumulativeProfit],
      ["", "Total Equity", totalEquity + cumulativeProfit],
      [],
      ["", "Total Liabilities + Equity", totalLiabilities + totalEquity + cumulativeProfit],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 14 }, { wch: 36 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Balance Sheet");
    XLSX.writeFile(wb, "balance-sheet-" + asOf + ".xlsx");
  }

  return (
    <Button type="button" variant="outline" onClick={handleExport}>
      <Download size={14} className="mr-2" />
      Export Excel
    </Button>
  );
}
`;

fs.writeFileSync(path.join(bsDir, "balance-sheet-export.tsx"), bsExport);
console.log("Written: reports/balance-sheet/balance-sheet-export.tsx");

// ─── Cash Flow (Indirect Method) ─────────────────────────────────────────────
const cfDir = path.join(root, "app", "(dashboard)", "reports", "cash-flow");
fs.mkdirSync(cfDir, { recursive: true });

const cfPage = `import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { getAccountBalances, sumByType } from "@/lib/statements";
import { formatCurrency } from "@/lib/utils";

export default async function CashFlowPage({
  searchParams,
}: {
  searchParams: { periodFrom?: string; periodTo?: string };
}) {
  const session = await auth();
  const orgId = session?.user?.organizationId;
  if (!orgId) return null;

  const today = new Date().toISOString().slice(0, 7);
  const periodTo = searchParams.periodTo ?? today;
  const yearStart = periodTo.slice(0, 4) + "-01";
  const periodFrom = searchParams.periodFrom ?? yearStart;

  // Balance at start of period (one month before periodFrom)
  const prevMonth = new Date(periodFrom + "-01");
  prevMonth.setMonth(prevMonth.getMonth() - 1);
  const prevPeriod = prevMonth.toISOString().slice(0, 7);

  const [currentBals, openingBals] = await Promise.all([
    getAccountBalances(orgId, periodTo),
    getAccountBalances(orgId, prevPeriod),
  ]);

  // Period-only balances for income/expense
  const periodBals = await getAccountBalances(orgId, periodTo, periodFrom);

  const netProfit = sumByType(periodBals, "INCOME") - sumByType(periodBals, "EXPENSE");

  // AR change (ASSET — increase is use of cash)
  function getBalance(bals: typeof currentBals, type: string, codePrefix?: string) {
    return bals
      .filter((b) => b.type === type && (!codePrefix || b.code.startsWith(codePrefix)))
      .reduce((s, b) => s + b.balance, 0);
  }

  const arCurrent = getBalance(currentBals, "ASSET", "CA-001") + getBalance(currentBals, "ASSET", "CA-00");
  const arOpening = getBalance(openingBals, "ASSET", "CA-001") + getBalance(openingBals, "ASSET", "CA-00");
  const arChange = arOpening - arCurrent; // increase in AR = negative cash flow

  const apCurrent = getBalance(currentBals, "LIABILITY", "CL-001") + getBalance(currentBals, "LIABILITY", "CL-00");
  const apOpening = getBalance(openingBals, "LIABILITY", "CL-001") + getBalance(openingBals, "LIABILITY", "CL-00");
  const apChange = apCurrent - apOpening; // increase in AP = positive cash flow

  // Cash = bank accounts
  const cashCurrent = getBalance(currentBals, "ASSET", "CA-003") + getBalance(currentBals, "ASSET", "CA-00");
  const cashOpening = getBalance(openingBals, "ASSET", "CA-003") + getBalance(openingBals, "ASSET", "CA-00");

  // Bank balances from actual bank account table for reconciliation
  const bankAccounts = await prisma.bankAccount.findMany({
    where: { organizationId: orgId, isActive: true },
    select: { accountName: true, bankName: true, currentBalance: true },
  });
  const bankTotal = bankAccounts.reduce((s, b) => s + Number(b.currentBalance), 0);

  const operatingCashFlow = netProfit + arChange + apChange;
  const netCashChange = cashCurrent - cashOpening;

  function Row({ label, value, indent, bold }: { label: string; value: number; indent?: boolean; bold?: boolean }) {
    return (
      <tr className="border-t">
        <td className={"p-3 " + (indent ? "pl-8" : "") + (bold ? " font-semibold" : "")}>{label}</td>
        <td className={"p-3 text-right " + (bold ? "font-semibold" : "") + (value < 0 ? " text-red-600" : "")}>
          {formatCurrency(value)}
        </td>
      </tr>
    );
  }

  return (
    <div className="p-6 space-y-5 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Cash Flow Statement</h1>
        <p className="text-sm text-muted-foreground">
          Indirect method &mdash; {periodFrom} to {periodTo}
        </p>
      </div>

      <form method="GET" className="flex gap-3 items-end flex-wrap">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">From Period</label>
          <input type="month" name="periodFrom" defaultValue={periodFrom}
            className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">To Period</label>
          <input type="month" name="periodTo" defaultValue={periodTo}
            className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm" />
        </div>
        <button type="submit"
          className="inline-flex items-center justify-center h-9 rounded-md border border-input bg-background px-4 text-sm hover:bg-accent">
          Apply
        </button>
      </form>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <tbody>
            {/* Operating */}
            <tr className="bg-muted/40">
              <td colSpan={2} className="p-3 font-semibold uppercase text-xs tracking-wide text-muted-foreground">
                Operating Activities
              </td>
            </tr>
            <Row label="Net Profit / (Loss)" value={netProfit} />
            <Row label="Adjustments:" indent />
            <Row label="(Increase) / Decrease in Accounts Receivable" value={arChange} indent />
            <Row label="Increase / (Decrease) in Accounts Payable" value={apChange} indent />
            <Row label="Net Cash from Operating Activities" value={operatingCashFlow} bold />

            {/* Investing */}
            <tr className="border-t bg-muted/40">
              <td colSpan={2} className="p-3 font-semibold uppercase text-xs tracking-wide text-muted-foreground">
                Investing Activities
              </td>
            </tr>
            <Row label="Capital Expenditure (Fixed Assets)" value={0} indent />
            <Row label="Net Cash from Investing Activities" value={0} bold />

            {/* Financing */}
            <tr className="border-t bg-muted/40">
              <td colSpan={2} className="p-3 font-semibold uppercase text-xs tracking-wide text-muted-foreground">
                Financing Activities
              </td>
            </tr>
            <Row label="Equity Contributions" value={0} indent />
            <Row label="Loan Repayments" value={0} indent />
            <Row label="Net Cash from Financing Activities" value={0} bold />

            {/* Net change */}
            <tr className="border-t-2 bg-muted/50">
              <td className="p-3 font-bold">Net Change in Cash</td>
              <td className={"p-3 text-right font-bold " + (netCashChange >= 0 ? "text-green-700" : "text-red-600")}>
                {formatCurrency(netCashChange)}
              </td>
            </tr>
            <Row label="Cash at Beginning of Period" value={cashOpening} />
            <tr className="border-t bg-muted/30">
              <td className="p-3 font-bold">Cash at End of Period</td>
              <td className="p-3 text-right font-bold">{formatCurrency(cashCurrent)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Bank reconciliation */}
      <div className="rounded-lg border overflow-hidden">
        <div className="p-3 border-b bg-muted/30 font-medium text-sm">Bank Account Balances (Reconciliation)</div>
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 font-medium">Account</th>
              <th className="text-left p-3 font-medium">Bank</th>
              <th className="text-right p-3 font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {bankAccounts.map((b, i) => (
              <tr key={i} className="border-t">
                <td className="p-3">{b.accountName}</td>
                <td className="p-3 text-muted-foreground">{b.bankName}</td>
                <td className="p-3 text-right">{formatCurrency(Number(b.currentBalance))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t bg-muted/30 font-semibold">
            <tr>
              <td colSpan={2} className="p-3">Total Bank Balances</td>
              <td className="p-3 text-right">{formatCurrency(bankTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
`;

fs.writeFileSync(path.join(cfDir, "page.tsx"), cfPage);
console.log("Written: reports/cash-flow/page.tsx");

console.log("\nAll financial statements written.");
