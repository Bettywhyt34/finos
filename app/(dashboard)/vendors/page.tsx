import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Truck, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { VendorForm } from "./vendor-form";
import { formatCurrency, cn } from "@/lib/utils";

export default async function VendorsPage() {
  const session = await auth();
  const tenantId = session!.user.tenantId!;

  const vendors = await prisma.vendor.findMany({
    where: { tenantId, isActive: true },
    include: {
      bills: { select: { totalAmount: true, amountPaid: true } },
    },
    orderBy: { companyName: "asc" },
  });

  const totalBalance = vendors.reduce((sum, v) => {
    const billed = v.bills.reduce((s, b) => s + parseFloat(String(b.totalAmount)), 0);
    const paid = v.bills.reduce((s, b) => s + parseFloat(String(b.amountPaid)), 0);
    return sum + (billed - paid);
  }, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Vendors</h1>
          <p className="text-sm text-slate-500 mt-1">
            {vendors.length} vendor{vendors.length !== 1 ? "s" : ""} ·
            AP Balance: {formatCurrency(totalBalance)}
          </p>
        </div>
        <VendorForm />
      </div>

      {vendors.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-slate-200 rounded-xl">
          <Truck className="h-10 w-10 text-slate-300 mb-3" />
          <p className="text-slate-500 font-medium mb-1">No vendors yet</p>
          <p className="text-sm text-slate-400">Add your first vendor to start processing bills.</p>
        </div>
      ) : (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Code</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Company</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Contact</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Email</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Terms</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">WHT</th>
                <th className="text-right px-4 py-3 font-medium text-slate-500">Balance</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {vendors.map((v) => {
                const billed = v.bills.reduce((s, b) => s + parseFloat(String(b.totalAmount)), 0);
                const paid = v.bills.reduce((s, b) => s + parseFloat(String(b.amountPaid)), 0);
                const balance = billed - paid;
                return (
                  <tr key={v.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{v.vendorCode}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{v.companyName}</td>
                    <td className="px-4 py-3 text-slate-600">{v.contactName || "—"}</td>
                    <td className="px-4 py-3 text-slate-500">{v.email || "—"}</td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary">{v.paymentTerms}d</Badge>
                    </td>
                    <td className="px-4 py-3">
                      {v.isWhtEligible && (
                        <Badge variant="outline" className="text-amber-600 border-amber-200">WHT</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-medium">
                      <span className={balance > 0 ? "text-red-600" : "text-slate-900"}>
                        {formatCurrency(balance)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/vendors/${v.id}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-7 px-2")}>
                        <ArrowRight className="h-3.5 w-3.5" />
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
