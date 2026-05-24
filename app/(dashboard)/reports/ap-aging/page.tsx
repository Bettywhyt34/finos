import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { formatCurrency, formatDate, toNGN } from "@/lib/utils";
import { ApAgingExport, type ApAgingRow } from "./ap-aging-export";

type Bucket = "current" | "d1_30" | "d31_60" | "d61_90" | "d90plus";

function ageBucket(dueDate: Date, today: Date): Bucket {
  const days = Math.floor((today.getTime() - dueDate.getTime()) / 86_400_000);
  if (days <= 0) return "current";
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90plus";
}

export default async function APAgingPage() {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  if (!tenantId) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const bills = await prisma.bill.findMany({
    where: {
      tenantId,
      status: { in: ["RECORDED", "PARTIAL", "OVERDUE"] },
    },
    select: {
      id: true,
      vendorId: true,
      dueDate: true,
      totalAmount: true,
      amountPaid: true,
      exchangeRate: true,
      vendor: { select: { id: true, companyName: true } },
    },
    orderBy: { dueDate: "asc" },
  });

  const map = new Map<string, ApAgingRow & { vendorId: string }>();

  for (const bill of bills) {
    const balanceDoc =
      Number(bill.totalAmount) - Number(bill.amountPaid);
    if (balanceDoc <= 0) continue;

    const amountNgn = toNGN(balanceDoc, Number(bill.exchangeRate));
    const bucket = ageBucket(bill.dueDate, today);

    if (!map.has(bill.vendorId)) {
      map.set(bill.vendorId, {
        vendorId: bill.vendorId,
        vendorName: bill.vendor.companyName,
        current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0,
      });
    }
    const row = map.get(bill.vendorId)!;
    row[bucket] += amountNgn;
    row.total += amountNgn;
  }

  const rows = Array.from(map.values()).sort((a, b) =>
    a.vendorName.localeCompare(b.vendorName)
  );

  const zero = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 };
  const totals = rows.reduce(
    (acc, r) => ({
      current: acc.current + r.current,
      d1_30:   acc.d1_30   + r.d1_30,
      d31_60:  acc.d31_60  + r.d31_60,
      d61_90:  acc.d61_90  + r.d61_90,
      d90plus: acc.d90plus + r.d90plus,
      total:   acc.total   + r.total,
    }),
    zero
  );

  const overdueTotal = totals.d1_30 + totals.d31_60 + totals.d61_90 + totals.d90plus;
  const overduePercent =
    totals.total > 0 ? ((overdueTotal / totals.total) * 100).toFixed(1) : "0.0";
  const asOf = formatDate(today);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">AP Aging</h1>
          <p className="text-sm text-slate-500 mt-1">As of {asOf} — amounts in NGN</p>
        </div>
        <ApAgingExport rows={rows} totals={totals} asOf={asOf} />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Total Payable</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{formatCurrency(totals.total)}</p>
          <p className="text-xs text-slate-400 mt-1">
            {bills.length} bill{bills.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Overdue</p>
          <p className="text-2xl font-bold text-red-600 mt-1">{formatCurrency(overdueTotal)}</p>
          <p className="text-xs text-slate-400 mt-1">{overduePercent}% of total</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Current (not yet due)</p>
          <p className="text-2xl font-bold text-emerald-600 mt-1">{formatCurrency(totals.current)}</p>
          <p className="text-xs text-slate-400 mt-1">
            {(100 - parseFloat(overduePercent)).toFixed(1)}% of total
          </p>
        </div>
      </div>

      <div className="rounded-lg border bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-slate-50">
              <th className="px-4 py-3 text-left font-semibold text-slate-600">Vendor</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600">Current</th>
              <th className="px-4 py-3 text-right font-semibold text-amber-600">1–30 days</th>
              <th className="px-4 py-3 text-right font-semibold text-orange-600">31–60 days</th>
              <th className="px-4 py-3 text-right font-semibold text-red-600">61–90 days</th>
              <th className="px-4 py-3 text-right font-semibold text-red-800">90+ days</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                  No outstanding bills
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.vendorId} className="border-b last:border-b-0 hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3 font-medium text-slate-800">{r.vendorName}</td>
                <td className="px-4 py-3 text-right text-slate-700">
                  {r.current > 0 ? formatCurrency(r.current) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-3 text-right text-amber-700">
                  {r.d1_30 > 0 ? formatCurrency(r.d1_30) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-3 text-right text-orange-700">
                  {r.d31_60 > 0 ? formatCurrency(r.d31_60) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-3 text-right text-red-600">
                  {r.d61_90 > 0 ? formatCurrency(r.d61_90) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-3 text-right text-red-800 font-medium">
                  {r.d90plus > 0 ? formatCurrency(r.d90plus) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-3 text-right font-semibold text-slate-900">
                  {formatCurrency(r.total)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 border-t-2 border-slate-200 font-semibold">
              <td className="px-4 py-3 text-slate-800">Total</td>
              <td className="px-4 py-3 text-right text-slate-900">{formatCurrency(totals.current)}</td>
              <td className="px-4 py-3 text-right text-amber-700">{formatCurrency(totals.d1_30)}</td>
              <td className="px-4 py-3 text-right text-orange-700">{formatCurrency(totals.d31_60)}</td>
              <td className="px-4 py-3 text-right text-red-600">{formatCurrency(totals.d61_90)}</td>
              <td className="px-4 py-3 text-right text-red-800">{formatCurrency(totals.d90plus)}</td>
              <td className="px-4 py-3 text-right text-slate-900">{formatCurrency(totals.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
