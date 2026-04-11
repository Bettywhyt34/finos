import { auth } from "@/lib/auth";
import { getAccountBalances, sumByType } from "@/lib/statements";
import { formatCurrency } from "@/lib/utils";
import { BalanceSheetExport } from "./balance-sheet-export";

export default async function BalanceSheetPage({
  searchParams,
}: {
  searchParams: { asOf?: string; compareAsOf?: string };
}) {
  const session = await auth();
  const orgId = session?.user?.tenantId;
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
          {isBalanced ? "✓" : "⚠"}
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
