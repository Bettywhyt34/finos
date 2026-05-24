import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Truck, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/dashboard/page-header";
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
      <PageHeader
        title="Vendors"
        subtitle={
          <span className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 text-xs font-medium">
              <Truck className="h-3 w-3" />
              {vendors.length} vendor{vendors.length !== 1 ? "s" : ""}
            </span>
            {totalBalance > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-medium">
                AP {formatCurrency(totalBalance)}
              </span>
            )}
          </span>
        }
        icon={Truck}
        color="orange"
        action={<VendorForm />}
      />

      {vendors.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-orange-200 rounded-xl bg-orange-50/40">
          <div className="w-14 h-14 rounded-full bg-orange-100 flex items-center justify-center mb-3">
            <Truck className="h-7 w-7 text-orange-400" />
          </div>
          <p className="text-slate-600 font-medium mb-1">No vendors yet</p>
          <p className="text-sm text-slate-400">Add your first vendor to start processing bills.</p>
        </div>
      ) : (
        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-orange-50 border-b border-orange-100">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-orange-700">Code</th>
                <th className="text-left px-4 py-3 font-medium text-orange-700">Company</th>
                <th className="text-left px-4 py-3 font-medium text-orange-700">Contact</th>
                <th className="text-left px-4 py-3 font-medium text-orange-700">Email</th>
                <th className="text-left px-4 py-3 font-medium text-orange-700">Terms</th>
                <th className="text-left px-4 py-3 font-medium text-orange-700">WHT</th>
                <th className="text-right px-4 py-3 font-medium text-orange-700">Balance</th>
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
