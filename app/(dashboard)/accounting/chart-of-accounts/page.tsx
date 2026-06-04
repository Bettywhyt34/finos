import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { AccountType } from "@prisma/client";
import Link from "next/link";
import { Upload, Download } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AccountTable } from "./account-table";
import { AccountForm } from "./account-form";

function computeBalance(type: AccountType, debit: number, credit: number): number {
  switch (type) {
    case "ASSET":
    case "EXPENSE":
      return debit - credit;
    case "LIABILITY":
    case "EQUITY":
    case "INCOME":
      return credit - debit;
  }
}

export default async function ChartOfAccountsPage() {
  const session = await auth();
  const tenantId = session!.user.tenantId!;

  const [rawAccounts, balanceRows] = await Promise.all([
    prisma.chartOfAccounts.findMany({
      where: { tenantId },
      orderBy: { code: "asc" },
    }),
    prisma.journalEntryLine.groupBy({
      by: ["accountId"],
      where: { entry: { tenantId } },
      _sum: { debit: true, credit: true },
    }),
  ]);

  const balanceMap = new Map(
    balanceRows.map((r) => [
      r.accountId,
      {
        debit: parseFloat(String(r._sum.debit ?? 0)),
        credit: parseFloat(String(r._sum.credit ?? 0)),
      },
    ])
  );

  const accounts = rawAccounts.map((a) => {
    const sums = balanceMap.get(a.id) ?? { debit: 0, credit: 0 };
    return {
      id: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      subtype: a.subtype,
      parentId: a.parentId,
      isActive: a.isActive,
      balance: computeBalance(a.type, sums.debit, sums.credit),
    };
  });

  const totals = accounts.reduce<Partial<Record<AccountType, number>>>(
    (acc, a) => ({ ...acc, [a.type]: (acc[a.type] ?? 0) + a.balance }),
    {}
  );

  const summaryItems = [
    { type: "ASSET" as const, cls: "bg-blue-50 border-blue-100 text-blue-800" },
    { type: "LIABILITY" as const, cls: "bg-red-50 border-red-100 text-red-800" },
    { type: "EQUITY" as const, cls: "bg-purple-50 border-purple-100 text-purple-800" },
    { type: "INCOME" as const, cls: "bg-green-50 border-green-100 text-green-800" },
    { type: "EXPENSE" as const, cls: "bg-orange-50 border-orange-100 text-orange-800" },
  ];

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Chart of Accounts
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {accounts.length} accounts · GL structure
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/accounting/chart-of-accounts/import"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
          >
            <Upload className="h-3.5 w-3.5" />
            Import
          </Link>
          <div className="flex items-center gap-1 border border-slate-200 rounded-md overflow-hidden">
            <a
              href="/api/coa/export?format=finos"
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "rounded-none border-r border-slate-200 gap-1.5 h-8 px-3")}
            >
              <Download className="h-3.5 w-3.5" />
              FINOS CSV
            </a>
            <a
              href="/api/coa/export?format=zoho"
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "rounded-none gap-1.5 h-8 px-3")}
            >
              <Download className="h-3.5 w-3.5" />
              Zoho CSV
            </a>
          </div>
          <AccountForm accounts={accounts} />
        </div>
      </div>

      {accounts.length > 0 && (
        <div className="grid grid-cols-5 gap-3">
          {summaryItems.map(({ type, cls }) => (
            <div key={type} className={`rounded-lg border p-3 space-y-1 ${cls}`}>
              <p className="text-xs font-medium uppercase tracking-wide opacity-70">
                {type}
              </p>
              <p className="text-lg font-bold font-mono">
                ₦{(((totals[type] ?? 0) / 1000)).toFixed(1)}k
              </p>
            </div>
          ))}
        </div>
      )}

      <AccountTable accounts={accounts} />
    </div>
  );
}
