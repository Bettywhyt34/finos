import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Receipt, Plus, Upload } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/dashboard/page-header";
import { formatCurrency, formatDate, cn } from "@/lib/utils";

const statusColors: Record<string, string> = {
  DRAFT:    "bg-slate-100 text-slate-600",
  RECORDED: "bg-blue-100 text-blue-700",
  PARTIAL:  "bg-amber-100 text-amber-700",
  PAID:     "bg-emerald-100 text-emerald-700",
  OVERDUE:  "bg-red-100 text-red-700",
};

export default async function BillsPage() {
  const session = await auth();
  const tenantId = session!.user.tenantId!;

  const bills = await prisma.bill.findMany({
    where: { tenantId },
    include: { vendor: { select: { companyName: true, vendorCode: true } } },
    orderBy: { createdAt: "desc" },
  });

  const totalAP = bills.reduce((s, b) => {
    const balance = parseFloat(String(b.totalAmount)) - parseFloat(String(b.amountPaid));
    return s + balance;
  }, 0);

  const overdueCount = bills.filter(
    (b) => new Date(b.dueDate) < new Date() && b.status !== "PAID"
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bills"
        subtitle={
          <span className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-medium">
              <Receipt className="h-3 w-3" />
              {bills.length} bill{bills.length !== 1 ? "s" : ""}
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 text-xs font-medium">
              AP {formatCurrency(totalAP)}
            </span>
            {overdueCount > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-medium">
                {overdueCount} overdue
              </span>
            )}
          </span>
        }
        icon={Receipt}
        color="amber"
        action={
          <div className="flex items-center gap-2">
            <Link
              href="/purchases/bills/import"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              <Upload className="h-4 w-4 mr-1.5" />
              Import from Zoho
            </Link>
            <Link href="/purchases/bills/new" className={buttonVariants()}>
              <Plus className="h-4 w-4 mr-1.5" />
              New Bill
            </Link>
          </div>
        }
      />

      {bills.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-amber-200 rounded-xl bg-amber-50/40">
          <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center mb-3">
            <Receipt className="h-7 w-7 text-amber-400" />
          </div>
          <p className="text-slate-600 font-medium mb-1">No bills yet</p>
          <p className="text-sm text-slate-400">Record vendor bills to track AP.</p>
        </div>
      ) : (
        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-amber-50 border-b border-amber-100">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-amber-700">Number</th>
                <th className="text-left px-4 py-3 font-medium text-amber-700">Vendor</th>
                <th className="text-left px-4 py-3 font-medium text-amber-700">Date</th>
                <th className="text-left px-4 py-3 font-medium text-amber-700">Due</th>
                <th className="text-left px-4 py-3 font-medium text-amber-700">Status</th>
                <th className="text-right px-4 py-3 font-medium text-amber-700">Total</th>
                <th className="text-right px-4 py-3 font-medium text-amber-700">Balance</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bills.map((b) => {
                const balance = parseFloat(String(b.totalAmount)) - parseFloat(String(b.amountPaid));
                const isOverdue = new Date(b.dueDate) < new Date() && b.status !== "PAID";
                const statusKey = isOverdue ? "OVERDUE" : b.status;
                return (
                  <tr key={b.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/purchases/bills/${b.id}`} className="font-mono text-xs text-blue-600 hover:underline">
                        {b.billNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">{b.vendor.companyName}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(b.billDate)}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(b.dueDate)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[statusKey] || ""}`}>
                        {statusKey}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{formatCurrency(parseFloat(String(b.totalAmount)))}</td>
                    <td className="px-4 py-3 text-right font-mono">
                      <span className={balance > 0 ? "text-red-600 font-semibold" : "text-slate-400"}>
                        {formatCurrency(balance)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/purchases/bills/${b.id}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-7 px-2 text-xs")}>
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
