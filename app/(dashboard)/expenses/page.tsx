import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import Link from "next/link"
import { Upload, Wallet } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { PageHeader } from "@/components/dashboard/page-header"
import { formatCurrency, formatDate, cn } from "@/lib/utils"

const statusColors: Record<string, string> = {
  DRAFT:      "bg-slate-100 text-slate-600",
  PENDING:    "bg-amber-100 text-amber-700",
  APPROVED:   "bg-blue-100 text-blue-700",
  REIMBURSED: "bg-emerald-100 text-emerald-700",
  REJECTED:   "bg-red-100 text-red-700",
}

export default async function ExpensesPage() {
  const session = await auth()
  if (!session?.user?.tenantId) redirect("/login")
  const tenantId = session.user.tenantId

  const expenses = await prisma.expense.findMany({
    where: { tenantId },
    include: {
      category: { select: { name: true } },
      campaign: { select: { campaignName: true, campaignCode: true } },
    },
    orderBy: { expenseDate: "desc" },
    take: 200,
  })

  const totalApproved = expenses
    .filter((e) => e.status === "APPROVED" || e.status === "REIMBURSED")
    .reduce((s, e) => s + parseFloat(String(e.totalAmount)), 0)

  const totalPending = expenses
    .filter((e) => e.status === "PENDING" || e.status === "DRAFT")
    .reduce((s, e) => s + parseFloat(String(e.totalAmount)), 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses"
        subtitle={`${expenses.length} expense${expenses.length !== 1 ? "s" : ""}`}
        icon={Wallet}
        color="blue"
        action={
          <Link
            href="/expenses/import"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-2")}
          >
            <Upload className="h-4 w-4" />
            Import CSV
          </Link>
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="border border-slate-200 rounded-xl p-4 bg-white shadow-sm">
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Total Expenses</p>
          <p className="text-2xl font-bold text-slate-900">{formatCurrency(totalApproved + totalPending)}</p>
          <p className="text-xs text-slate-400 mt-0.5">{expenses.length} records</p>
        </div>
        <div className="border border-blue-100 rounded-xl p-4 bg-blue-50 shadow-sm">
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Approved</p>
          <p className="text-2xl font-bold text-blue-700">{formatCurrency(totalApproved)}</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {expenses.filter((e) => e.status === "APPROVED" || e.status === "REIMBURSED").length} items
          </p>
        </div>
        <div className="border border-amber-100 rounded-xl p-4 bg-amber-50 shadow-sm">
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Pending</p>
          <p className="text-2xl font-bold text-amber-700">{formatCurrency(totalPending)}</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {expenses.filter((e) => e.status === "PENDING" || e.status === "DRAFT").length} items
          </p>
        </div>
      </div>

      {/* Expenses table */}
      {expenses.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-blue-200 rounded-xl bg-blue-50/40">
          <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center mb-3">
            <Wallet className="h-7 w-7 text-blue-400" />
          </div>
          <p className="text-slate-600 font-medium mb-1">No expenses yet</p>
          <p className="text-sm text-slate-400 mb-4">Import a Zoho Expense CSV to get started.</p>
          <Link href="/expenses/import" className={cn(buttonVariants({ size: "sm" }), "gap-2")}>
            <Upload className="h-4 w-4" />
            Import CSV
          </Link>
        </div>
      ) : (
        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-blue-50 border-b border-blue-100">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-blue-700">Date</th>
                <th className="text-left px-4 py-3 font-medium text-blue-700">Description</th>
                <th className="text-left px-4 py-3 font-medium text-blue-700">Category</th>
                <th className="text-left px-4 py-3 font-medium text-blue-700">Campaign</th>
                <th className="text-right px-4 py-3 font-medium text-blue-700">Amount</th>
                <th className="text-right px-4 py-3 font-medium text-blue-700">Tax</th>
                <th className="text-right px-4 py-3 font-medium text-blue-700">Total</th>
                <th className="text-left px-4 py-3 font-medium text-blue-700">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {expenses.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                    {formatDate(e.expenseDate.toISOString())}
                  </td>
                  <td className="px-4 py-3 text-slate-700 max-w-xs truncate">{e.description}</td>
                  <td className="px-4 py-3 text-slate-500">{e.category.name}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {e.campaign ? (
                      <span className="text-purple-700 text-xs">
                        {e.campaign.campaignCode ?? e.campaign.campaignName}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700">
                    {formatCurrency(parseFloat(String(e.amount)))}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-500">
                    {parseFloat(String(e.taxAmount)) > 0
                      ? formatCurrency(parseFloat(String(e.taxAmount)))
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-slate-900">
                    {formatCurrency(parseFloat(String(e.totalAmount)))}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      "inline-flex px-2 py-0.5 rounded-full text-xs font-medium",
                      statusColors[e.status] ?? "bg-slate-100 text-slate-600"
                    )}>
                      {e.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 border-t border-slate-200">
              <tr>
                <td colSpan={6} className="px-4 py-3 text-sm font-semibold text-slate-700">
                  Total ({expenses.length})
                </td>
                <td className="px-4 py-3 text-right font-bold text-slate-900">
                  {formatCurrency(expenses.reduce((s, e) => s + parseFloat(String(e.totalAmount)), 0))}
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
