import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { BillActions } from "./bill-actions";

const statusColors: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600",
  RECORDED: "bg-blue-100 text-blue-700",
  PARTIAL: "bg-amber-100 text-amber-700",
  PAID: "bg-green-100 text-green-700",
  OVERDUE: "bg-red-100 text-red-700",
};

export default async function BillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const tenantId = session!.user.tenantId!;

  const [bill, tenant] = await Promise.all([
    prisma.bill.findFirst({
      where: { id, tenantId },
      include: {
        vendor: true,
        lines: { include: { item: { select: { name: true, itemCode: true } } } },
      },
    }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } }),
  ]);

  if (!bill || !tenant) notFound();

  const currency = bill.currency.trim().toUpperCase();
  const baseCurrency = tenant.currency.trim().toUpperCase();
  const rate = parseFloat(String(bill.exchangeRate));
  const isBaseCurrency = currency === baseCurrency;
  const balance = parseFloat(String(bill.totalAmount)) - parseFloat(String(bill.amountPaid));
  const baseTotal = Math.round(parseFloat(String(bill.totalAmount)) * rate * 100) / 100;
  const isWht = bill.vendor.isWhtEligible;

  const [openBills, bankAccounts] = await Promise.all([
    prisma.bill.findMany({
      where: {
        tenantId,
        vendorId: bill.vendorId,
        currency,
        status: { in: ["RECORDED", "PARTIAL", "OVERDUE"] },
      },
      select: { id: true, billNumber: true, totalAmount: true, amountPaid: true, dueDate: true },
      orderBy: { dueDate: "asc" },
    }),
    prisma.$queryRaw<Array<{ id: string; accountName: string; bankName: string; currency: string }>>`
      SELECT ba."id", ba."account_name" AS "accountName", ba."bank_name" AS "bankName", ba."currency"
      FROM "bank_accounts" ba
      INNER JOIN "chart_of_accounts" coa
        ON coa."id" = ba."ledger_account_id"
       AND coa."tenant_id" = ba."tenant_id"
       AND coa."type" = 'ASSET'
       AND coa."is_active" = true
      WHERE ba."tenant_id" = ${tenantId}::uuid
        AND ba."is_active" = true
        AND upper(ba."currency") = ${currency}
      ORDER BY ba."account_name" ASC
    `,
  ]);

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/purchases/bills" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Bills
          </Link>
          <span className="text-slate-300">/</span>
          <span className="font-mono text-sm font-semibold">{bill.billNumber}</span>
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColors[bill.status] || ""}`}>
            {bill.status}
          </span>
          {!isBaseCurrency && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
              {currency}
            </span>
          )}
        </div>
        <BillActions
          bill={{
            id: bill.id,
            status: bill.status,
            vendorId: bill.vendorId,
            balance,
            isWhtEligible: isWht,
            currency,
            exchangeRate: rate,
            baseCurrency,
          }}
          openBills={openBills.map((b) => ({
            id: b.id,
            billNumber: b.billNumber,
            balance: parseFloat(String(b.totalAmount)) - parseFloat(String(b.amountPaid)),
          }))}
          bankAccounts={bankAccounts}
        />
      </div>

      {!isBaseCurrency && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm">
          <span className="text-amber-700">Transaction rate:</span>
          <span className="font-mono font-semibold text-amber-900">1 {currency} = {rate.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} {baseCurrency}</span>
          <span className="text-amber-500 mx-2">·</span>
          <span className="text-amber-700">Base-currency total:</span>
          <span className="font-mono font-semibold text-amber-900">{formatCurrency(baseTotal, baseCurrency)}</span>
        </div>
      )}

      <div className="border border-slate-200 rounded-xl p-6">
        <div className="flex justify-between mb-6">
          <div>
            <p className="text-2xl font-bold text-slate-900">{bill.billNumber}</p>
            <p className="text-slate-500 mt-1">From: <span className="font-medium text-slate-900">{bill.vendor.companyName}</span></p>
            {bill.vendorRef && <p className="text-sm text-slate-400">Vendor ref: {bill.vendorRef}</p>}
          </div>
          <div className="text-right">
            <p className="text-sm text-slate-500">Bill Date: <span className="text-slate-900">{formatDate(bill.billDate)}</span></p>
            <p className="text-sm text-slate-500 mt-1">Due: <span className="text-slate-900">{formatDate(bill.dueDate)}</span></p>
            {!isBaseCurrency && <p className="text-sm text-slate-500 mt-1">Currency: <span className="font-semibold text-amber-700">{currency}</span></p>}
          </div>
        </div>

        <table className="w-full text-sm mb-4">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left py-2 font-medium text-slate-500">Description</th>
              <th className="text-right py-2 font-medium text-slate-500">Qty</th>
              <th className="text-right py-2 font-medium text-slate-500">Rate ({currency})</th>
              <th className="text-right py-2 font-medium text-slate-500">Amount ({currency})</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {bill.lines.map((line) => (
              <tr key={line.id}>
                <td className="py-2.5">
                  <p className="font-medium text-slate-900">{line.description}</p>
                  {line.item && <p className="text-xs text-slate-400">{line.item.itemCode}</p>}
                </td>
                <td className="py-2.5 text-right font-mono">{parseFloat(String(line.quantity))}</td>
                <td className="py-2.5 text-right font-mono">{formatCurrency(parseFloat(String(line.rate)), currency)}</td>
                <td className="py-2.5 text-right font-mono font-medium">{formatCurrency(parseFloat(String(line.amount)), currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end">
          <div className="w-64 space-y-1.5 text-sm">
            <div className="flex justify-between pt-2 border-t border-slate-200 font-semibold">
              <span>Total ({currency})</span>
              <span className="font-mono">{formatCurrency(parseFloat(String(bill.totalAmount)), currency)}</span>
            </div>
            {!isBaseCurrency && (
              <div className="flex justify-between text-xs text-amber-600">
                <span>≈ {baseCurrency} equivalent</span>
                <span className="font-mono">{formatCurrency(baseTotal, baseCurrency)}</span>
              </div>
            )}
            {parseFloat(String(bill.amountPaid)) > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Settled ({currency})</span>
                <span className="font-mono">-{formatCurrency(parseFloat(String(bill.amountPaid)), currency)}</span>
              </div>
            )}
            <div className="flex justify-between pt-1 text-lg font-bold border-t border-slate-200">
              <span>Balance</span>
              <span className={`font-mono ${balance > 0 ? "text-red-600" : "text-green-600"}`}>
                {formatCurrency(balance, currency)}
              </span>
            </div>
          </div>
        </div>

        {!isBaseCurrency && (
          <div className="mt-6 pt-4 border-t border-slate-200">
            <p className="text-xs text-slate-400">
              Initial recognition rate: 1 {currency} = {rate.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} {baseCurrency} ·
              Base-currency total: {formatCurrency(baseTotal, baseCurrency)}. Settlement uses the actual payment-date rate entered when recording payment.
            </p>
          </div>
        )}

        {bill.notes && (
          <div className="mt-4 pt-4 border-t border-slate-200">
            <p className="text-xs text-slate-500 mb-1">Notes</p>
            <p className="text-sm text-slate-700">{bill.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}
