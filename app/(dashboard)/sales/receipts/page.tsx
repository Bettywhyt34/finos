import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { CreditCard, Landmark, ReceiptText, ShieldCheck } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";

interface PaymentEvidenceRow {
  id: string;
  status: string;
  whtAmount: unknown;
  currency: string;
  exchangeRate: unknown;
  bankAccountId: string | null;
  bankName: string | null;
  accountName: string | null;
  baseArAmount: unknown;
  baseSettlementAmount: unknown;
}

export default async function ReceiptsPage() {
  const session = await auth();
  const tenantId = session!.user.tenantId!;

  const [payments, evidenceRows] = await Promise.all([
    prisma.customerPayment.findMany({
      where: { tenantId },
      include: {
        customer: { select: { companyName: true } },
        allocations: { include: { invoice: { select: { invoiceNumber: true } } } },
      },
      orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
    }),
    prisma.$queryRaw<PaymentEvidenceRow[]>`
      SELECT cp."id",
             cp."status"::text AS "status",
             cp."wht_amount" AS "whtAmount",
             cp."currency",
             cp."exchange_rate" AS "exchangeRate",
             cp."bank_account_id" AS "bankAccountId",
             ba."bank_name" AS "bankName",
             ba."account_name" AS "accountName",
             COALESCE(SUM(cpa."base_ar_amount"), 0) AS "baseArAmount",
             COALESCE(SUM(cpa."base_settlement_amount"), 0) AS "baseSettlementAmount"
      FROM "customer_payments" cp
      LEFT JOIN "bank_accounts" ba
        ON ba."id" = cp."bank_account_id" AND ba."tenant_id" = cp."tenant_id"
      LEFT JOIN "customer_payment_allocations" cpa ON cpa."payment_id" = cp."id"
      WHERE cp."tenant_id" = ${tenantId}::uuid
      GROUP BY cp."id", cp."status", cp."wht_amount", cp."currency", cp."exchange_rate",
               cp."bank_account_id", ba."bank_name", ba."account_name"
    `,
  ]);

  const evidenceByPayment = new Map(evidenceRows.map((row) => [row.id, row]));
  const postedPayments = payments.filter((payment) => (evidenceByPayment.get(payment.id)?.status ?? "POSTED") === "POSTED");

  const cashReceivedBase = postedPayments.reduce((sum, payment) => {
    const evidence = evidenceByPayment.get(payment.id);
    return sum + Number(payment.amount) * Number(evidence?.exchangeRate ?? 1);
  }, 0);
  const whtReceivedBase = postedPayments.reduce((sum, payment) => {
    const evidence = evidenceByPayment.get(payment.id);
    return sum + Number(evidence?.whtAmount ?? 0) * Number(evidence?.exchangeRate ?? 1);
  }, 0);
  const arClearedBase = postedPayments.reduce((sum, payment) => sum + Number(evidenceByPayment.get(payment.id)?.baseArAmount ?? 0), 0);

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <div>
        <h1 className="text-[36px] font-medium tracking-[-0.02em] text-[var(--text-primary)]">Customer receipts</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Money received from customers, WHT credits and the Accounts Receivable balances settled.
        </p>
      </div>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={ReceiptText} label="Posted receipts" value={String(postedPayments.length)} />
        <Metric icon={Landmark} label="Cash received" value={formatCurrency(cashReceivedBase)} />
        <Metric icon={ShieldCheck} label="WHT receivable" value={formatCurrency(whtReceivedBase)} />
        <Metric icon={CreditCard} label="AR cleared" value={formatCurrency(arClearedBase)} />
      </section>
      <p className="text-xs text-[var(--text-secondary)]">Headline accounting totals are shown in NGN, FINOS&apos;s base ledger currency. Each receipt below remains in its original transaction currency.</p>

      {payments.length === 0 ? (
        <div className="grid min-h-80 place-items-center rounded-xl border border-dashed border-[var(--app-border)] bg-white px-6 py-14 text-center">
          <div className="max-w-md">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-[var(--surface-muted)] text-[var(--finos-accent)]"><CreditCard className="h-5 w-5" /></div>
            <h2 className="font-serif mt-5 text-xl font-medium text-[var(--text-primary)]">No customer receipts yet</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">Record a receipt from an open invoice. FINOS will keep the customer allocation and accounting journal together.</p>
          </div>
        </div>
      ) : (
        <section className="overflow-hidden rounded-xl border border-[var(--app-border)] bg-white">
          <div className="border-b border-[var(--app-border)] px-6 py-5">
            <h2 className="font-serif text-xl font-medium text-[var(--text-primary)]">Receipt register</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1250px] text-sm">
              <thead className="bg-[var(--surface-muted)] text-left text-xs text-[var(--text-secondary)]">
                <tr>
                  <th className="px-5 py-3 font-medium">Receipt</th>
                  <th className="px-5 py-3 font-medium">Customer</th>
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium">Received into</th>
                  <th className="px-5 py-3 font-medium">Method</th>
                  <th className="px-5 py-3 font-medium">Invoices</th>
                  <th className="px-5 py-3 text-right font-medium">Cash</th>
                  <th className="px-5 py-3 text-right font-medium">WHT</th>
                  <th className="px-5 py-3 text-right font-medium">AR settled</th>
                  <th className="px-5 py-3 text-right font-medium">NGN settlement</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--app-border)]">
                {payments.map((payment) => {
                  const evidence = evidenceByPayment.get(payment.id);
                  const currency = evidence?.currency ?? "NGN";
                  const rate = Number(evidence?.exchangeRate ?? 1);
                  const cash = Number(payment.amount);
                  const wht = Number(evidence?.whtAmount ?? 0);
                  const settled = cash + wht;
                  const status = evidence?.status ?? "POSTED";
                  return (
                    <tr key={payment.id} className="hover:bg-[var(--app-bg)]">
                      <td className="px-5 py-4">
                        <p className="font-code text-xs font-semibold text-[var(--finos-accent)]">{payment.paymentNumber}</p>
                        <p className="mt-1 text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">{status.toLowerCase()}</p>
                      </td>
                      <td className="px-5 py-4 font-medium text-[var(--text-primary)]">{payment.customer.companyName}</td>
                      <td className="px-5 py-4 text-[var(--text-secondary)]">{formatDate(payment.paymentDate)}</td>
                      <td className="px-5 py-4 text-[var(--text-secondary)]">{evidence?.bankName ? `${evidence.bankName} · ${evidence.accountName}` : cash > 0 ? "Unmapped legacy receipt" : "No cash portion"}</td>
                      <td className="px-5 py-4 text-[var(--text-secondary)]">{payment.method.replaceAll("_", " ").toLowerCase()}</td>
                      <td className="px-5 py-4 text-xs">
                        {payment.allocations.map((allocation) => (
                          <Link key={allocation.id} href={`/sales/invoices/${allocation.invoiceId}`} className="mr-2 text-[var(--finos-accent)] hover:underline">{allocation.invoice.invoiceNumber}</Link>
                        ))}
                      </td>
                      <td className="font-financial tabular-nums px-5 py-4 text-right font-medium text-[var(--text-primary)]">{formatCurrency(cash, currency)}</td>
                      <td className="font-financial tabular-nums px-5 py-4 text-right text-[var(--text-primary)]">{wht > 0 ? formatCurrency(wht, currency) : "—"}</td>
                      <td className="font-financial tabular-nums px-5 py-4 text-right font-medium text-[var(--text-primary)]">{formatCurrency(settled, currency)}</td>
                      <td className="px-5 py-4 text-right">
                        <p className="font-financial tabular-nums font-medium text-[var(--text-primary)]">{formatCurrency(Number(evidence?.baseSettlementAmount ?? settled * rate))}</p>
                        {currency !== "NGN" ? <p className="mt-1 font-code text-[11px] text-[var(--text-secondary)]">1 {currency} = ₦{rate.toLocaleString("en-NG", { maximumFractionDigits: 6 })}</p> : null}
                      </td>
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

function Metric({ icon: Icon, label, value }: { icon: typeof ReceiptText; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--app-border)] bg-white p-5">
      <div className="flex items-center justify-between"><p className="text-xs font-medium text-[var(--text-secondary)]">{label}</p><Icon className="h-4 w-4 text-[var(--finos-accent)]" /></div>
      <p className="font-financial mt-3 text-[27px] font-medium text-[var(--text-primary)]">{value}</p>
    </div>
  );
}
