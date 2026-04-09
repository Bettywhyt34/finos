import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { TrialBalanceExport } from "./trial-balance-export";

interface TrialBalanceLine {
  accountId: string;
  code: string;
  name: string;
  type: string;
  totalDebit: number;
  totalCredit: number;
  balance: number; // debit positive for assets/expenses, credit positive for liabilities/income/equity
}

const DEBIT_NORMAL = new Set(["ASSET", "EXPENSE"]);

export default async function TrialBalancePage({
  searchParams,
}: {
  searchParams: { period?: string; activeOnly?: string };
}) {
  const session = await auth();
  const orgId = session?.user?.organizationId;
  if (!orgId) return null;

  const period = searchParams.period ?? "";
  const activeOnly = searchParams.activeOnly !== "false";

  // All active accounts
  const accounts = await prisma.chartOfAccounts.findMany({
    where: { organizationId: orgId, ...(activeOnly ? { isActive: true } : {}) },
    select: { id: true, code: true, name: true, type: true },
    orderBy: { code: "asc" },
  });

  // Aggregate journal entry lines per account (optionally filtered by period)
  const lines = await prisma.journalEntryLine.groupBy({
    by: ["accountId"],
    where: {
      entry: {
        organizationId: orgId,
        isLocked: true,
        ...(period ? { recognitionPeriod: { lte: period } } : {}),
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

  const tbLines: TrialBalanceLine[] = accounts
    .map((a) => {
      const { debit = 0, credit = 0 } = lineMap.get(a.id) ?? {};
      const balance = DEBIT_NORMAL.has(a.type) ? debit - credit : credit - debit;
      return { accountId: a.id, code: a.code, name: a.name, type: a.type, totalDebit: debit, totalCredit: credit, balance };
    })
    .filter((l) => l.totalDebit > 0 || l.totalCredit > 0 || !activeOnly);

  const grandDebit = tbLines.reduce((s, l) => s + l.totalDebit, 0);
  const grandCredit = tbLines.reduce((s, l) => s + l.totalCredit, 0);
  const isBalanced = Math.abs(grandDebit - grandCredit) < 0.01;

  const typeOrder = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Trial Balance</h1>
          <p className="text-sm text-muted-foreground">
            {period ? "As of period ending " + period : "All periods"} &mdash; posted entries only
          </p>
        </div>
        <TrialBalanceExport lines={tbLines} period={period} />
      </div>

      {/* Filters */}
      <form method="GET" className="flex gap-3 items-end flex-wrap">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Up to Period</label>
          <input
            type="month"
            name="period"
            defaultValue={period}
            className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
          />
        </div>
        <div className="flex items-center gap-2 self-end h-9">
          <input
            type="checkbox"
            name="activeOnly"
            value="true"
            id="activeOnly"
            defaultChecked={activeOnly}
            className="h-4 w-4"
          />
          <label htmlFor="activeOnly" className="text-sm">Active accounts only</label>
        </div>
        <button type="submit" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Apply
        </button>
      </form>

      {/* Balance check */}
      <div
        className={
          "rounded-lg border px-4 py-3 flex items-center gap-3 " +
          (isBalanced ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200")
        }
      >
        <span className={"text-lg " + (isBalanced ? "text-green-600" : "text-red-600")}>
          {isBalanced ? "✓" : "⚠"}
        </span>
        <div>
          <p className={"font-medium " + (isBalanced ? "text-green-700" : "text-red-700")}>
            {isBalanced ? "Trial balance is balanced" : "Trial balance is OUT OF BALANCE"}
          </p>
          <p className="text-xs text-muted-foreground">
            Total Debits: {formatCurrency(grandDebit)} &nbsp;|&nbsp; Total Credits:{" "}
            {formatCurrency(grandCredit)}
            {!isBalanced && " · Difference: " + formatCurrency(Math.abs(grandDebit - grandCredit))}
          </p>
        </div>
      </div>

      {/* Table by type group */}
      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 font-medium w-24">Code</th>
              <th className="text-left p-3 font-medium">Account Name</th>
              <th className="text-right p-3 font-medium w-36">Total Debits</th>
              <th className="text-right p-3 font-medium w-36">Total Credits</th>
              <th className="text-right p-3 font-medium w-36">Balance</th>
            </tr>
          </thead>
          <tbody>
            {typeOrder.map((type) => {
              const group = tbLines.filter((l) => l.type === type);
              if (group.length === 0) return null;
              const groupDebit = group.reduce((s, l) => s + l.totalDebit, 0);
              const groupCredit = group.reduce((s, l) => s + l.totalCredit, 0);
              const groupBalance = group.reduce((s, l) => s + l.balance, 0);
              return [
                <tr key={type + "-header"} className="border-t bg-muted/40">
                  <td colSpan={5} className="p-2 pl-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {type}
                  </td>
                </tr>,
                ...group.map((l) => (
                  <tr key={l.accountId} className="border-t hover:bg-muted/20">
                    <td className="p-3 font-mono text-xs text-muted-foreground">
                      <Link
                        href={"/reports/general-ledger?accountId=" + l.accountId + (period ? "&period=" + period : "")}
                        className="hover:text-primary hover:underline"
                      >
                        {l.code}
                      </Link>
                    </td>
                    <td className="p-3">{l.name}</td>
                    <td className="p-3 text-right">
                      {l.totalDebit > 0 ? formatCurrency(l.totalDebit) : ""}
                    </td>
                    <td className="p-3 text-right">
                      {l.totalCredit > 0 ? formatCurrency(l.totalCredit) : ""}
                    </td>
                    <td className="p-3 text-right font-medium">
                      {formatCurrency(l.balance)}
                    </td>
                  </tr>
                )),
                <tr key={type + "-total"} className="border-t bg-muted/30 font-semibold text-sm">
                  <td colSpan={2} className="p-2 pl-3 text-xs">
                    {type} Total
                  </td>
                  <td className="p-2 text-right">{formatCurrency(groupDebit)}</td>
                  <td className="p-2 text-right">{formatCurrency(groupCredit)}</td>
                  <td className="p-2 text-right">{formatCurrency(groupBalance)}</td>
                </tr>,
              ];
            })}
          </tbody>
          <tfoot className="border-t-2 bg-muted/50 font-bold">
            <tr>
              <td colSpan={2} className="p-3">Grand Total</td>
              <td className="p-3 text-right">{formatCurrency(grandDebit)}</td>
              <td className="p-3 text-right">{formatCurrency(grandCredit)}</td>
              <td className="p-3 text-right">&mdash;</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
