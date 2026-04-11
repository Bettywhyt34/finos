import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { CreditCard } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { formatCurrency, formatDate, cn } from "@/lib/utils";

export default async function ReceiptsPage() {
  const session = await auth();
  const tenantId = session!.user.tenantId!;

  const payments = await prisma.customerPayment.findMany({
    where: { tenantId },
    include: {
      customer: { select: { companyName: true } },
      allocations: { include: { invoice: { select: { invoiceNumber: true } } } },
    },
    orderBy: { paymentDate: "desc" },
  });

  const totalReceived = payments.reduce((s, p) => s + parseFloat(String(p.amount)), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Customer Receipts</h1>
          <p className="text-sm text-slate-500 mt-1">
            {payments.length} payment{payments.length !== 1 ? "s" : ""} ·
            Total: {formatCurrency(totalReceived)}
          </p>
        </div>
      </div>

      {payments.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-slate-200 rounded-xl">
          <CreditCard className="h-10 w-10 text-slate-300 mb-3" />
          <p className="text-slate-500 font-medium mb-1">No receipts yet</p>
          <p className="text-sm text-slate-400">Record payments from the invoice detail page.</p>
        </div>
      ) : (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Reference</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Customer</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Date</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Method</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Invoices</th>
                <th className="text-right px-4 py-3 font-medium text-slate-500">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payments.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs text-blue-600">{p.paymentNumber}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{p.customer.companyName}</td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(p.paymentDate)}</td>
                  <td className="px-4 py-3 text-slate-500">{p.method.replace("_", " ")}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {p.allocations.map((a) => (
                      <Link key={a.id} href={`/sales/invoices/${a.invoiceId}`} className="hover:underline text-blue-600 mr-2">
                        {a.invoice.invoiceNumber}
                      </Link>
                    ))}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-green-600">
                    {formatCurrency(parseFloat(String(p.amount)))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
