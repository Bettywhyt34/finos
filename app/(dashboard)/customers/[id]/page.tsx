import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { formatCurrency, formatDate, cn } from "@/lib/utils";

const statusColors: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600",
  SENT: "bg-blue-100 text-blue-700",
  PARTIAL: "bg-amber-100 text-amber-700",
  PAID: "bg-green-100 text-green-700",
  OVERDUE: "bg-red-100 text-red-700",
  WRITTEN_OFF: "bg-slate-100 text-slate-400",
};

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const tenantId = session!.user.tenantId!;

  const customer = await prisma.customer.findFirst({
    where: { id, tenantId },
    include: {
      invoices: {
        orderBy: { issueDate: "desc" },
        take: 20,
      },
      payments: {
        orderBy: { paymentDate: "desc" },
        take: 10,
      },
    },
  });

  if (!customer) notFound();

  const totalInvoiced = customer.invoices.reduce((s, i) => s + parseFloat(String(i.totalAmount)), 0);
  const totalPaid = customer.invoices.reduce((s, i) => s + parseFloat(String(i.amountPaid)), 0);
  const balance = totalInvoiced - totalPaid;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Link href="/customers" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Customers
        </Link>
        <span className="text-slate-300">/</span>
        <span className="font-semibold text-slate-900">{customer.companyName}</span>
        <span className="font-mono text-xs text-slate-400">{customer.customerCode}</span>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Invoiced", value: totalInvoiced, cls: "text-slate-900" },
          { label: "Total Paid", value: totalPaid, cls: "text-green-600" },
          { label: "Balance Due", value: balance, cls: balance > 0 ? "text-amber-600" : "text-slate-900" },
        ].map(({ label, value, cls }) => (
          <div key={label} className="border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500 mb-1">{label}</p>
            <p className={`text-2xl font-bold font-mono ${cls}`}>{formatCurrency(value)}</p>
          </div>
        ))}
      </div>

      {/* Info */}
      <div className="border border-slate-200 rounded-xl p-5 grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-slate-500 mb-0.5">Contact</p>
          <p className="font-medium text-slate-900">{customer.contactName || "—"}</p>
        </div>
        <div>
          <p className="text-slate-500 mb-0.5">Email</p>
          <p className="font-medium text-slate-900">{customer.email || "—"}</p>
        </div>
        <div>
          <p className="text-slate-500 mb-0.5">Phone</p>
          <p className="font-medium text-slate-900">{customer.phone || "—"}</p>
        </div>
        <div>
          <p className="text-slate-500 mb-0.5">Payment Terms</p>
          <p className="font-medium text-slate-900">{customer.paymentTerms} days</p>
        </div>
        {customer.creditLimit && (
          <div>
            <p className="text-slate-500 mb-0.5">Credit Limit</p>
            <p className="font-medium text-slate-900">{formatCurrency(parseFloat(String(customer.creditLimit)))}</p>
          </div>
        )}
        {customer.billingAddress && (
          <div className="col-span-2">
            <p className="text-slate-500 mb-0.5">Billing Address</p>
            <p className="font-medium text-slate-900">{customer.billingAddress}</p>
          </div>
        )}
      </div>

      {/* Recent Invoices */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-900">Recent Invoices</h2>
          <Link href={`/sales/invoices?customer=${customer.id}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            View all
          </Link>
        </div>
        {customer.invoices.length === 0 ? (
          <div className="flex flex-col items-center py-10 border border-dashed border-slate-200 rounded-xl">
            <FileText className="h-8 w-8 text-slate-300 mb-2" />
            <p className="text-sm text-slate-400">No invoices yet</p>
          </div>
        ) : (
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium text-slate-500">Number</th>
                  <th className="text-left px-4 py-2.5 font-medium text-slate-500">Date</th>
                  <th className="text-left px-4 py-2.5 font-medium text-slate-500">Due</th>
                  <th className="text-left px-4 py-2.5 font-medium text-slate-500">Status</th>
                  <th className="text-right px-4 py-2.5 font-medium text-slate-500">Total</th>
                  <th className="text-right px-4 py-2.5 font-medium text-slate-500">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {customer.invoices.map((inv) => {
                  const bal = parseFloat(String(inv.balanceDue));
                  return (
                    <tr key={inv.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5">
                        <Link href={`/sales/invoices/${inv.id}`} className="text-blue-600 hover:underline font-mono text-xs">
                          {inv.invoiceNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{formatDate(inv.issueDate)}</td>
                      <td className="px-4 py-2.5 text-slate-600">{formatDate(inv.dueDate)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[inv.status] || ""}`}>
                          {inv.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(parseFloat(String(inv.totalAmount)))}</td>
                      <td className="px-4 py-2.5 text-right font-mono">
                        <span className={bal > 0 ? "text-amber-600" : "text-slate-400"}>{formatCurrency(bal)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
