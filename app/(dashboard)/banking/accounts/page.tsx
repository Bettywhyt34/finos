import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Building2, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { BankAccountForm } from "./bank-account-form";
import { formatCurrency, cn } from "@/lib/utils";

export default async function BankAccountsPage() {
  const session = await auth();
  const tenantId = session!.user.tenantId!;

  const accounts = await prisma.bankAccount.findMany({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
  });

  const totalBalance = accounts
    .filter((a) => a.currency === "NGN")
    .reduce((sum, a) => sum + parseFloat(String(a.currentBalance)), 0);

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Bank Accounts
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {accounts.length} account{accounts.length !== 1 ? "s" : ""} ·
            Total: {formatCurrency(totalBalance)}
          </p>
        </div>
        <BankAccountForm />
      </div>

      {accounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-slate-200 rounded-xl">
          <Building2 className="h-10 w-10 text-slate-300 mb-3" />
          <p className="text-slate-500 font-medium mb-1">No bank accounts yet</p>
          <p className="text-sm text-slate-400">
            Add your first bank account to track balances and transactions.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {accounts.map((account) => {
            const balance = parseFloat(String(account.currentBalance));
            const opening = parseFloat(String(account.openingBalance));
            const change = balance - opening;

            return (
              <Card key={account.id} className="border-slate-200 shadow-none hover:border-slate-300 transition-colors">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="p-2 bg-blue-50 rounded-lg">
                      <Building2 className="h-5 w-5 text-blue-600" />
                    </div>
                    <span className="text-xs text-slate-400 font-mono">
                      {account.currency}
                    </span>
                  </div>
                  <p className="font-semibold text-slate-900 truncate">
                    {account.accountName}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {account.bankName} · ···{account.accountNumber.slice(-4)}
                  </p>
                  <p className="text-2xl font-bold text-slate-900 mt-3 font-mono">
                    {formatCurrency(balance, account.currency)}
                  </p>
                  {change !== 0 && (
                    <p
                      className={cn(
                        "text-xs mt-0.5",
                        change >= 0 ? "text-green-600" : "text-red-500"
                      )}
                    >
                      {change >= 0 ? "+" : ""}
                      {formatCurrency(change, account.currency)} from opening
                    </p>
                  )}
                  <Link
                    href={`/banking/${account.id}`}
                    className={cn(
                      buttonVariants({ variant: "ghost", size: "sm" }),
                      "mt-4 w-full justify-between text-xs"
                    )}
                  >
                    View transactions
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
