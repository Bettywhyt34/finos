import Link from "next/link";
import { AlertTriangle, ArrowRight, Clock3, FileText, Landmark, Sparkles } from "lucide-react";
import { auth } from "@/lib/auth";
import { getFinancialOverview } from "@/lib/dashboard-data";
import { formatCurrency, formatDate } from "@/lib/utils";

function money(amount: number, currency: string) {
  return formatCurrency(amount, currency);
}

export default async function DashboardPage() {
  const session = await auth();
  const tenantId = session!.user.tenantId!;
  const overview = await getFinancialOverview(tenantId);
  const { currency } = overview;

  const highValueTotal = overview.receivables
    .slice(0, 2)
    .reduce((sum, invoice) => sum + invoice.amount, 0);
  const overdueShare = overview.attention.overdueInvoiceAmount > 0
    ? Math.round((highValueTotal / overview.attention.overdueInvoiceAmount) * 100)
    : 0;
  const intelligenceTitle = overview.attention.overdueInvoiceCount > 0
    ? `Prioritise collection of ${Math.min(2, overview.attention.overdueInvoiceCount)} high-value overdue invoice${overview.attention.overdueInvoiceCount === 1 ? "" : "s"}.`
    : "Receivables are currently within their payment dates.";

  return (
    <div className="mx-auto max-w-[1600px] space-y-5">
      <div>
        <h1 className="text-[36px] font-medium leading-tight tracking-[-0.02em] text-[var(--text-primary)]">
          Financial overview
        </h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Cash, obligations, financial performance and collection priorities in one view.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <section className="rounded-xl border border-[var(--app-border)] bg-white xl:col-span-4">
          <div className="flex items-center justify-between border-b border-[var(--app-border)] px-6 py-5">
            <h2 className="text-base font-semibold text-[var(--text-primary)]">Cash position</h2>
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#E9F4F0] text-[var(--finos-accent)]">
              <Landmark className="h-4 w-4" />
            </div>
          </div>
          <div className="px-6 py-5">
            <p className="text-xs font-medium text-[var(--text-secondary)]">Total cash</p>
            <p className="font-financial mt-2 text-[34px] font-medium leading-none text-[var(--text-primary)]">
              {money(overview.cash.total, currency)}
            </p>
            <div className="mt-6 divide-y divide-[var(--app-border)] border-y border-[var(--app-border)]">
              {overview.cash.accounts.length > 0 ? overview.cash.accounts.map((account) => (
                <div key={account.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--text-primary)]">{account.name}</p>
                    <p className="truncate text-xs text-[var(--text-secondary)]">{account.bank}</p>
                  </div>
                  <p className="tabular-nums shrink-0 text-sm font-semibold text-[var(--text-primary)]">
                    {money(account.amount, currency)}
                  </p>
                </div>
              )) : (
                <p className="py-6 text-sm text-[var(--text-secondary)]">No active bank accounts yet.</p>
              )}
            </div>
          </div>
          <Link href="/banking/accounts" className="flex items-center gap-2 border-t border-[var(--app-border)] px-6 py-4 text-sm font-semibold text-[var(--finos-accent)] hover:text-[var(--finos-accent-hover)]">
            View cash and banking <ArrowRight className="h-4 w-4" />
          </Link>
        </section>

        <section className="rounded-xl border border-[var(--app-border)] bg-white xl:col-span-4">
          <div className="flex items-center justify-between border-b border-[var(--app-border)] px-6 py-5">
            <h2 className="text-base font-semibold text-[var(--text-primary)]">Attention required</h2>
            <span className="grid h-7 min-w-7 place-items-center rounded-full bg-[#F8EAEA] px-2 text-xs font-semibold text-[var(--critical)]">
              {overview.attention.overdueInvoiceCount + overview.attention.billsDueCount}
            </span>
          </div>
          <div className="space-y-3 p-5">
            <Link href="/sales/invoices" className="flex items-center gap-4 rounded-lg border border-[var(--app-border)] p-4 hover:bg-[var(--app-bg)]">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-[#F8EAEA] text-[var(--critical)]">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[var(--text-primary)]">
                  {overview.attention.overdueInvoiceCount} overdue invoice{overview.attention.overdueInvoiceCount === 1 ? "" : "s"}
                </p>
                <p className="mt-0.5 text-xs text-[var(--text-secondary)]">Total overdue</p>
              </div>
              <p className="tabular-nums text-sm font-semibold text-[var(--critical)]">
                {money(overview.attention.overdueInvoiceAmount, currency)}
              </p>
            </Link>
            <Link href="/purchases/bills" className="flex items-center gap-4 rounded-lg border border-[var(--app-border)] p-4 hover:bg-[var(--app-bg)]">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-[#FBF1DF] text-[var(--attention)]">
                <Clock3 className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[var(--text-primary)]">
                  {overview.attention.billsDueCount} bill{overview.attention.billsDueCount === 1 ? "" : "s"} due within 7 days
                </p>
                <p className="mt-0.5 text-xs text-[var(--text-secondary)]">Amount requiring planning</p>
              </div>
              <p className="tabular-nums text-sm font-semibold text-[var(--attention)]">
                {money(overview.attention.billsDueAmount, currency)}
              </p>
            </Link>
          </div>
          <Link href="/sales/invoices" className="flex items-center gap-2 border-t border-[var(--app-border)] px-6 py-4 text-sm font-semibold text-[var(--finos-accent)] hover:text-[var(--finos-accent-hover)]">
            View all alerts <ArrowRight className="h-4 w-4" />
          </Link>
        </section>

        <section className="rounded-xl border border-[var(--app-border)] bg-white xl:col-span-4">
          <div className="flex items-center justify-between border-b border-[var(--app-border)] px-6 py-5">
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">Performance</h2>
              <p className="text-xs text-[var(--text-secondary)]">Year to date · recognised journals</p>
            </div>
            <FileText className="h-4 w-4 text-[var(--text-secondary)]" />
          </div>
          <div className="grid grid-cols-2">
            {[
              ["Revenue", overview.performance.revenue],
              ["Gross profit", overview.performance.grossProfit],
              ["Operating profit", overview.performance.operatingProfit],
              ["Net profit", overview.performance.netProfit],
            ].map(([label, value], index) => (
              <div key={String(label)} className={`p-5 ${index % 2 === 0 ? "border-r" : ""} ${index < 2 ? "border-b" : ""} border-[var(--app-border)]`}>
                <p className="text-xs text-[var(--text-secondary)]">{label}</p>
                <p className="font-financial mt-2 text-xl font-medium text-[var(--text-primary)]">
                  {money(Number(value), currency)}
                </p>
              </div>
            ))}
          </div>
          <Link href="/reports/profit-loss" className="flex items-center gap-2 border-t border-[var(--app-border)] px-6 py-4 text-sm font-semibold text-[var(--finos-accent)] hover:text-[var(--finos-accent-hover)]">
            View full performance <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <section className="rounded-xl border border-[var(--app-border)] bg-white xl:col-span-4">
          <div className="flex items-center gap-3 border-b border-[var(--app-border)] px-6 py-5">
            <Sparkles className="h-5 w-5 text-[var(--finos-accent)]" />
            <h2 className="text-base font-semibold text-[var(--text-primary)]">FINOS Intelligence</h2>
          </div>
          <div className="p-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--finos-accent)]">Recommendation</p>
            <p className="font-intelligence mt-4 text-[27px] font-medium leading-[1.15] text-[var(--text-primary)]">
              {intelligenceTitle}
            </p>
            <p className="mt-4 text-sm leading-6 text-[var(--text-secondary)]">
              {overview.attention.overdueInvoiceCount > 0
                ? `The two highest-value overdue invoices represent ${overdueShare}% of the overdue balance.`
                : "Continue monitoring upcoming due dates and collection commitments."}
            </p>
            <div className="mt-6 rounded-lg bg-[var(--surface-muted)] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">Evidence</p>
              <div className="mt-3 flex items-end justify-between gap-4">
                <div>
                  <p className="font-financial text-xl font-medium text-[var(--text-primary)]">{money(highValueTotal, currency)}</p>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">Top two overdue invoices</p>
                </div>
                <p className="tabular-nums text-lg font-semibold text-[var(--finos-accent)]">{overdueShare}%</p>
              </div>
            </div>
          </div>
          <Link href="/sales/invoices" className="mx-6 mb-6 flex h-11 items-center justify-center rounded-lg bg-[var(--finos-accent)] text-sm font-semibold text-white hover:bg-[var(--finos-accent-hover)]">
            View collection priorities
          </Link>
        </section>

        <section className="overflow-hidden rounded-xl border border-[var(--app-border)] bg-white xl:col-span-8">
          <div className="flex items-center justify-between border-b border-[var(--app-border)] px-6 py-5">
            <div>
              <h2 className="font-serif text-xl font-medium text-[var(--text-primary)]">Receivables</h2>
              <p className="mt-0.5 text-xs text-[var(--text-secondary)]">Highest-value overdue invoices</p>
            </div>
            <Link href="/sales/invoices" className="text-sm font-semibold text-[var(--finos-accent)]">View all</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-[var(--surface-muted)] text-left text-xs text-[var(--text-secondary)]">
                <tr>
                  <th className="px-5 py-3 font-medium">Customer</th>
                  <th className="px-5 py-3 font-medium">Invoice</th>
                  <th className="px-5 py-3 font-medium">Due date</th>
                  <th className="px-5 py-3 text-right font-medium">Outstanding</th>
                  <th className="px-5 py-3 text-right font-medium">Days overdue</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--app-border)]">
                {overview.receivables.length > 0 ? overview.receivables.map((invoice) => (
                  <tr key={invoice.id} className="hover:bg-[var(--app-bg)]">
                    <td className="px-5 py-3 font-medium text-[var(--text-primary)]">{invoice.customerName}</td>
                    <td className="font-code px-5 py-3 text-xs text-[var(--text-primary)]">{invoice.invoiceNumber}</td>
                    <td className="px-5 py-3 text-[var(--text-secondary)]">{formatDate(invoice.dueDate)}</td>
                    <td className="tabular-nums px-5 py-3 text-right font-medium text-[var(--text-primary)]">{money(invoice.amount, currency)}</td>
                    <td className="tabular-nums px-5 py-3 text-right text-[var(--text-primary)]">{invoice.daysOverdue}</td>
                    <td className="px-5 py-3">
                      <span className="rounded-md bg-[#F8EAEA] px-2 py-1 text-xs font-medium capitalize text-[var(--critical)]">{invoice.status.toLowerCase()}</span>
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={6} className="px-6 py-14 text-center text-sm text-[var(--text-secondary)]">No overdue receivables.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
