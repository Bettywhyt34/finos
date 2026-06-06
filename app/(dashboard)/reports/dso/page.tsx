import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { formatCurrency, cn } from "@/lib/utils";

function toNum(v: unknown): number {
  return parseFloat(String(v ?? 0)) || 0;
}

const PERIODS = [30, 90, 365] as const;
type Period = (typeof PERIODS)[number];

function dsoColor(days: number) {
  if (days <= 30) return "text-emerald-600";
  if (days <= 60) return "text-amber-600";
  return "text-red-600";
}

export default async function DsoPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period: periodParam } = await searchParams;
  const period: Period = PERIODS.includes(Number(periodParam) as Period)
    ? (Number(periodParam) as Period)
    : 365;

  const session = await auth();
  const tenantId = session!.user.tenantId!;

  const since = new Date(Date.now() - period * 86_400_000);

  // Fetch all customers with outstanding AR
  const customers = await prisma.customer.findMany({
    where: { tenantId, isActive: true },
    select: {
      id: true,
      companyName: true,
      customerCode: true,
      invoices: {
        select: {
          status: true,
          totalAmount: true,
          balanceDue: true,
          issueDate: true,
          exchangeRate: true,
        },
      },
    },
  });

  type Row = {
    id: string;
    companyName: string;
    customerCode: string;
    arBalance: number;
    revenue: number;
    dso: number;
    invoiceCount: number;
  };

  const rows: Row[] = customers
    .map((c) => {
      const arBalance = c.invoices
        .filter((i) => ["SENT", "PARTIAL", "OVERDUE"].includes(i.status))
        .reduce((s, i) => s + toNum(i.balanceDue), 0);

      const revenue = c.invoices
        .filter(
          (i) =>
            !["DRAFT", "VOIDED"].includes(i.status) &&
            new Date(i.issueDate) >= since
        )
        .reduce((s, i) => s + toNum(i.totalAmount), 0);

      const dso = revenue > 0 ? Math.round((arBalance / revenue) * period) : 0;

      const invoiceCount = c.invoices.filter((i) =>
        ["SENT", "PARTIAL", "OVERDUE"].includes(i.status)
      ).length;

      return { id: c.id, companyName: c.companyName, customerCode: c.customerCode, arBalance, revenue, dso, invoiceCount };
    })
    .filter((r) => r.arBalance > 0 || r.revenue > 0)
    .sort((a, b) => b.dso - a.dso);

  const totalAR = rows.reduce((s, r) => s + r.arBalance, 0);
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const overallDso = totalRevenue > 0 ? Math.round((totalAR / totalRevenue) * period) : 0;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Dashboard
          </Link>
          <span className="text-slate-300">/</span>
          <h1 className="text-xl font-bold text-slate-900">Days Sales Outstanding</h1>
        </div>

        {/* Period toggle */}
        <div className="flex items-center gap-1 border border-slate-200 rounded-lg overflow-hidden text-sm">
          {PERIODS.map((p) => (
            <Link
              key={p}
              href={`/reports/dso?period=${p}`}
              className={cn(
                "px-3 py-1.5 font-medium transition-colors",
                period === p
                  ? "bg-indigo-600 text-white"
                  : "text-slate-500 hover:bg-slate-50"
              )}
            >
              {p}d
            </Link>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Overall DSO</p>
          <p className={`text-2xl font-bold mt-1 ${dsoColor(overallDso)}`}>
            {overallDso > 0 ? `${overallDso} days` : "—"}
          </p>
          <p className="text-xs text-slate-400 mt-1">Last {period} days revenue</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Total AR</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{formatCurrency(totalAR)}</p>
          <p className="text-xs text-slate-400 mt-1">Outstanding balance</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Revenue ({period}d)</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{formatCurrency(totalRevenue)}</p>
          <p className="text-xs text-slate-400 mt-1">Invoiced in period</p>
        </div>
      </div>

      {/* Per-customer table */}
      <div className="rounded-lg border bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-slate-50">
              <th className="px-4 py-3 text-left font-semibold text-slate-600">Customer</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600">Open Invoices</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600">AR Balance</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600">Revenue ({period}d)</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600">DSO</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                  No data available
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-b last:border-b-0 hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3">
                  <Link href={`/customers/${r.id}`} className="font-medium text-slate-800 hover:text-blue-600 hover:underline">
                    {r.companyName}
                  </Link>
                  <span className="ml-2 font-mono text-xs text-slate-400">{r.customerCode}</span>
                </td>
                <td className="px-4 py-3 text-right text-slate-600">{r.invoiceCount}</td>
                <td className="px-4 py-3 text-right font-mono text-slate-700">
                  {r.arBalance > 0 ? formatCurrency(r.arBalance) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-3 text-right font-mono text-slate-700">
                  {r.revenue > 0 ? formatCurrency(r.revenue) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-3 text-right font-mono font-semibold">
                  {r.dso > 0 ? (
                    <span className={dsoColor(r.dso)}>{r.dso}d</span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-slate-50 border-t-2 border-slate-200 font-semibold">
                <td className="px-4 py-3 text-slate-800">Total</td>
                <td className="px-4 py-3 text-right text-slate-800">
                  {rows.reduce((s, r) => s + r.invoiceCount, 0)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-slate-800">{formatCurrency(totalAR)}</td>
                <td className="px-4 py-3 text-right font-mono text-slate-800">{formatCurrency(totalRevenue)}</td>
                <td className={`px-4 py-3 text-right font-mono ${dsoColor(overallDso)}`}>
                  {overallDso > 0 ? `${overallDso}d` : "—"}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="text-xs text-slate-400">
        DSO = (Customer AR Balance ÷ Customer Revenue in last {period} days) × {period}.
        Colour: <span className="text-emerald-600 font-medium">≤30d good</span> ·{" "}
        <span className="text-amber-600 font-medium">31–60d watch</span> ·{" "}
        <span className="text-red-600 font-medium">&gt;60d concern</span>
      </p>
    </div>
  );
}
