import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/dashboard/page-header";
import { formatCurrency, toNGN, cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils";

const statusColors: Record<string, string> = {
  DRAFT:       "bg-slate-100 text-slate-600",
  SENT:        "bg-blue-100 text-blue-700",
  PARTIAL:     "bg-amber-100 text-amber-700",
  PAID:        "bg-emerald-100 text-emerald-700",
  OVERDUE:     "bg-red-100 text-red-700",
  WRITTEN_OFF: "bg-slate-100 text-slate-400",
};

export default async function InvoicesPage() {
  const session = await auth();
  const tenantId = session!.user.tenantId!;

  const invoices = await prisma.invoice.findMany({
    where: { tenantId },
    include: { customer: { select: { companyName: true } } },
    orderBy: { createdAt: "desc" },
  });

  const totalAR = invoices.reduce((s, i) => {
    const bal = parseFloat(String(i.balanceDue));
    const rate = parseFloat(String(i.exchangeRate));
    return s + toNGN(bal, rate);
  }, 0);

  const overdueCount = invoices.filter(
    (i) => new Date(i.dueDate) < new Date() && i.status !== "PAID" && i.status !== "WRITTEN_OFF"
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales Invoices"
        subtitle={
          <span className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
              <FileText className="h-3 w-3" />
              {invoices.length} invoice{invoices.length !== 1 ? "s" : ""}
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">
              AR {formatCurrency(totalAR)}
            </span>
            {overdueCount > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-medium">
                {overdueCount} overdue
              </span>
            )}
          </span>
        }
        icon={FileText}
        color="emerald"
        action={
          <Link href="/sales/invoices/new" className={buttonVariants()}>
            <Plus className="h-4 w-4 mr-1.5" />
            New Invoice
          </Link>
        }
      />

      {invoices.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-emerald-200 rounded-xl bg-emerald-50/40">
          <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mb-3">
            <FileText className="h-7 w-7 text-emerald-400" />
          </div>
          <p className="text-slate-600 font-medium mb-1">No invoices yet</p>
          <p className="text-sm text-slate-400">Create your first invoice to start tracking AR.</p>
        </div>
      ) : (
        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-emerald-50 border-b border-emerald-100">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-emerald-700">Number</th>
                <th className="text-left px-4 py-3 font-medium text-emerald-700">Customer</th>
                <th className="text-left px-4 py-3 font-medium text-emerald-700">Date</th>
                <th className="text-left px-4 py-3 font-medium text-emerald-700">Due</th>
                <th className="text-left px-4 py-3 font-medium text-emerald-700">Status</th>
                <th className="text-right px-4 py-3 font-medium text-emerald-700">Total</th>
                <th className="text-right px-4 py-3 font-medium text-emerald-700">Balance (NGN)</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.map((inv) => {
                const balance = parseFloat(String(inv.balanceDue));
                const rate = parseFloat(String(inv.exchangeRate));
                const balanceNGN = toNGN(balance, rate);
                const totalNGN = toNGN(parseFloat(String(inv.totalAmount)), rate);
                const isNGN = inv.currency === "NGN";
                const isOverdue = new Date(inv.dueDate) < new Date() && inv.status !== "PAID" && inv.status !== "WRITTEN_OFF";
                const statusKey = isOverdue ? "OVERDUE" : inv.status;
                return (
                  <tr key={inv.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/sales/invoices/${inv.id}`} className="font-mono text-xs text-blue-600 hover:underline">
                        {inv.invoiceNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">{inv.customer.companyName}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(inv.issueDate)}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(inv.dueDate)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[statusKey] || ""}`}>
                          {statusKey}
                        </span>
                        {!isNGN && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
                            {inv.currency}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      <div>{formatCurrency(parseFloat(String(inv.totalAmount)), inv.currency)}</div>
                      {!isNGN && <div className="text-xs text-slate-400">≈ {formatCurrency(totalNGN)}</div>}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      <span className={balanceNGN > 0 ? "text-amber-600 font-semibold" : "text-slate-400"}>
                        {formatCurrency(balanceNGN)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/sales/invoices/${inv.id}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-7 px-2 text-xs")}>
                        View
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
