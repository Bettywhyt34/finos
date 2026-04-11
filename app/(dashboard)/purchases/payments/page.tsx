import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DollarSign } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";

export default async function VendorPaymentsPage() {
  const session = await auth();
  const tenantId = session!.user.tenantId!;

  const payments = await prisma.vendorPayment.findMany({
    where: { tenantId },
    include: {
      vendor: { select: { companyName: true } },
    },
    orderBy: { paymentDate: "desc" },
  });

  const totalPaid = payments.reduce((s, p) => s + parseFloat(String(p.amount)), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Vendor Payments</h1>
        <p className="text-sm text-slate-500 mt-1">
          {payments.length} payment{payments.length !== 1 ? "s" : ""} · Total: {formatCurrency(totalPaid)}
        </p>
      </div>

      {payments.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-slate-200 rounded-xl">
          <DollarSign className="h-10 w-10 text-slate-300 mb-3" />
          <p className="text-slate-500 font-medium mb-1">No vendor payments yet</p>
          <p className="text-sm text-slate-400">Record payments from the bill detail page.</p>
        </div>
      ) : (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Reference</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Vendor</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Date</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Method</th>
                <th className="text-right px-4 py-3 font-medium text-slate-500">Amount</th>
                <th className="text-right px-4 py-3 font-medium text-slate-500">WHT</th>
                <th className="text-right px-4 py-3 font-medium text-slate-500">Net Paid</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payments.map((p) => {
                const wht = parseFloat(String(p.whtAmount));
                const net = parseFloat(String(p.amount)) - wht;
                return (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-blue-600">{p.paymentNumber}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{p.vendor.companyName}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(p.paymentDate)}</td>
                    <td className="px-4 py-3 text-slate-500">{p.method.replace("_", " ")}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatCurrency(parseFloat(String(p.amount)))}</td>
                    <td className="px-4 py-3 text-right font-mono text-amber-600">{wht > 0 ? formatCurrency(wht) : "—"}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-red-600">{formatCurrency(net)}</td>
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
