import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { formatDate, formatCurrency } from "@/lib/utils";
import { GeneralLedgerExport } from "./general-ledger-export";

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  invoice: "Invoice",
  bill: "Bill",
  payment: "Payment",
  "bank-import": "Bank",
  "fx-revaluation": "FX Reval",
  reversal: "Reversal",
};

export default async function GeneralLedgerPage({
  searchParams,
}: {
  searchParams: {
    accountId?: string;
    dateFrom?: string;
    dateTo?: string;
    period?: string;
  };
}) {
  const session = await auth();
  const orgId = session?.user?.tenantId;
  if (!orgId) return null;

  const { accountId, dateFrom, dateTo, period } = searchParams;

  // All accounts for selector
  const accounts = await prisma.chartOfAccounts.findMany({
    where: { tenantId: orgId, isActive: true },
    select: { id: true, code: true, name: true, type: true },
    orderBy: { code: "asc" },
  });

  let ledgerLines: {
    id: string;
    entryId: string;
    entryNumber: string;
    entryDate: Date;
    description: string;
    reference: string | null;
    source: string;
    debit: number;
    credit: number;
  }[] = [];

  let selectedAccount = accountId ? accounts.find((a) => a.id === accountId) : null;

  if (accountId) {
    const lines = await prisma.journalEntryLine.findMany({
      where: {
        accountId,
        entry: {
          tenantId: orgId,
          isLocked: true,
          ...(period ? { recognitionPeriod: period } : {}),
          ...(dateFrom || dateTo
            ? {
                entryDate: {
                  ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
                  ...(dateTo ? { lte: new Date(dateTo + "T23:59:59") } : {}),
                },
              }
            : {}),
        },
      },
      include: {
        entry: {
          select: {
            id: true,
            entryNumber: true,
            entryDate: true,
            description: true,
            reference: true,
            source: true,
          },
        },
      },
      orderBy: { entry: { entryDate: "asc" } },
    });

    ledgerLines = lines.map((l) => ({
      id: l.id,
      entryId: l.entry.id,
      entryNumber: l.entry.entryNumber,
      entryDate: l.entry.entryDate,
      description: l.entry.description,
      reference: l.entry.reference,
      source: l.entry.source,
      debit: Number(l.debit),
      credit: Number(l.credit),
    }));
  }

  // Running balance
  const isDebitNormal = selectedAccount
    ? ["ASSET", "EXPENSE"].includes(selectedAccount.type)
    : true;

  let runningBalance = 0;
  const rows = ledgerLines.map((l) => {
    runningBalance += isDebitNormal ? l.debit - l.credit : l.credit - l.debit;
    return { ...l, runningBalance };
  });

  const totalDebit = ledgerLines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = ledgerLines.reduce((s, l) => s + l.credit, 0);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">General Ledger</h1>
          <p className="text-sm text-muted-foreground">Account transaction history with running balance</p>
        </div>
        {accountId && ledgerLines.length > 0 && (
          <GeneralLedgerExport
            rows={rows}
            accountCode={selectedAccount?.code ?? ""}
            accountName={selectedAccount?.name ?? ""}
          />
        )}
      </div>

      {/* Filters */}
      <form method="GET" className="flex gap-3 items-end flex-wrap">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Account</label>
          <select
            name="accountId"
            defaultValue={accountId ?? ""}
            className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm min-w-[240px]"
          >
            <option value="">Select account...</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Period</label>
          <input
            type="month"
            name="period"
            defaultValue={period ?? ""}
            className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">From Date</label>
          <input
            type="date"
            name="dateFrom"
            defaultValue={dateFrom ?? ""}
            className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">To Date</label>
          <input
            type="date"
            name="dateTo"
            defaultValue={dateTo ?? ""}
            className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
          />
        </div>
        <button type="submit" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Apply
        </button>
      </form>

      {!accountId && (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          Select an account above to view its ledger
        </div>
      )}

      {accountId && selectedAccount && (
        <>
          <div className="rounded-lg border p-4 bg-muted/30 flex items-center gap-6">
            <div>
              <p className="text-xs text-muted-foreground">Account</p>
              <p className="font-semibold font-mono">{selectedAccount.code} — {selectedAccount.name}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Type</p>
              <p className="font-medium">{selectedAccount.type}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Transactions</p>
              <p className="font-medium">{ledgerLines.length}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Closing Balance</p>
              <p className="font-semibold">{formatCurrency(runningBalance)}</p>
            </div>
          </div>

          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3 font-medium">Date</th>
                  <th className="text-left p-3 font-medium">Entry #</th>
                  <th className="text-left p-3 font-medium">Description</th>
                  <th className="text-left p-3 font-medium">Source</th>
                  <th className="text-right p-3 font-medium">Debit</th>
                  <th className="text-right p-3 font-medium">Credit</th>
                  <th className="text-right p-3 font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">
                      No transactions found for selected filters
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.id} className="border-t hover:bg-muted/20">
                    <td className="p-3 text-muted-foreground">{formatDate(r.entryDate)}</td>
                    <td className="p-3">
                      <Link
                        href={"/accounting/journal-entries/" + r.entryId}
                        className="font-mono text-xs hover:underline"
                      >
                        {r.entryNumber}
                      </Link>
                    </td>
                    <td className="p-3 max-w-xs truncate">
                      {r.description}
                      {r.reference && (
                        <span className="text-xs text-muted-foreground ml-2">({r.reference})</span>
                      )}
                    </td>
                    <td className="p-3">
                      <span className="text-xs px-1.5 py-0.5 rounded bg-muted">
                        {SOURCE_LABELS[r.source] ?? r.source}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      {r.debit > 0 ? formatCurrency(r.debit) : ""}
                    </td>
                    <td className="p-3 text-right">
                      {r.credit > 0 ? formatCurrency(r.credit) : ""}
                    </td>
                    <td className="p-3 text-right font-medium">
                      {formatCurrency(r.runningBalance)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 bg-muted/30 font-semibold">
                <tr>
                  <td colSpan={4} className="p-3">Total</td>
                  <td className="p-3 text-right">{formatCurrency(totalDebit)}</td>
                  <td className="p-3 text-right">{formatCurrency(totalCredit)}</td>
                  <td className="p-3 text-right">{formatCurrency(runningBalance)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
