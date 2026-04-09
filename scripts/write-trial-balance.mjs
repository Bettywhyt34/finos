import fs from "fs";
import path from "path";

const root = process.cwd();

// ─── Trial Balance ─────────────────────────────────────────────────────────────
const tbDir = path.join(root, "app", "(dashboard)", "accounting", "trial-balance");
fs.mkdirSync(tbDir, { recursive: true });

const tbPage = `import { prisma } from "@/lib/prisma";
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
          {isBalanced ? "\u2713" : "\u26a0"}
        </span>
        <div>
          <p className={"font-medium " + (isBalanced ? "text-green-700" : "text-red-700")}>
            {isBalanced ? "Trial balance is balanced" : "Trial balance is OUT OF BALANCE"}
          </p>
          <p className="text-xs text-muted-foreground">
            Total Debits: {formatCurrency(grandDebit)} &nbsp;|&nbsp; Total Credits:{" "}
            {formatCurrency(grandCredit)}
            {!isBalanced && " \u00b7 Difference: " + formatCurrency(Math.abs(grandDebit - grandCredit))}
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
`;

fs.writeFileSync(path.join(tbDir, "page.tsx"), tbPage);
console.log("Written: trial-balance/page.tsx");

// ─── Trial Balance Export (client) ───────────────────────────────────────────
const tbExport = `"use client";

import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

interface Line {
  code: string;
  name: string;
  type: string;
  totalDebit: number;
  totalCredit: number;
  balance: number;
}

export function TrialBalanceExport({ lines, period }: { lines: Line[]; period: string }) {
  async function handleExport() {
    const XLSX = (await import("xlsx")).default;
    const data = [
      ["Code", "Account Name", "Type", "Total Debits", "Total Credits", "Balance"],
      ...lines.map((l) => [l.code, l.name, l.type, l.totalDebit, l.totalCredit, l.balance]),
      [],
      [
        "TOTAL",
        "",
        "",
        lines.reduce((s, l) => s + l.totalDebit, 0),
        lines.reduce((s, l) => s + l.totalCredit, 0),
        "",
      ],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 12 }, { wch: 36 }, { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Trial Balance");
    XLSX.writeFile(wb, "trial-balance-" + (period || "all") + ".xlsx");
  }

  return (
    <Button type="button" variant="outline" onClick={handleExport}>
      <Download size={14} className="mr-2" />
      Export Excel
    </Button>
  );
}
`;

fs.writeFileSync(path.join(tbDir, "trial-balance-export.tsx"), tbExport);
console.log("Written: trial-balance/trial-balance-export.tsx");

// ─── General Ledger (at reports/general-ledger to match sidebar nav) ─────────
const glDir = path.join(root, "app", "(dashboard)", "reports", "general-ledger");
fs.mkdirSync(glDir, { recursive: true });

const glPage = `import { prisma } from "@/lib/prisma";
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
  const orgId = session?.user?.organizationId;
  if (!orgId) return null;

  const { accountId, dateFrom, dateTo, period } = searchParams;

  // All accounts for selector
  const accounts = await prisma.chartOfAccounts.findMany({
    where: { organizationId: orgId, isActive: true },
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
          organizationId: orgId,
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
`;

fs.writeFileSync(path.join(glDir, "page.tsx"), glPage);
console.log("Written: reports/general-ledger/page.tsx");

// ─── GL Export (client) ───────────────────────────────────────────────────────
const glExport = `"use client";

import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

interface Row {
  entryDate: Date;
  entryNumber: string;
  description: string;
  reference: string | null;
  source: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

export function GeneralLedgerExport({
  rows,
  accountCode,
  accountName,
}: {
  rows: Row[];
  accountCode: string;
  accountName: string;
}) {
  async function handleExport() {
    const XLSX = (await import("xlsx")).default;
    const data = [
      [accountCode + " — " + accountName],
      [],
      ["Date", "Entry #", "Description", "Reference", "Source", "Debit", "Credit", "Balance"],
      ...rows.map((r) => [
        new Date(r.entryDate).toLocaleDateString("en-NG"),
        r.entryNumber,
        r.description,
        r.reference ?? "",
        r.source,
        r.debit,
        r.credit,
        r.runningBalance,
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [
      { wch: 12 }, { wch: 12 }, { wch: 36 }, { wch: 16 }, { wch: 12 },
      { wch: 14 }, { wch: 14 }, { wch: 14 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, accountCode);
    XLSX.writeFile(wb, "gl-" + accountCode + ".xlsx");
  }

  return (
    <Button type="button" variant="outline" onClick={handleExport}>
      <Download size={14} className="mr-2" />
      Export Excel
    </Button>
  );
}
`;

fs.writeFileSync(path.join(glDir, "general-ledger-export.tsx"), glExport);
console.log("Written: reports/general-ledger/general-ledger-export.tsx");

console.log("\nTrial Balance + General Ledger written.");
