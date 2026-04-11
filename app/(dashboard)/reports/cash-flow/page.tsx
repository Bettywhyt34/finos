import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { getAccountBalances, sumByType } from "@/lib/statements";
import { formatCurrency } from "@/lib/utils";

export default async function CashFlowPage({
  searchParams,
}: {
  searchParams: { periodFrom?: string; periodTo?: string };
}) {
  const session = await auth();
  const orgId = session?.user?.tenantId;
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
    where: { tenantId: orgId, isActive: true },
    select: { accountName: true, bankName: true, currentBalance: true },
  });
  const bankTotal = bankAccounts.reduce((s, b) => s + Number(b.currentBalance), 0);

  const operatingCashFlow = netProfit + arChange + apChange;
  const netCashChange = cashCurrent - cashOpening;

  function Row({ label, value = 0, indent, bold, hideZero }: { label: string; value?: number; indent?: boolean; bold?: boolean; hideZero?: boolean }) {
    return (
      <tr className="border-t">
        <td className={"p-3 " + (indent ? "pl-8" : "") + (bold ? " font-semibold" : "")}>{label}</td>
        <td className={"p-3 text-right " + (bold ? "font-semibold" : "") + (value < 0 ? " text-red-600" : "")}>
          {hideZero && value === 0 ? "—" : formatCurrency(value)}
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
            <Row label="Adjustments:" value={0} indent />
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
