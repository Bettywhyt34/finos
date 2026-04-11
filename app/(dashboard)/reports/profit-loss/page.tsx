import { prisma } from "@/lib/prisma";
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
  const orgId = session?.user?.tenantId;
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
