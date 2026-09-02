import Link from "next/link";
import { CreditCard, Landmark, ReceiptText } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDate } from "@/lib/utils";
import { CustomerCreditActions, type CustomerCreditView, type CreditBankOption, type CreditInvoiceOption } from "./customer-credit-actions";

interface CreditRow {
  id: string;
  customerId: string;
  customerName: string;
  creditNumber: string;
  creditNoteId: string;
  currency: string;
  exchangeRate: unknown;
  originalAmount: unknown;
  remainingAmount: unknown;
  originalBaseAmount: unknown;
  remainingBaseAmount: unknown;
  status: string;
  createdAt: Date;
}

export default async function CustomerCreditsPage() {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  if (!tenantId) return null;
  const canManage = ["OWNER", "ADMIN", "ACCOUNTANT"].includes(session?.user?.role ?? "");

  const [rows, invoices, banks] = await Promise.all([
    prisma.$queryRaw<CreditRow[]>`
      SELECT cc."id", cc."customer_id" AS "customerId", c."company_name" AS "customerName",
             cn."credit_number" AS "creditNumber", cc."credit_note_id" AS "creditNoteId",
             cc."currency", cc."exchange_rate" AS "exchangeRate", cc."original_amount" AS "originalAmount",
             cc."remaining_amount" AS "remainingAmount", cc."original_base_amount" AS "originalBaseAmount",
             cc."remaining_base_amount" AS "remainingBaseAmount", cc."status", cc."created_at" AS "createdAt"
      FROM "customer_credits" cc
      JOIN "customers" c ON c."id"=cc."customer_id" AND c."tenant_id"=cc."tenant_id"
      JOIN "credit_notes" cn ON cn."id"=cc."credit_note_id" AND cn."tenant_id"=cc."tenant_id"
      WHERE cc."tenant_id"=${tenantId}::uuid
      ORDER BY cc."created_at" DESC
    `,
    prisma.invoice.findMany({
      where: { tenantId, status: { in: ["SENT", "PARTIAL", "OVERDUE"] }, balanceDue: { gt: 0 } },
      select: { id: true, customerId: true, invoiceNumber: true, currency: true, balanceDue: true },
      orderBy: { issueDate: "desc" },
    }),
    prisma.$queryRaw<Array<{ id:string; accountName:string; bankName:string; currency:string }>>`
      SELECT ba."id", ba."account_name" AS "accountName", ba."bank_name" AS "bankName", ba."currency"
      FROM "bank_accounts" ba
      JOIN "chart_of_accounts" coa ON coa."id"=ba."ledger_account_id" AND coa."tenant_id"=ba."tenant_id"
      WHERE ba."tenant_id"=${tenantId}::uuid AND ba."is_active"=true AND coa."is_active"=true AND coa."type"::text='ASSET'
      ORDER BY ba."currency", ba."bank_name", ba."account_name"
    `,
  ]);

  const invoiceOptions: CreditInvoiceOption[] = invoices.map((invoice)=>({ id:invoice.id, customerId:invoice.customerId, invoiceNumber:invoice.invoiceNumber, currency:invoice.currency, balanceDue:Number(invoice.balanceDue) }));
  const bankOptions: CreditBankOption[] = banks;
  const openRows = rows.filter((row)=>row.status==="OPEN");
  const openBase = openRows.reduce((sum,row)=>sum+Number(row.remainingBaseAmount),0);
  const originalBase = rows.filter((row)=>row.status!=="REVERSED").reduce((sum,row)=>sum+Number(row.originalBaseAmount),0);

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <header>
        <h1 className="text-[36px] font-medium tracking-[-0.02em] text-[var(--text-primary)]">Customer credits</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Liabilities owed to customers after a credit note exceeds open Accounts Receivable.</p>
      </header>
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Metric icon={CreditCard} label="Open customer credits" value={String(openRows.length)} />
        <Metric icon={ReceiptText} label="Open liability" value={formatCurrency(openBase)} />
        <Metric icon={Landmark} label="Credits created" value={formatCurrency(originalBase)} />
      </section>
      <p className="text-xs text-[var(--text-secondary)]">Base-ledger totals are shown in NGN. Applying a credit to an invoice reduces AR but does not count as cash collected. Refunds reduce the liability and the selected bank balance.</p>

      {!rows.length ? (
        <div className="grid min-h-80 place-items-center rounded-xl border border-dashed border-[var(--app-border)] bg-white px-6 py-14 text-center"><div className="max-w-md"><div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-[var(--surface-muted)] text-[var(--finos-accent)]"><CreditCard className="h-5 w-5" /></div><h2 className="font-serif mt-5 text-xl font-medium text-[var(--text-primary)]">No customer credits yet</h2><p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">When a credit note exceeds an invoice&apos;s open AR, FINOS will create the excess here as a customer-credit liability.</p></div></div>
      ) : (
        <section className="overflow-hidden rounded-xl border border-[var(--app-border)] bg-white">
          <div className="border-b border-[var(--app-border)] px-6 py-5"><h2 className="font-serif text-xl font-medium text-[var(--text-primary)]">Customer credit register</h2></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[1280px] text-sm"><thead className="bg-[var(--surface-muted)] text-left text-xs text-[var(--text-secondary)]"><tr><th className="px-5 py-3 font-medium">Credit note</th><th className="px-5 py-3 font-medium">Customer</th><th className="px-5 py-3 font-medium">Created</th><th className="px-5 py-3 text-right font-medium">Original credit</th><th className="px-5 py-3 text-right font-medium">Remaining</th><th className="px-5 py-3 text-right font-medium">NGN carrying value</th><th className="px-5 py-3 font-medium">Status</th>{canManage?<th className="px-5 py-3 text-right font-medium">Action</th>:null}</tr></thead>
          <tbody className="divide-y divide-[var(--app-border)]">{rows.map((row)=>{
            const view:CustomerCreditView={ id:row.id, customerId:row.customerId, customerName:row.customerName, creditNumber:row.creditNumber, currency:row.currency, exchangeRate:Number(row.exchangeRate), remainingAmount:Number(row.remainingAmount) };
            return <tr key={row.id} className={row.status==="REVERSED"?"bg-[var(--surface-muted)] opacity-70":"hover:bg-[var(--app-bg)]"}><td className="px-5 py-4"><Link href="/sales/credit-notes" className="font-code text-xs font-semibold text-[var(--finos-accent)] hover:underline">{row.creditNumber}</Link></td><td className="px-5 py-4 font-medium text-[var(--text-primary)]">{row.customerName}</td><td className="px-5 py-4 text-[var(--text-secondary)]">{formatDate(row.createdAt)}</td><td className="font-financial px-5 py-4 text-right">{formatCurrency(Number(row.originalAmount),row.currency)}</td><td className="font-financial px-5 py-4 text-right font-semibold">{formatCurrency(Number(row.remainingAmount),row.currency)}</td><td className="font-financial px-5 py-4 text-right">{formatCurrency(Number(row.remainingBaseAmount))}</td><td className="px-5 py-4"><span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-medium text-[var(--text-secondary)]">{row.status.toLowerCase()}</span></td>{canManage?<td className="px-5 py-4 text-right">{row.status==="OPEN"?<CustomerCreditActions credit={view} invoices={invoiceOptions} bankAccounts={bankOptions}/>:<span className="text-xs text-[var(--text-secondary)]">—</span>}</td>:null}</tr>;
          })}</tbody></table></div>
        </section>
      )}
    </div>
  );
}

function Metric({icon:Icon,label,value}:{icon:typeof CreditCard;label:string;value:string}){return <div className="rounded-xl border border-[var(--app-border)] bg-white p-5"><div className="flex items-center justify-between"><p className="text-xs font-medium text-[var(--text-secondary)]">{label}</p><Icon className="h-4 w-4 text-[var(--finos-accent)]"/></div><p className="font-financial mt-3 text-[27px] font-medium text-[var(--text-primary)]">{value}</p></div>;}
