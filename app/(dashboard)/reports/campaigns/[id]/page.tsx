import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { notFound } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Tag, TrendingUp, Receipt, FileText, DollarSign } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { formatCurrency, formatDate, cn } from "@/lib/utils"

const invoiceStatusColors: Record<string, string> = {
  DRAFT:    "bg-slate-100 text-slate-600",
  SENT:     "bg-blue-100 text-blue-700",
  PARTIAL:  "bg-amber-100 text-amber-700",
  PAID:     "bg-emerald-100 text-emerald-700",
  OVERDUE:  "bg-red-100 text-red-700",
}

const billStatusColors: Record<string, string> = {
  DRAFT:    "bg-slate-100 text-slate-600",
  RECORDED: "bg-blue-100 text-blue-700",
  PARTIAL:  "bg-amber-100 text-amber-700",
  PAID:     "bg-emerald-100 text-emerald-700",
  OVERDUE:  "bg-red-100 text-red-700",
}

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const session = await auth()
  const tenantId = session!.user.tenantId!
  const { id } = await params
  const { tab = "invoices" } = await searchParams

  const campaign = await prisma.revflowCampaign.findUnique({
    where: { id },
    include: {
      invoices: {
        orderBy: { invoiceDate: "desc" },
      },
      bills: {
        include: { vendor: { select: { companyName: true } } },
        orderBy: { billDate: "desc" },
      },
      expenses: {
        include: { category: { select: { name: true } } },
        orderBy: { expenseDate: "desc" },
      },
    },
  })

  if (!campaign || campaign.tenantId !== tenantId) notFound()

  // P&L aggregation
  const revenue = campaign.invoices.reduce((s, inv) => {
    const rate = parseFloat(String(inv.exchangeRate)) || 1
    return s + parseFloat(String(inv.totalAmount)) * rate
  }, 0)
  const received = campaign.invoices.reduce((s, inv) => {
    const rate = parseFloat(String(inv.exchangeRate)) || 1
    return s + parseFloat(String(inv.paidAmount)) * rate
  }, 0)
  const billCost = campaign.bills.reduce((s, b) => {
    const rate = parseFloat(String(b.exchangeRate)) || 1
    return s + parseFloat(String(b.totalAmount)) * rate
  }, 0)
  const expenseCost = campaign.expenses.reduce((s, e) => s + parseFloat(String(e.totalAmount)), 0)
  const totalCost = billCost + expenseCost
  const profit = revenue - totalCost
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0

  const tabs = [
    { key: "invoices",  label: "Invoices",  count: campaign.invoices.length,  icon: TrendingUp },
    { key: "bills",     label: "Bills",     count: campaign.bills.length,     icon: Receipt },
    { key: "expenses",  label: "Expenses",  count: campaign.expenses.length,  icon: DollarSign },
  ]

  return (
    <div className="space-y-6">
      {/* Back + header */}
      <div className="flex items-center gap-3">
        <Link
          href="/reports/campaigns"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-8 px-2")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold text-slate-900 truncate">{campaign.campaignName}</h1>
            {campaign.campaignCode && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 text-xs font-mono">
                <Tag className="h-3 w-3" />
                {campaign.campaignCode}
              </span>
            )}
            {campaign.status && (
              <span className="inline-flex px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-medium">
                {campaign.status}
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            {campaign.clientName}
            {campaign.startDate && ` · ${formatDate(campaign.startDate.toISOString())}`}
            {campaign.endDate && ` → ${formatDate(campaign.endDate.toISOString())}`}
          </p>
        </div>
      </div>

      {/* P&L summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="border border-slate-200 rounded-xl p-4 bg-white shadow-sm">
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Revenue</p>
          <p className="text-xl font-bold text-slate-900">{formatCurrency(revenue)}</p>
          <p className="text-xs text-slate-400 mt-0.5">Received {formatCurrency(received)}</p>
        </div>
        <div className="border border-slate-200 rounded-xl p-4 bg-white shadow-sm">
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Media Cost</p>
          <p className="text-xl font-bold text-slate-900">{formatCurrency(billCost)}</p>
          <p className="text-xs text-slate-400 mt-0.5">{campaign.bills.length} bills</p>
        </div>
        <div className="border border-slate-200 rounded-xl p-4 bg-white shadow-sm">
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Expenses</p>
          <p className="text-xl font-bold text-slate-900">{formatCurrency(expenseCost)}</p>
          <p className="text-xs text-slate-400 mt-0.5">{campaign.expenses.length} items</p>
        </div>
        <div className={cn(
          "border rounded-xl p-4 shadow-sm",
          profit >= 0 ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"
        )}>
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Net P&L</p>
          <p className={cn("text-xl font-bold", profit >= 0 ? "text-emerald-700" : "text-red-700")}>
            {formatCurrency(profit)}
          </p>
          <p className={cn("text-xs mt-0.5", profit >= 0 ? "text-emerald-600" : "text-red-500")}>
            {margin.toFixed(1)}% margin
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
        {/* Tab bar */}
        <div className="flex border-b border-slate-200 bg-slate-50">
          {tabs.map((t) => {
            const Icon = t.icon
            const active = tab === t.key
            return (
              <Link
                key={t.key}
                href={`/reports/campaigns/${id}?tab=${t.key}`}
                className={cn(
                  "flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors",
                  active
                    ? "border-purple-600 text-purple-700 bg-white"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                )}
              >
                <Icon className="h-4 w-4" />
                {t.label}
                <span className={cn(
                  "text-xs px-1.5 py-0.5 rounded-full",
                  active ? "bg-purple-100 text-purple-700" : "bg-slate-200 text-slate-500"
                )}>
                  {t.count}
                </span>
              </Link>
            )
          })}
        </div>

        {/* Invoices tab */}
        {tab === "invoices" && (
          campaign.invoices.length === 0 ? (
            <EmptyTab icon={TrendingUp} message="No invoices linked to this campaign" />
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Invoice #</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Client</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Date</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Period</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">Amount</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">Paid</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {campaign.invoices.map((inv) => {
                  const rate = parseFloat(String(inv.exchangeRate)) || 1
                  return (
                    <tr key={inv.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono text-slate-500 text-xs">{inv.invoiceNumber}</td>
                      <td className="px-4 py-3 text-slate-700">{inv.clientName}</td>
                      <td className="px-4 py-3 text-slate-500">{formatDate(inv.invoiceDate.toISOString())}</td>
                      <td className="px-4 py-3 text-slate-500 font-mono text-xs">{inv.recognitionPeriod ?? "—"}</td>
                      <td className="px-4 py-3 text-right font-medium text-slate-900">
                        {formatCurrency(parseFloat(String(inv.totalAmount)) * rate)}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600">
                        {formatCurrency(parseFloat(String(inv.paidAmount)) * rate)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", invoiceStatusColors[inv.status ?? "DRAFT"] ?? "bg-slate-100 text-slate-600")}>
                          {inv.status ?? "DRAFT"}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="bg-slate-50 border-t border-slate-200">
                <tr>
                  <td colSpan={4} className="px-4 py-3 text-sm font-semibold text-slate-700">Total</td>
                  <td className="px-4 py-3 text-right font-bold text-slate-900">{formatCurrency(revenue)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-700">{formatCurrency(received)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )
        )}

        {/* Bills tab */}
        {tab === "bills" && (
          campaign.bills.length === 0 ? (
            <EmptyTab icon={Receipt} message="No bills linked to this campaign" />
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Bill #</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Vendor</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Date</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Due</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">Amount</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">Paid</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {campaign.bills.map((bill) => {
                  const rate = parseFloat(String(bill.exchangeRate)) || 1
                  const total = parseFloat(String(bill.totalAmount)) * rate
                  const paid  = parseFloat(String(bill.amountPaid))  * rate
                  return (
                    <tr key={bill.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono text-slate-500 text-xs">{bill.billNumber}</td>
                      <td className="px-4 py-3 text-slate-700">{bill.vendor.companyName}</td>
                      <td className="px-4 py-3 text-slate-500">{formatDate(bill.billDate.toISOString())}</td>
                      <td className="px-4 py-3 text-slate-500">{formatDate(bill.dueDate.toISOString())}</td>
                      <td className="px-4 py-3 text-right font-medium text-slate-900">{formatCurrency(total)}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{formatCurrency(paid)}</td>
                      <td className="px-4 py-3">
                        <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", billStatusColors[bill.status] ?? "bg-slate-100 text-slate-600")}>
                          {bill.status}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="bg-slate-50 border-t border-slate-200">
                <tr>
                  <td colSpan={4} className="px-4 py-3 text-sm font-semibold text-slate-700">Total</td>
                  <td className="px-4 py-3 text-right font-bold text-slate-900">{formatCurrency(billCost)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          )
        )}

        {/* Expenses tab */}
        {tab === "expenses" && (
          campaign.expenses.length === 0 ? (
            <EmptyTab icon={DollarSign} message="No expenses linked to this campaign" />
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Date</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Description</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Category</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {campaign.expenses.map((exp) => (
                  <tr key={exp.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-500">{formatDate(exp.expenseDate.toISOString())}</td>
                    <td className="px-4 py-3 text-slate-700">{exp.description}</td>
                    <td className="px-4 py-3 text-slate-500">{exp.category.name}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                        {exp.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-slate-900">
                      {formatCurrency(parseFloat(String(exp.totalAmount)))}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 border-t border-slate-200">
                <tr>
                  <td colSpan={4} className="px-4 py-3 text-sm font-semibold text-slate-700">Total</td>
                  <td className="px-4 py-3 text-right font-bold text-slate-900">{formatCurrency(expenseCost)}</td>
                </tr>
              </tfoot>
            </table>
          )
        )}
      </div>
    </div>
  )
}

function EmptyTab({ icon: Icon, message }: { icon: React.ElementType; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-3">
        <Icon className="h-6 w-6 text-slate-400" />
      </div>
      <p className="text-sm text-slate-500">{message}</p>
    </div>
  )
}
