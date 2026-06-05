import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import Link from "next/link"
import { TrendingUp, ArrowRight, Tag } from "lucide-react"
import { PageHeader } from "@/components/dashboard/page-header"
import { formatCurrency, formatDate, cn } from "@/lib/utils"

export default async function CampaignsReportPage() {
  const session = await auth()
  const tenantId = session!.user.tenantId!

  // Load all campaigns with linked financials
  const campaigns = await prisma.revflowCampaign.findMany({
    where: { tenantId },
    include: {
      invoices: {
        select: { totalAmount: true, paidAmount: true, currency: true, exchangeRate: true },
      },
      bills: {
        select: { totalAmount: true, amountPaid: true, currency: true, exchangeRate: true },
      },
      expenses: {
        select: { totalAmount: true },
      },
    },
    orderBy: { syncedAt: "desc" },
  })

  // Aggregate per campaign (all values in NGN)
  const rows = campaigns.map((c) => {
    const revenue = c.invoices.reduce((s, inv) => {
      const rate = parseFloat(String(inv.exchangeRate)) || 1
      return s + parseFloat(String(inv.totalAmount)) * rate
    }, 0)

    const billCost = c.bills.reduce((s, b) => {
      const rate = parseFloat(String(b.exchangeRate)) || 1
      return s + parseFloat(String(b.totalAmount)) * rate
    }, 0)

    const expenseCost = c.expenses.reduce((s: number, e: { totalAmount: unknown }) => s + parseFloat(String(e.totalAmount)), 0)

    const totalCost = billCost + expenseCost
    const profit = revenue - totalCost
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0

    return {
      id: c.id,
      campaignName: c.campaignName,
      clientName: c.clientName,
      campaignCode: c.campaignCode,
      startDate: c.startDate,
      endDate: c.endDate,
      status: c.status,
      revenue,
      billCost,
      expenseCost,
      totalCost,
      profit,
      margin,
      invoiceCount: c.invoices.length,
      billCount: c.bills.length,
      expenseCount: c.expenses.length,
    }
  })

  const totals = rows.reduce(
    (s, r) => ({
      revenue:     s.revenue     + r.revenue,
      totalCost:   s.totalCost   + r.totalCost,
      profit:      s.profit      + r.profit,
    }),
    { revenue: 0, totalCost: 0, profit: 0 }
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campaign P&L"
        subtitle={
          <span className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 text-xs font-medium">
              <Tag className="h-3 w-3" />
              {campaigns.length} campaign{campaigns.length !== 1 ? "s" : ""}
            </span>
          </span>
        }
        icon={TrendingUp}
        color="violet"
      />

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="border border-slate-200 rounded-xl p-5 bg-white shadow-sm">
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Total Revenue</p>
          <p className="text-2xl font-bold text-slate-900">{formatCurrency(totals.revenue)}</p>
        </div>
        <div className="border border-slate-200 rounded-xl p-5 bg-white shadow-sm">
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Total Cost</p>
          <p className="text-2xl font-bold text-slate-900">{formatCurrency(totals.totalCost)}</p>
        </div>
        <div className={cn(
          "border rounded-xl p-5 shadow-sm",
          totals.profit >= 0
            ? "border-emerald-200 bg-emerald-50"
            : "border-red-200 bg-red-50"
        )}>
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Net Profit</p>
          <p className={cn("text-2xl font-bold", totals.profit >= 0 ? "text-emerald-700" : "text-red-700")}>
            {formatCurrency(totals.profit)}
          </p>
        </div>
      </div>

      {/* Campaigns table */}
      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-purple-200 rounded-xl bg-purple-50/40">
          <div className="w-14 h-14 rounded-full bg-purple-100 flex items-center justify-center mb-3">
            <Tag className="h-7 w-7 text-purple-400" />
          </div>
          <p className="text-slate-600 font-medium mb-1">No campaigns yet</p>
          <p className="text-sm text-slate-400">Campaigns sync automatically from Revflow.</p>
        </div>
      ) : (
        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-purple-50 border-b border-purple-100">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-purple-700">Campaign</th>
                <th className="text-left px-4 py-3 font-medium text-purple-700">Client</th>
                <th className="text-left px-4 py-3 font-medium text-purple-700">Flight</th>
                <th className="text-right px-4 py-3 font-medium text-purple-700">Revenue</th>
                <th className="text-right px-4 py-3 font-medium text-purple-700">Bills</th>
                <th className="text-right px-4 py-3 font-medium text-purple-700">Expenses</th>
                <th className="text-right px-4 py-3 font-medium text-purple-700">Net P&amp;L</th>
                <th className="text-right px-4 py-3 font-medium text-purple-700">Margin</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50 group">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{row.campaignName}</p>
                    {row.campaignCode && (
                      <p className="text-xs text-slate-400 font-mono">{row.campaignCode}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{row.clientName}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {row.startDate ? formatDate(row.startDate.toISOString()) : "—"}
                    {row.endDate ? ` → ${formatDate(row.endDate.toISOString())}` : ""}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-slate-900">
                    {formatCurrency(row.revenue)}
                    <p className="text-xs text-slate-400">{row.invoiceCount} inv</p>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600">
                    {formatCurrency(row.billCost)}
                    <p className="text-xs text-slate-400">{row.billCount} bills</p>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600">
                    {formatCurrency(row.expenseCost)}
                    <p className="text-xs text-slate-400">{row.expenseCount} exp</p>
                  </td>
                  <td className={cn(
                    "px-4 py-3 text-right font-semibold",
                    row.profit >= 0 ? "text-emerald-700" : "text-red-600"
                  )}>
                    {formatCurrency(row.profit)}
                  </td>
                  <td className={cn(
                    "px-4 py-3 text-right text-sm font-medium",
                    row.margin >= 20 ? "text-emerald-700"
                    : row.margin >= 0 ? "text-amber-600"
                    : "text-red-600"
                  )}>
                    {row.margin.toFixed(1)}%
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/reports/campaigns/${row.id}`}
                      className="inline-flex items-center gap-1 text-xs text-purple-600 hover:text-purple-800 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      Details
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
            {/* Totals row */}
            <tfoot className="bg-slate-50 border-t border-slate-200">
              <tr>
                <td colSpan={3} className="px-4 py-3 text-sm font-semibold text-slate-700">
                  Total ({rows.length} campaigns)
                </td>
                <td className="px-4 py-3 text-right font-semibold text-slate-900">
                  {formatCurrency(totals.revenue)}
                </td>
                <td className="px-4 py-3 text-right font-semibold text-slate-700">
                  {formatCurrency(rows.reduce((s, r) => s + r.billCost, 0))}
                </td>
                <td className="px-4 py-3 text-right font-semibold text-slate-700">
                  {formatCurrency(rows.reduce((s, r) => s + r.expenseCost, 0))}
                </td>
                <td className={cn(
                  "px-4 py-3 text-right font-bold",
                  totals.profit >= 0 ? "text-emerald-700" : "text-red-600"
                )}>
                  {formatCurrency(totals.profit)}
                </td>
                <td className={cn(
                  "px-4 py-3 text-right font-semibold",
                  totals.revenue > 0
                    ? totals.profit / totals.revenue >= 0.2 ? "text-emerald-700" : "text-amber-600"
                    : "text-slate-500"
                )}>
                  {totals.revenue > 0
                    ? ((totals.profit / totals.revenue) * 100).toFixed(1) + "%"
                    : "—"}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
