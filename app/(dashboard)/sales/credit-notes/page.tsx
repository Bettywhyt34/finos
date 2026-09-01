import Link from "next/link";
import { CreditCard, FileMinus2, ReceiptText } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDate } from "@/lib/utils";
import { CreditNoteForm, type CreditEligibleInvoice } from "./credit-note-form";
import { ReverseCreditNoteButton } from "./reverse-credit-note-button";

interface CreditNoteRow {
  id: string;
  creditNumber: string;
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  issueDate: Date;
  amount: unknown;
  baseAmount: unknown;
  currency: string;
  exchangeRate: unknown;
  reason: string;
  status: string;
}

export default async function CreditNotesPage() {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  if (!tenantId) return null;
  const canManage = ["OWNER", "ADMIN", "ACCOUNTANT"].includes(session?.user?.role ?? "");

  const [rows, eligibleInvoices] = await Promise.all([
    prisma.$queryRaw<CreditNoteRow[]>`
      SELECT cn."id", cn."credit_number" AS "creditNumber",
             cn."invoice_id" AS "invoiceId", i."invoice_number" AS "invoiceNumber",
             c."company_name" AS "customerName", cn."issue_date" AS "issueDate",
             cn."amount", cn."base_amount" AS "baseAmount", cn."currency",
             cn."exchange_rate" AS "exchangeRate", cn."reason", cn."status"::text AS "status"
      FROM "credit_notes" cn
      INNER JOIN "invoices" i ON i."id" = cn."invoice_id" AND i."tenant_id" = cn."tenant_id"
      INNER JOIN "customers" c ON c."id" = cn."customer_id" AND c."tenant_id" = cn."tenant_id"
      WHERE cn."tenant_id" = ${tenantId}::uuid
      ORDER BY cn."issue_date" DESC, cn."created_at" DESC
    `,
    prisma.invoice.findMany({
      where: {
        tenantId,
        status: { in: ["SENT", "PARTIAL", "OVERDUE"] },
        balanceDue: { gt: 0 },
        lines: { none: { projectId: { not: null } } },
      },
      select: {
        id: true,
        invoiceNumber: true,
        currency: true,
        balanceDue: true,
        customer: { select: { companyName: true } },
      },
      orderBy: { issueDate: "desc" },
    }),
  ]);

  const formInvoices: CreditEligibleInvoice[] = eligibleInvoices.map((invoice) => ({
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    customerName: invoice.customer.companyName,
    currency: invoice.currency,
    balanceDue: Number(invoice.balanceDue),
  }));

  const applied = rows.filter((row) => row.status === "APPLIED");
  const baseTotal = applied.reduce((sum, row) => sum + Number(row.baseAmount ?? 0), 0);
  const customers = new Set(applied.map((row) => row.customerName)).size;

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[36px] font-medium tracking-[-0.02em] text-[var(--text-primary)]">Credit notes</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Controlled reductions of customer Accounts Receivable against existing invoices.</p>
        </div>
        {canManage ? <CreditNoteForm invoices={formInvoices} /> : null}
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Metric icon={FileMinus2} label="Applied credit notes" value={String(applied.length)} />
        <Metric icon={CreditCard} label="AR credited" value={formatCurrency(baseTotal)} />
        <Metric icon={ReceiptText} label="Customers adjusted" value={String(customers)} />
      </section>
      <p className="text-xs text-[var(--text-secondary)]">Portfolio accounting totals are shown in NGN base-ledger currency. Each credit note retains the invoice transaction currency and original invoice exchange rate.</p>

      {!rows.length ? (
        <div className="grid min-h-80 place-items-center rounded-xl border border-dashed border-[var(--app-border)] bg-white px-6 py-14 text-center">
          <div className="max-w-md">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-[var(--surface-muted)] text-[var(--finos-accent)]"><FileMinus2 className="h-5 w-5" /></div>
            <h2 className="font-serif mt-5 text-xl font-medium text-[var(--text-primary)]">No credit notes yet</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">Create a credit note against an eligible invoice when a billed amount needs to be reduced. FINOS keeps the credit and its accounting journal together.</p>
            {!formInvoices.length ? <p className="mt-2 text-xs text-[var(--text-secondary)]">There are currently no eligible non-Project invoices with outstanding AR.</p> : null}
          </div>
        </div>
      ) : (
        <section className="overflow-hidden rounded-xl border border-[var(--app-border)] bg-white">
          <div className="border-b border-[var(--app-border)] px-6 py-5"><h2 className="font-serif text-xl font-medium text-[var(--text-primary)]">Credit note register</h2></div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1240px] text-sm">
              <thead className="bg-[var(--surface-muted)] text-left text-xs text-[var(--text-secondary)]">
                <tr>
                  <th className="px-5 py-3 font-medium">Credit note</th>
                  <th className="px-5 py-3 font-medium">Invoice</th>
                  <th className="px-5 py-3 font-medium">Customer</th>
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium">Reason</th>
                  <th className="px-5 py-3 text-right font-medium">Credit</th>
                  <th className="px-5 py-3 text-right font-medium">NGN amount</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  {canManage ? <th className="px-5 py-3 text-right font-medium">Action</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--app-border)]">
                {rows.map((row) => {
                  const rate = Number(row.exchangeRate ?? 1);
                  const reversed = row.status === "REVERSED";
                  return (
                    <tr key={row.id} className={reversed ? "bg-[var(--surface-muted)] opacity-70" : "hover:bg-[var(--app-bg)]"}>
                      <td className="px-5 py-4 font-code text-xs font-semibold text-[var(--finos-accent)]">{row.creditNumber}</td>
                      <td className="px-5 py-4"><Link href={`/sales/invoices/${row.invoiceId}`} className="text-[var(--finos-accent)] hover:underline">{row.invoiceNumber}</Link></td>
                      <td className="px-5 py-4 font-medium text-[var(--text-primary)]">{row.customerName}</td>
                      <td className="px-5 py-4 text-[var(--text-secondary)]">{formatDate(row.issueDate)}</td>
                      <td className="max-w-[340px] px-5 py-4 text-[var(--text-secondary)]">{row.reason}</td>
                      <td className="font-financial px-5 py-4 text-right font-medium text-[var(--text-primary)]">{formatCurrency(Number(row.amount), row.currency)}</td>
                      <td className="px-5 py-4 text-right">
                        <p className="font-financial font-medium text-[var(--text-primary)]">{formatCurrency(Number(row.baseAmount))}</p>
                        {row.currency !== "NGN" ? <p className="mt-1 font-code text-[11px] text-[var(--text-secondary)]">1 {row.currency} = ₦{rate.toLocaleString("en-NG", { maximumFractionDigits: 6 })}</p> : null}
                      </td>
                      <td className="px-5 py-4"><span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-medium text-[var(--text-secondary)]">{row.status.toLowerCase()}</span></td>
                      {canManage ? (
                        <td className="px-5 py-4 text-right">
                          {row.status === "APPLIED" ? <ReverseCreditNoteButton creditNoteId={row.id} creditNumber={row.creditNumber} /> : <span className="text-xs text-[var(--text-secondary)]">{reversed ? "Reversed" : "—"}</span>}
                        </td>
                      ) : null}
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

function Metric({ icon: Icon, label, value }: { icon: typeof FileMinus2; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--app-border)] bg-white p-5">
      <div className="flex items-center justify-between"><p className="text-xs font-medium text-[var(--text-secondary)]">{label}</p><Icon className="h-4 w-4 text-[var(--finos-accent)]" /></div>
      <p className="font-financial mt-3 text-[27px] font-medium text-[var(--text-primary)]">{value}</p>
    </div>
  );
}
