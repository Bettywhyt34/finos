import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Receipt, Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { formatCurrency, formatDate, cn } from "@/lib/utils";

const statusColors: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600",
  RECORDED: "bg-blue-100 text-blue-700",
  PARTIAL: "bg-amber-100 text-amber-700",
  PAID: "bg-green-100 text-green-700",
  OVERDUE: "bg-red-100 text-red-700",
};

export default async function BillsPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId!;

  const bills = await prisma.bill.findMany({
    where: { organizationId },
    include: { vendor: { select: { companyName: true, vendorCode: true } } },
    orderBy: { createdAt: "desc" },
  });

  const totalAP = bills.reduce((s, b) => {
    const balance = parseFloat(String(b.totalAmount)) - parseFloat(String(b.amountPaid));
    return s + balance;
  }, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Bills</h1>
          <p className="text-sm text-slate-500 mt-1">
            {bills.length} bill{bills.length !== 1 ? "s" : ""} ·
            AP: {formatCurrency(totalAP)}
          </p>
        </div>
        <Link href="/purchases/bills/new" className={buttonVariants()}>
          <Plus className="h-4 w-4 mr-1.5" />
          New Bill
        </Link>
      </div>

      {bills.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-slate-200 rounded-xl">
          <Receipt className="h-10 w-10 text-slate-300 mb-3" />
          <p className="text-slate-500 font-medium mb-1">No bills yet</p>
          <p className="text-sm text-slate-400">Record vendor bills to track AP.</p>
        </div>
      ) : (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Number</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Vendor</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Date</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Due</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Status</th>
                <th className="text-right px-4 py-3 font-medium text-slate-500">Total</th>
                <th className="text-right px-4 py-3 font-medium text-slate-500">Balance</th>
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
