import Link from "next/link";
import { CheckCircle2, FileText, Plus, Send } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buttonVariants } from "@/components/ui/button";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { QuoteRowActions } from "./quote-row-actions";

interface QuoteRow {
  id: string;
  quoteNumber: string;
  customerName: string;
  issueDate: Date;
  expiryDate: Date;
  status: string;
  currency: string;
  exchangeRate: unknown;
  totalAmount: unknown;
  reference: string | null;
  convertedInvoiceId: string | null;
  convertedInvoiceNumber: string | null;
}

export default async function QuotesPage() {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  if (!tenantId) return null;
  const canManage = ["OWNER", "ADMIN", "ACCOUNTANT"].includes(session?.user?.role ?? "");

  const rows = await prisma.$queryRaw<QuoteRow[]>`
    SELECT q."id", q."quote_number" AS "quoteNumber", c."company_name" AS "customerName",
           q."issue_date" AS "issueDate", q."expiry_date" AS "expiryDate", q."status", q."currency",
           q."exchange_rate" AS "exchangeRate", q."total_amount" AS "totalAmount", q."reference",
           q."converted_invoice_id" AS "convertedInvoiceId", i."invoice_number" AS "convertedInvoiceNumber"
    FROM "quotes" q
    INNER JOIN "customers" c ON c."id"=q."customer_id" AND c."tenant_id"=q."tenant_id"
    LEFT JOIN "invoices" i ON i."id"=q."converted_invoice_id" AND i."tenant_id"=q."tenant_id"
    WHERE q."tenant_id"=${tenantId}::uuid
    ORDER BY q."issue_date" DESC, q."created_at" DESC
  `;

  const now = new Date();
  const activePipeline = rows.filter((row) => ["DRAFT", "SENT", "ACCEPTED"].includes(row.status) && new Date(row.expiryDate) >= now);
  const pipelineBase = activePipeline.reduce((sum, row) => sum + Number(row.totalAmount) * Number(row.exchangeRate), 0);
  const sentCount = rows.filter((row) => row.status === "SENT" && new Date(row.expiryDate) >= now).length;
  const acceptedCount = rows.filter((row) => row.status === "ACCEPTED").length;

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[36px] font-medium tracking-[-0.02em] text-[var(--text-primary)]">Quotes</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Commercial proposals before billing. Quotes do not affect the General Ledger.</p>
        </div>
        {canManage ? <Link href="/sales/quotes/new" className={cn(buttonVariants(), "gap-1.5")}><Plus className="h-4 w-4" /> New quote</Link> : null}
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Metric icon={FileText} label="Active pipeline" value={formatCurrency(pipelineBase)} />
        <Metric icon={Send} label="Sent quotes" value={String(sentCount)} />
        <Metric icon={CheckCircle2} label="Accepted awaiting invoice" value={String(acceptedCount)} />
      </section>
      <p className="text-xs text-[var(--text-secondary)]">Pipeline value is shown in NGN equivalent using each quote&apos;s commercial exchange-rate snapshot. It is not Revenue and does not appear in the ledger.</p>

      {!rows.length ? (
        <div className="grid min-h-80 place-items-center rounded-xl border border-dashed border-[var(--app-border)] bg-white px-6 py-14 text-center">
          <div className="max-w-md">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-[var(--surface-muted)] text-[var(--finos-accent)]"><FileText className="h-5 w-5" /></div>
            <h2 className="font-serif mt-5 text-xl font-medium text-[var(--text-primary)]">No quotes yet</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">Prepare a proposal, send it to the customer and convert an accepted quote into a Draft Invoice when billing is ready.</p>
          </div>
        </div>
      ) : (
        <section className="overflow-hidden rounded-xl border border-[var(--app-border)] bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] text-sm">
              <thead className="bg-[var(--surface-muted)] text-left text-xs text-[var(--text-secondary)]">
                <tr>
                  <th className="px-5 py-3 font-medium">Quote</th>
                  <th className="px-5 py-3 font-medium">Customer</th>
                  <th className="px-5 py-3 font-medium">Issue date</th>
                  <th className="px-5 py-3 font-medium">Valid until</th>
                  <th className="px-5 py-3 font-medium">Subject</th>
                  <th className="px-5 py-3 text-right font-medium">Quote value</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Invoice</th>
                  {canManage ? <th className="px-5 py-3 text-right font-medium">Action</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--app-border)]">
                {rows.map((row) => {
                  const expired = new Date(row.expiryDate) < now && ["DRAFT", "SENT"].includes(row.status);
                  const displayStatus = expired ? "EXPIRED" : row.status;
                  return (
                    <tr key={row.id} className="hover:bg-[var(--app-bg)]">
                      <td className="px-5 py-4 font-code text-xs font-semibold text-[var(--finos-accent)]">{row.quoteNumber}</td>
                      <td className="px-5 py-4 font-medium text-[var(--text-primary)]">{row.customerName}</td>
                      <td className="px-5 py-4 text-[var(--text-secondary)]">{formatDate(row.issueDate)}</td>
                      <td className="px-5 py-4 text-[var(--text-secondary)]">{formatDate(row.expiryDate)}</td>
                      <td className="max-w-[260px] px-5 py-4 text-[var(--text-secondary)]">{row.reference || "—"}</td>
                      <td className="px-5 py-4 text-right">
                        <p className="font-financial font-medium text-[var(--text-primary)]">{formatCurrency(Number(row.totalAmount), row.currency)}</p>
                        {row.currency !== "NGN" ? <p className="mt-1 text-[11px] text-[var(--text-secondary)]">≈ {formatCurrency(Number(row.totalAmount) * Number(row.exchangeRate))}</p> : null}
                      </td>
                      <td className="px-5 py-4"><span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-medium text-[var(--text-secondary)]">{displayStatus.toLowerCase()}</span></td>
                      <td className="px-5 py-4">{row.convertedInvoiceId ? <Link href={`/sales/invoices/${row.convertedInvoiceId}`} className="font-code text-xs text-[var(--finos-accent)] hover:underline">{row.convertedInvoiceNumber ?? "Open invoice"}</Link> : "—"}</td>
                      {canManage ? <td className="px-5 py-4 text-right"><QuoteRowActions quoteId={row.id} status={row.status} expired={expired} /></td> : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof FileText; label: string; value: string }) {
  return <div className="rounded-xl border border-[var(--app-border)] bg-white p-5"><div className="flex items-center justify-between"><p className="text-xs font-medium text-[var(--text-secondary)]">{label}</p><Icon className="h-4 w-4 text-[var(--finos-accent)]" /></div><p className="font-financial mt-3 text-[27px] font-medium text-[var(--text-primary)]">{value}</p></div>;
}
