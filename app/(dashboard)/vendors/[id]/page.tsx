import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Receipt } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { formatCurrency, formatDate, cn } from "@/lib/utils";

const statusColors: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600",
  RECORDED: "bg-blue-100 text-blue-700",
  PARTIAL: "bg-amber-100 text-amber-700",
  PAID: "bg-green-100 text-green-700",
  OVERDUE: "bg-red-100 text-red-700",
};

export default async function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const tenantId = session!.user.tenantId!;

  const vendor = await prisma.vendor.findFirst({
    where: { id, tenantId },
    include: {
      bills: { orderBy: { billDate: "desc" }, take: 20 },
    },
  });

  if (!vendor) notFound();

  const totalBilled = vendor.bills.reduce((s, b) => s + parseFloat(String(b.totalAmount)), 0);
  const totalPaid = vendor.bills.reduce((s, b) => s + parseFloat(String(b.amountPaid)), 0);
  const balance = totalBilled - totalPaid;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Link href="/vendors" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Vendors
        </Link>
        <span className="text-slate-300">/</span>
        <span className="font-semibold text-slate-900">{vendor.companyName}</span>
        <span className="font-mono text-xs text-slate-400">{vendor.vendorCode}</span>
        {vendor.isWhtEligible && (
          <Badge variant="outline" className="text-amber-600 border-amber-200">WHT</Badge>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Billed", value: totalBilled, cls: "text-slate-900" },
          { label: "Total Paid", value: totalPaid, cls: "text-green-600" },
          { label: "Balance Owed", value: balance, cls: balance > 0 ? "text-red-600" : "text-slate-900" },
        ].map(({ label, value, cls }) => (
          <div key={label} className="border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500 mb-1">{label}</p>
            <p className={`text-2xl font-bold font-mono ${cls}`}>{formatCurrency(value)}</p>
          </div>
        ))}
      </div>

      <div className="border border-slate-200 rounded-xl p-5 grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-slate-500 mb-0.5">Contact</p>
          <p className="font-medium">{vendor.contactName || "—"}</p>
        </div>
        <div>
          <p className="text-slate-500 mb-0.5">Email</p>
          <p className="font-medium">{vendor.email || "—"}</p>
        </div>
        <div>
          <p className="text-slate-500 mb-0.5">Phone</p>
          <p className="font-medium">{vendor.phone || "—"}</p>
        </div>
        <div>
          <p className="text-slate-500 mb-0.5">Payment Terms</p>
          <p className="font-medium">{vendor.paymentTerms} days</p>
        </div>
        {vendor.bankName && (
          <div>
            <p className="text-slate-500 mb-0.5">Bank</p>
            <p className="font-medium">{vendor.bankName}</p>
          </div>
        )}
        {vendor.bankAccount && (
          <div>
            <p className="text-slate-500 mb-0.5">Account Number</p>
            <p className="font-medium font-mono">{vendor.bankAccount}</p>
          </div>
        )}
        {vendor.address && (
          <div className="col-span-2">
            <p className="text-slate-500 mb-0.5">Address</p>
            <p className="font-medium">{vendor.address}</p>
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-900">Recent Bills</h2>
          <Link href={`/purchases/bills?vendor=${vendor.id}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            View all
          </Link>
        </div>
        {vendor.bills.length === 0 ? (
          <div className="flex flex-col items-center py-10 border border-dashed border-slate-200 rounded-xl">
            <Receipt className="h-8 w-8 text-slate-300 mb-2" />
            <p className="text-sm text-slate-400">No bills yet</p>
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
                {vendor.bills.map((b) => {
                  const bal = parseFloat(String(b.totalAmount)) - parseFloat(String(b.amountPaid));
                  return (
                    <tr key={b.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5">
                        <Link href={`/purchases/bills/${b.id}`} className="text-blue-600 hover:underline font-mono text-xs">
                          {b.billNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{formatDate(b.billDate)}</td>
                      <td className="px-4 py-2.5 text-slate-600">{formatDate(b.dueDate)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[b.status] || ""}`}>
                          {b.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(parseFloat(String(b.totalAmount)))}</td>
                      <td className="px-4 py-2.5 text-right font-mono">
                        <span className={bal > 0 ? "text-red-600" : "text-slate-400"}>{formatCurrency(bal)}</span>
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
