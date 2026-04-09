import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { formatCurrency, toNGN, cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils";
import { InvoiceActions } from "./invoice-actions";

const statusColors: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600",
  SENT: "bg-blue-100 text-blue-700",
  PARTIAL: "bg-amber-100 text-amber-700",
  PAID: "bg-green-100 text-green-700",
  OVERDUE: "bg-red-100 text-red-700",
  WRITTEN_OFF: "bg-slate-100 text-slate-400",
};

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const organizationId = session!.user.organizationId!;

  const invoice = await prisma.invoice.findFirst({
    where: { id, organizationId },
    include: {
      customer: true,
      lines: { include: { item: { select: { name: true, itemCode: true } } } },
      payments: { include: { payment: true } },
    },
  });

  if (!invoice) notFound();

  const openInvoices = await prisma.invoice.findMany({
    where: {
      organizationId,
      customerId: invoice.customerId,
      status: { in: ["SENT", "PARTIAL", "OVERDUE"] },
    },
    select: { id: true, invoiceNumber: true, balanceDue: true, dueDate: true, currency: true, exchangeRate: true },
    orderBy: { dueDate: "asc" },
  });

  const bankAccounts = await prisma.bankAccount.findMany({
    where: { organizationId, isActive: true },
    select: { id: true, accountName: true, bankName: true },
  });

  const currency = invoice.currency;
  const rate = parseFloat(String(invoice.exchangeRate));
  const isNGN = currency === "NGN";
  const balance = parseFloat(String(invoice.balanceDue));
  const totalNGN = toNGN(parseFloat(String(invoice.totalAmount)), rate);
  const balanceNGN = toNGN(balance, rate);

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/sales/invoices" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Invoices
          </Link>
          <span className="text-slate-300">/</span>
          <span className="font-mono text-sm font-semibold">{invoice.invoiceNumber}</span>
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColors[invoice.status] || ""}`}>
            {invoice.status}
          </span>
          {!isNGN && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
              {currency}
            </span>
          )}
        </div>
        <InvoiceActions
          invoice={{ id: invoice.id, status: invoice.status, customerId: invoice.customerId, balanceDue: balance }}
          openInvoices={openInvoices.map((i) => ({
            ...i,
            balanceDue: parseFloat(String(i.balanceDue)),
            exchangeRate: parseFloat(String(i.exchangeRate)),
          }))}
          bankAccounts={bankAccounts}
        />
      </div>

      {/* FX banner */}
      {!isNGN && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm">
          <span className="text-amber-700">Exchange rate:</span>
          <span className="font-mono font-semibold text-amber-900">1 {currency} = ₦{rate.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</span>
          <span className="text-amber-500 mx-2">·</span>
          <span className="text-amber-700">NGN Total:</span>
          <span className="font-mono font-semibold text-amber-900">{formatCurrency(totalNGN)}</span>
        </div>
      )}

      {/* Invoice body */}
      <div className="border border-slate-200 rounded-xl p-6">
        <div className="flex justify-between mb-6">
          <div>
            <p className="text-2xl font-bold text-slate-900">{invoice.invoiceNumber}</p>
            <p className="text-slate-500 mt-1">To: <span className="font-medium text-slate-900">{invoice.customer.companyName}</span></p>
            {invoice.customer.email && <p className="text-sm text-slate-400">{invoice.customer.email}</p>}
          </div>
          <div className="text-right">
            <p className="text-sm text-slate-500">Issue Date: <span className="text-slate-900">{formatDate(invoice.issueDate)}</span></p>
            <p className="text-sm text-slate-500 mt-1">Due Date: <span className="text-slate-900">{formatDate(invoice.dueDate)}</span></p>
            <p className="text-sm text-slate-500 mt-1">Period: <span className="font-mono text-slate-900">{invoice.recognitionPeriod}</span></p>
            {!isNGN && <p className="text-sm text-slate-500 mt-1">Currency: <span className="font-semibold text-amber-700">{currency}</span></p>}
          </div>
        </div>

        <table className="w-full text-sm mb-4">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left py-2 font-medium text-slate-500">Description</th>
              <th className="text-right py-2 font-medium text-slate-500">Qty</th>
              <th className="text-right py-2 font-medium text-slate-500">Rate ({currency})</th>
              <th className="text-right py-2 font-medium text-slate-500">Tax%</th>
              <th className="text-right py-2 font-medium text-slate-500">Amount ({currency})</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {invoice.lines.map((line) => (
              <tr key={line.id}>
                <td className="py-2.5">
                  <p className="font-medium text-slate-900">{line.description}</p>
                  {line.item && <p className="text-xs text-slate-400">{line.item.itemCode}</p>}
                </td>
                <td className="py-2.5 text-right font-mono">{parseFloat(String(line.quantity))}</td>
                <td className="py-2.5 text-right font-mono">{formatCurrency(parseFloat(String(line.rate)), currency)}</td>
                <td className="py-2.5 text-right font-mono">{parseFloat(String(line.taxRate))}%</td>
                <td className="py-2.5 text-right font-mono font-medium">{formatCurrency(parseFloat(String(line.amount)), currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end">
          <div className="w-64 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Subtotal</span>
              <span className="font-mono">{formatCurrency(parseFloat(String(invoice.subtotal)), currency)}</span>
            </div>
            {parseFloat(String(invoice.discountAmount)) > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-500">Discount</span>
                <span className="font-mono text-red-500">-{formatCurrency(parseFloat(String(invoice.discountAmount)), currency)}</span>
              </div>
            )}
            {parseFloat(String(invoice.taxAmount)) > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-500">Tax</span>
                <span className="font-mono">{formatCurrency(parseFloat(String(invoice.taxAmount)), currency)}</span>
              </div>
            )}
            <div className="flex justify-between pt-2 border-t border-slate-200 font-semibold">
              <span>Total ({currency})</span>
              <span className="font-mono">{formatCurrency(parseFloat(String(invoice.totalAmount)), currency)}</span>
            </div>
            {!isNGN && (
              <div className="flex justify-between text-xs text-amber-600">
                <span>≈ NGN equivalent</span>
                <span className="font-mono">{formatCurrency(totalNGN)}</span>
              </div>
            )}
            {parseFloat(String(invoice.amountPaid)) > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Paid</span>
                <span className="font-mono">-{formatCurrency(parseFloat(String(invoice.amountPaid)), currency)}</span>
              </div>
            )}
            <div className="flex justify-between pt-1 text-lg font-bold border-t border-slate-200">
              <span>Balance Due</span>
              <div className="text-right">
                <div className={`font-mono ${balance > 0 ? "text-amber-600" : "text-green-600"}`}>
                  {formatCurrency(balance, currency)}
                </div>
                {!isNGN && balance > 0 && (
                  <div className="text-xs text-amber-500 font-normal">≈ {formatCurrency(balanceNGN)}</div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* FX footnote */}
        {!isNGN && (
          <div className="mt-6 pt-4 border-t border-slate-200">
            <p className="text-xs text-slate-400">
              Exchange Rate: 1 {currency} = ₦{rate.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ·
              NGN Total: {formatCurrency(totalNGN)} · Journal entries posted at this rate.
            </p>
          </div>
        )}

        {invoice.notes && (
          <div className="mt-4 pt-4 border-t border-slate-200">
            <p className="text-xs text-slate-500 mb-1">Notes</p>
            <p className="text-sm text-slate-700">{invoice.notes}</p>
          </div>
        )}
      </div>

      {/* Payment history */}
      {invoice.payments.length > 0 && (
        <div>
          <h2 className="font-semibold text-slate-900 mb-3">Payment History</h2>
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium text-slate-500">Reference</th>
                  <th className="text-left px-4 py-2.5 font-medium text-slate-500">Date</th>
                  <th className="text-left px-4 py-2.5 font-medium text-slate-500">Method</th>
                  <th className="text-right px-4 py-2.5 font-medium text-slate-500">Amount (NGN)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoice.payments.map((alloc) => (
                  <tr key={alloc.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono text-xs text-blue-600">{alloc.payment.paymentNumber}</td>
                    <td className="px-4 py-2.5 text-slate-600">{formatDate(alloc.payment.paymentDate)}</td>
                    <td className="px-4 py-2.5 text-slate-500">{alloc.payment.method.replace("_", " ")}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-green-600">
                      {formatCurrency(parseFloat(String(alloc.amount)))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
