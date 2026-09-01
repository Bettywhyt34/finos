import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Building2, ArrowRight, Landmark, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/dashboard/page-header";
import { BankAccountForm } from "./bank-account-form";
import { SyncFromCoaButton } from "./sync-from-coa-button";
import { formatCurrency, cn } from "@/lib/utils";

interface BankLedgerMappingRow {
  bankAccountId: string;
  ledgerAccountId: string | null;
  ledgerCode: string | null;
  ledgerName: string | null;
}

export default async function BankAccountsPage() {
  const session = await auth();
  const tenantId = session!.user.tenantId!;

  const [accounts, ledgerAccounts, mappings] = await Promise.all([
    prisma.bankAccount.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
    }),
    prisma.chartOfAccounts.findMany({
      where: {
        tenantId,
        isActive: true,
        type: "ASSET",
        OR: [
          { subtype: { contains: "bank", mode: "insensitive" } },
          { subtype: { contains: "cash", mode: "insensitive" } },
        ],
      },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.$queryRaw<BankLedgerMappingRow[]>`
      SELECT
        ba."id" AS "bankAccountId",
        ba."ledger_account_id" AS "ledgerAccountId",
        coa."code" AS "ledgerCode",
        coa."name" AS "ledgerName"
      FROM "bank_accounts" ba
      LEFT JOIN "chart_of_accounts" coa
        ON coa."id" = ba."ledger_account_id"
       AND coa."tenant_id" = ba."tenant_id"
      WHERE ba."tenant_id" = ${tenantId}::uuid
    `,
  ]);

  const mappingByBank = new Map(mappings.map((mapping) => [mapping.bankAccountId, mapping]));
  const totalBalance = accounts
    .filter((a) => a.currency === "NGN")
    .reduce((sum, a) => sum + parseFloat(String(a.currentBalance)), 0);
  const unmappedCount = accounts.filter((account) => !mappingByBank.get(account.id)?.ledgerAccountId).length;

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader
        title="Bank Accounts"
        subtitle={
          <span className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-xs font-medium">
              <Landmark className="h-3 w-3" />
              {accounts.length} account{accounts.length !== 1 ? "s" : ""}
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
              {formatCurrency(totalBalance)} NGN
            </span>
            {unmappedCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-medium">
                <AlertTriangle className="h-3 w-3" />
                {unmappedCount} ledger mapping{unmappedCount !== 1 ? "s" : ""} required
              </span>
            )}
          </span>
        }
        icon={Landmark}
        color="indigo"
        action={
          <div className="flex items-center gap-2">
            <SyncFromCoaButton />
            <BankAccountForm ledgerAccounts={ledgerAccounts} />
          </div>
        }
      />

      {accounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-indigo-200 rounded-xl bg-indigo-50/40">
          <div className="w-14 h-14 rounded-full bg-indigo-100 flex items-center justify-center mb-3">
            <Building2 className="h-7 w-7 text-indigo-400" />
          </div>
          <p className="text-slate-600 font-medium mb-1">No bank accounts yet</p>
          <p className="text-sm text-slate-400">Add your first bank account to track balances and transactions.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {accounts.map((account) => {
            const balance = parseFloat(String(account.currentBalance));
            const opening = parseFloat(String(account.openingBalance));
            const change = balance - opening;
            const mapping = mappingByBank.get(account.id);

            return (
              <Card key={account.id} className="border-slate-200 shadow-sm hover:shadow-md hover:border-indigo-200 transition-all overflow-hidden">
                <div className="h-1 bg-indigo-400" />
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="p-2 bg-indigo-100 rounded-lg"><Building2 className="h-5 w-5 text-indigo-600" /></div>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{account.currency}</span>
                  </div>
                  <p className="font-semibold text-slate-900 truncate">{account.accountName}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{account.bankName} · ···{account.accountNumber.slice(-4)}</p>
                  <p className="mt-2 text-xs text-slate-500">
                    Ledger: {mapping?.ledgerAccountId ? `${mapping.ledgerCode} · ${mapping.ledgerName}` : "Not mapped"}
                  </p>
                  {!mapping?.ledgerAccountId && (
                    <p className="mt-1 text-xs text-amber-700">Map a Bank/Cash ledger account before reconciliation.</p>
                  )}
                  <p className="text-2xl font-bold text-slate-900 mt-3 font-mono">{formatCurrency(balance, account.currency)}</p>
                  {change !== 0 && (
                    <p className={cn("text-xs mt-0.5", change >= 0 ? "text-emerald-600" : "text-red-500")}>
                      {change >= 0 ? "+" : ""}{formatCurrency(change, account.currency)} from opening
                    </p>
                  )}
                  <div className="mt-4 flex items-center gap-2">
                    <Link href={`/banking/${account.id}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "flex-1 justify-between text-xs")}>
                      View transactions <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                    <BankAccountForm
                      mode="edit"
                      ledgerAccounts={ledgerAccounts}
                      account={{
                        id: account.id,
                        accountName: account.accountName,
                        accountNumber: account.accountNumber,
                        bankName: account.bankName,
                        currency: account.currency,
                        openingBalance: parseFloat(String(account.openingBalance)),
                        ledgerAccountId: mapping?.ledgerAccountId ?? "",
                      }}
                    />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
