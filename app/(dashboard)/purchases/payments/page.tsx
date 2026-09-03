import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DollarSign } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { VendorPaymentActions } from "./payment-actions";

export default async function VendorPaymentsPage() {
  const session = await auth();
  const tenantId = session!.user.tenantId!;

  const payments = await prisma.$queryRaw<Array<{
    id: string;
    paymentNumber: string;
    paymentDate: Date;
    amount: unknown;
    method: string;
    whtAmount: unknown;
    currency: string;
    exchangeRate: unknown;
    status: string;
    vendorName: string;
  }>>`
    SELECT vp."id", vp."payment_number" AS "paymentNumber", vp."payment_date" AS "paymentDate",
           vp."amount", vp."method"::text AS "method", vp."wht_amount" AS "whtAmount",
           vp."currency", vp."exchange_rate" AS "exchangeRate", vp."status",
           v."company_name" AS "vendorName"
    FROM "vendor_payments" vp
    INNER JOIN "vendors" v ON v."id"=vp."vendor_id" AND v."tenant_id"=vp."tenant_id"
    WHERE vp."tenant_id"=${tenantId}::uuid
    ORDER BY vp."payment_date" DESC, vp."created_at" DESC
  `;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Vendor Payments</h1>
        <p className="text-sm text-slate-500 mt-1">
          {payments.length} payment{payments.length !== 1 ? "s" : ""}. Amounts are shown in each payment&apos;s transaction currency.
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
                <th className="text-left px-4 py-3 font-medium text-slate-500">Status</th>
                <th className="text-right px-4 py-3 font-medium text-slate-500">Gross Settled</th>
                <th className="text-right px-4 py-3 font-medium text-slate-500">WHT</th>
                <th className="text-right px-4 py-3 font-medium text-slate-500">Cash Paid</th>
                <th className="text-right px-4 py-3 font-medium text-slate-500">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payments.map((payment) => {
                const gross = Number(payment.amount);
                const wht = Number(payment.whtAmount);
                const cash = gross - wht;
                const reversed = payment.status === "REVERSED";
                return (
                  <tr key={payment.id} className={reversed ? "bg-slate-50 text-slate-400" : "hover:bg-slate-50"}>
                    <td className="px-4 py-3 font-mono text-xs">{payment.paymentNumber}</td>
                    <td className="px-4 py-3 font-medium">{payment.vendorName}</td>
                    <td className="px-4 py-3">{formatDate(payment.paymentDate)}</td>
                    <td className="px-4 py-3">{payment.method.replace("_", " ")}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${reversed ? "bg-slate-200 text-slate-600" : "bg-green-100 text-green-700"}`}>
                        {payment.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{formatCurrency(gross, payment.currency)}</td>
                    <td className="px-4 py-3 text-right font-mono">{wht > 0 ? formatCurrency(wht, payment.currency) : "—"}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold">{formatCurrency(cash, payment.currency)}</td>
                    <td className="px-4 py-3 text-right"><VendorPaymentActions paymentId={payment.id} status={payment.status} /></td>
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
