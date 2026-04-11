import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TransactionForm } from "./transaction-form";
import { formatCurrency, formatDate, cn } from "@/lib/utils";

export default async function BankAccountDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  const tenantId = session!.user.tenantId!;

  const account = await prisma.bankAccount.findFirst({
    where: { id: params.id, tenantId },
    include: {
      transactions: {
        orderBy: { transactionDate: "desc" },
        take: 100,
      },
    },
  });

  if (!account) notFound();

  const currentBalance = parseFloat(String(account.currentBalance));
  const openingBalance = parseFloat(String(account.openingBalance));
  const totalCredits = account.transactions
    .filter((t) => t.type === "CREDIT")
    .reduce((s, t) => s + parseFloat(String(t.amount)), 0);
  const totalDebits = account.transactions
    .filter((t) => t.type === "DEBIT")
    .reduce((s, t) => s + parseFloat(String(t.amount)), 0);

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Back nav */}
      <Link
        href="/banking/accounts"
        className={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "gap-1.5 -ml-2 text-slate-500"
        )}
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Bank Accounts
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {account.accountName}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {account.bankName} · {account.accountNumber} · {account.currency}
          </p>
        </div>
        <TransactionForm bankAccountId={account.id} />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        {[
          {
            label: "Current Balance",
            value: formatCurrency(currentBalance, account.currency),
            cls: "text-slate-900",
          },
          {
            label: "Opening Balance",
            value: formatCurrency(openingBalance, account.currency),
            cls: "text-slate-600",
          },
          {
            label: "Total Credits",
            value: formatCurrency(totalCredits, account.currency),
            cls: "text-green-700",
            icon: TrendingUp,
          },
          {
            label: "Total Debits",
            value: formatCurrency(totalDebits, account.currency),
            cls: "text-red-600",
            icon: TrendingDown,
          },
        ].map((item) => (
          <Card key={item.label} className="border-slate-200 shadow-none">
            <CardContent className="p-4">
              <p className="text-xs text-slate-500">{item.label}</p>
              <p className={cn("text-lg font-bold font-mono mt-1", item.cls)}>
                {item.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Transactions table */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <p className="text-sm font-medium text-slate-700">
            Transactions ({account.transactions.length})
          </p>
          <Link
            href={`/banking/import?accountId=${account.id}`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "text-xs")}
          >
            Import CSV
          </Link>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead className="w-28">Date</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-32">Reference</TableHead>
              <TableHead className="w-28 text-right">Credit</TableHead>
              <TableHead className="w-28 text-right">Debit</TableHead>
              <TableHead className="w-20 text-center">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {account.transactions.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center py-10 text-slate-400 text-sm"
                >
                  No transactions yet — add the first one above
                </TableCell>
              </TableRow>
            ) : (
              account.transactions.map((tx) => {
                const amount = parseFloat(String(tx.amount));
                return (
                  <TableRow key={tx.id}>
                    <TableCell className="text-xs text-slate-500">
                      {formatDate(tx.transactionDate)}
                    </TableCell>
                    <TableCell className="max-w-xs truncate">
                      {tx.description}
                    </TableCell>
                    <TableCell className="text-xs text-slate-400 font-mono">
                      {tx.reference ?? "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {tx.type === "CREDIT" ? (
                        <span className="text-green-700">
                          {formatCurrency(amount, account.currency)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {tx.type === "DEBIT" ? (
                        <span className="text-red-600">
                          {formatCurrency(amount, account.currency)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <span
                        className={cn(
                          "text-xs px-1.5 py-0.5 rounded-full font-medium",
                          tx.isReconciled
                            ? "bg-green-50 text-green-700"
                            : "bg-slate-100 text-slate-500"
                        )}
                      >
                        {tx.isReconciled ? "Reconciled" : "Pending"}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
