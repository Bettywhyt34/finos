import Link from "next/link";
import { CreditCard, Landmark, ReceiptText } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDate } from "@/lib/utils";
import { CustomerCreditActions, type CustomerCreditView, type CreditBankOption, type CreditInvoiceOption } from "./customer-credit-actions";
import { CustomerCreditMovementReversal } from "./movement-reversal-button";

interface CreditRow {
  id:string; customerId:string; customerName:string; creditNumber:string; creditNoteId:string;
  currency:string; exchangeRate:unknown; originalAmount:unknown; remainingAmount:unknown;
  originalBaseAmount:unknown; remainingBaseAmount:unknown; status:string; createdAt:Date;
}
interface ApplicationRow {
  id:string; creditNumber:string; invoiceId:string; invoiceNumber:string; customerName:string;
  amount:unknown; baseCreditAmount:unknown; baseArAmount:unknown; status:string; appliedAt:Date;
}
interface RefundRow {
  id:string; creditNumber:string; customerName:string; bankName:string; accountName:string;
  currency:string; amount:unknown; baseCreditAmount:unknown; baseSettlementAmount:unknown; status:string; refundedAt:Date; reference:string|null;
}

export default async function CustomerCreditsPage() {
  const session=await auth();
  const tenantId=session?.user?.tenantId;
  if(!tenantId) return null;
  const canManage=["OWNER","ADMIN","ACCOUNTANT"].includes(session?.user?.role??"");

  const [rows,invoices,banks,applications,refunds]=await Promise.all([
    prisma.$queryRaw<CreditRow[]>`
      SELECT cc."id",cc."customer_id" AS "customerId",c."company_name" AS "customerName",
             cn."credit_number" AS "creditNumber",cc."credit_note_id" AS "creditNoteId",cc."currency",
             cc."exchange_rate" AS "exchangeRate",cc."original_amount" AS "originalAmount",cc."remaining_amount" AS "remainingAmount",
             cc."original_base_amount" AS "originalBaseAmount",cc."remaining_base_amount" AS "remainingBaseAmount",cc."status",cc."created_at" AS "createdAt"
      FROM "customer_credits" cc
      JOIN "customers" c ON c."id"=cc."customer_id" AND c."tenant_id"=cc."tenant_id"
      JOIN "credit_notes" cn ON cn."id"=cc."credit_note_id" AND cn."tenant_id"=cc."tenant_id"
      WHERE cc."tenant_id"=${tenantId}::uuid ORDER BY cc."created_at" DESC
    `,
    prisma.invoice.findMany({where:{tenantId,status:{in:["SENT","PARTIAL","OVERDUE"]},balanceDue:{gt:0}},select:{id:true,customerId:true,invoiceNumber:true,currency:true,balanceDue:true},orderBy:{issueDate:"desc"}}),
    prisma.$queryRaw<Array<{id:string;accountName:string;bankName:string;currency:string}>>`
      SELECT ba."id",ba."account_name" AS "accountName",ba."bank_name" AS "bankName",ba."currency"
      FROM "bank_accounts" ba JOIN "chart_of_accounts" coa ON coa."id"=ba."ledger_account_id" AND coa."tenant_id"=ba."tenant_id"
      WHERE ba."tenant_id"=${tenantId}::uuid AND ba."is_active"=true AND coa."is_active"=true AND coa."type"::text='ASSET'
      ORDER BY ba."currency",ba."bank_name",ba."account_name"
    `,
    prisma.$queryRaw<ApplicationRow[]>`
      SELECT cca."id",cn."credit_number" AS "creditNumber",cca."invoice_id" AS "invoiceId",i."invoice_number" AS "invoiceNumber",
             c."company_name" AS "customerName",cca."amount",cca."base_credit_amount" AS "baseCreditAmount",cca."base_ar_amount" AS "baseArAmount",
             cca."status",cca."applied_at" AS "appliedAt"
      FROM "customer_credit_applications" cca
      JOIN "customer_credits" cc ON cc."id"=cca."customer_credit_id" AND cc."tenant_id"=cca."tenant_id"
      JOIN "credit_notes" cn ON cn."id"=cc."credit_note_id"
      JOIN "customers" c ON c."id"=cc."customer_id" AND c."tenant_id"=cc."tenant_id"
      JOIN "invoices" i ON i."id"=cca."invoice_id" AND i."tenant_id"=cca."tenant_id"
      WHERE cca."tenant_id"=${tenantId}::uuid ORDER BY cca."applied_at" DESC LIMIT 50
    `,
    prisma.$queryRaw<RefundRow[]>`
      SELECT ccr."id",cn."credit_number" AS "creditNumber",c."company_name" AS "customerName",
             ba."bank_name" AS "bankName",ba."account_name" AS "accountName",ccr."currency",ccr."amount",
             ccr."base_credit_amount" AS "baseCreditAmount",ccr."base_settlement_amount" AS "baseSettlementAmount",
             ccr."status",ccr."refunded_at" AS "refundedAt",ccr."reference"
      FROM "customer_credit_refunds" ccr
      JOIN "customer_credits" cc ON cc."id"=ccr."customer_credit_id" AND cc."tenant_id"=ccr."tenant_id"
      JOIN "credit_notes" cn ON cn."id"=cc."credit_note_id"
      JOIN "customers" c ON c."id"=cc."customer_id" AND c."tenant_id"=cc."tenant_id"
      JOIN "bank_accounts" ba ON ba."id"=ccr."bank_account_id" AND ba."tenant_id"=ccr."tenant_id"
      WHERE ccr."tenant_id"=${tenantId}::uuid ORDER BY ccr."refunded_at" DESC LIMIT 50
    `,
  ]);

  const invoiceOptions:CreditInvoiceOption[]=invoices.map((invoice)=>({id:invoice.id,customerId:invoice.customerId,invoiceNumber:invoice.invoiceNumber,currency:invoice.currency,balanceDue:Number(invoice.balanceDue)}));
  const bankOptions:CreditBankOption[]=banks;
  const openRows=rows.filter((row)=>row.status==="OPEN");
  const openBase=openRows.reduce((sum,row)=>sum+Number(row.remainingBaseAmount),0);
  const originalBase=rows.filter((row)=>row.status!=="REVERSED").reduce((sum,row)=>sum+Number(row.originalBaseAmount),0);

  return <div className="mx-auto max-w-[1500px] space-y-5">
    <header><h1 className="text-[36px] font-medium tracking-[-0.02em] text-[var(--text-primary)]">Customer credits</h1><p className="mt-1 text-sm text-[var(--text-secondary)]">Liabilities owed to customers after a credit note exceeds open Accounts Receivable.</p></header>
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-3"><Metric icon={CreditCard} label="Open customer credits" value={String(openRows.length)}/><Metric icon={ReceiptText} label="Open liability" value={formatCurrency(openBase)}/><Metric icon={Landmark} label="Credits created" value={formatCurrency(originalBase)}/></section>
    <p className="text-xs text-[var(--text-secondary)]">Base-ledger totals are shown in NGN. Applying a credit to an invoice reduces AR but does not count as cash collected. Refunds reduce the liability and the selected bank balance.</p>

    {!rows.length?<div className="grid min-h-80 place-items-center rounded-xl border border-dashed border-[var(--app-border)] bg-white px-6 py-14 text-center"><div className="max-w-md"><div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-[var(--surface-muted)] text-[var(--finos-accent)]"><CreditCard className="h-5 w-5"/></div><h2 className="font-serif mt-5 text-xl font-medium">No customer credits yet</h2><p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">When a credit note exceeds an invoice&apos;s open AR, FINOS will create the excess here as a customer-credit liability.</p></div></div>:
    <section className="overflow-hidden rounded-xl border border-[var(--app-border)] bg-white"><div className="border-b border-[var(--app-border)] px-6 py-5"><h2 className="font-serif text-xl font-medium">Customer credit register</h2></div><div className="overflow-x-auto"><table className="w-full min-w-[1280px] text-sm"><thead className="bg-[var(--surface-muted)] text-left text-xs text-[var(--text-secondary)]"><tr><th className="px-5 py-3">Credit note</th><th className="px-5 py-3">Customer</th><th className="px-5 py-3">Created</th><th className="px-5 py-3 text-right">Original credit</th><th className="px-5 py-3 text-right">Remaining</th><th className="px-5 py-3 text-right">NGN carrying value</th><th className="px-5 py-3">Status</th>{canManage?<th className="px-5 py-3 text-right">Action</th>:null}</tr></thead><tbody className="divide-y divide-[var(--app-border)]">{rows.map((row)=>{const view:CustomerCreditView={id:row.id,customerId:row.customerId,customerName:row.customerName,creditNumber:row.creditNumber,currency:row.currency,exchangeRate:Number(row.exchangeRate),remainingAmount:Number(row.remainingAmount)};return <tr key={row.id} className={row.status==="REVERSED"?"bg-[var(--surface-muted)] opacity-70":"hover:bg-[var(--app-bg)]"}><td className="px-5 py-4"><Link href="/sales/credit-notes" className="font-code text-xs font-semibold text-[var(--finos-accent)] hover:underline">{row.creditNumber}</Link></td><td className="px-5 py-4 font-medium">{row.customerName}</td><td className="px-5 py-4 text-[var(--text-secondary)]">{formatDate(row.createdAt)}</td><td className="font-financial px-5 py-4 text-right">{formatCurrency(Number(row.originalAmount),row.currency)}</td><td className="font-financial px-5 py-4 text-right font-semibold">{formatCurrency(Number(row.remainingAmount),row.currency)}</td><td className="font-financial px-5 py-4 text-right">{formatCurrency(Number(row.remainingBaseAmount))}</td><td className="px-5 py-4"><span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs">{row.status.toLowerCase()}</span></td>{canManage?<td className="px-5 py-4 text-right">{row.status==="OPEN"?<CustomerCreditActions credit={view} invoices={invoiceOptions} bankAccounts={bankOptions}/>:<span className="text-xs text-[var(--text-secondary)]">—</span>}</td>:null}</tr>})}</tbody></table></div></section>}

    {applications.length>0?<section className="overflow-hidden rounded-xl border border-[var(--app-border)] bg-white"><div className="border-b border-[var(--app-border)] px-6 py-5"><h2 className="font-serif text-xl font-medium">Credit applications</h2><p className="mt-1 text-xs text-[var(--text-secondary)]">Customer-credit liabilities applied against open invoices. These are non-cash settlements.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-sm"><thead className="bg-[var(--surface-muted)] text-left text-xs text-[var(--text-secondary)]"><tr><th className="px-5 py-3">Credit</th><th className="px-5 py-3">Customer</th><th className="px-5 py-3">Invoice</th><th className="px-5 py-3">Date</th><th className="px-5 py-3 text-right">Applied</th><th className="px-5 py-3 text-right">AR carrying value</th><th className="px-5 py-3">Status</th>{canManage?<th className="px-5 py-3 text-right">Action</th>:null}</tr></thead><tbody className="divide-y divide-[var(--app-border)]">{applications.map((item)=><tr key={item.id} className={item.status==="REVERSED"?"opacity-60":""}><td className="px-5 py-4 font-code text-xs text-[var(--finos-accent)]">{item.creditNumber}</td><td className="px-5 py-4">{item.customerName}</td><td className="px-5 py-4"><Link href={`/sales/invoices/${item.invoiceId}`} className="text-[var(--finos-accent)] hover:underline">{item.invoiceNumber}</Link></td><td className="px-5 py-4 text-[var(--text-secondary)]">{formatDate(item.appliedAt)}</td><td className="font-financial px-5 py-4 text-right">{formatCurrency(Number(item.amount))}</td><td className="font-financial px-5 py-4 text-right">{formatCurrency(Number(item.baseArAmount))}</td><td className="px-5 py-4 text-xs">{item.status.toLowerCase()}</td>{canManage?<td className="px-5 py-4 text-right">{item.status==="POSTED"?<CustomerCreditMovementReversal type="application" id={item.id} label={`application to ${item.invoiceNumber}`}/>:"—"}</td>:null}</tr>)}</tbody></table></div></section>:null}

    {refunds.length>0?<section className="overflow-hidden rounded-xl border border-[var(--app-border)] bg-white"><div className="border-b border-[var(--app-border)] px-6 py-5"><h2 className="font-serif text-xl font-medium">Credit refunds</h2><p className="mt-1 text-xs text-[var(--text-secondary)]">Cash returned to customers from existing customer-credit liabilities.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-sm"><thead className="bg-[var(--surface-muted)] text-left text-xs text-[var(--text-secondary)]"><tr><th className="px-5 py-3">Credit</th><th className="px-5 py-3">Customer</th><th className="px-5 py-3">Refund account</th><th className="px-5 py-3">Date</th><th className="px-5 py-3 text-right">Refunded</th><th className="px-5 py-3 text-right">NGN settlement</th><th className="px-5 py-3">Reference</th><th className="px-5 py-3">Status</th>{canManage?<th className="px-5 py-3 text-right">Action</th>:null}</tr></thead><tbody className="divide-y divide-[var(--app-border)]">{refunds.map((item)=><tr key={item.id} className={item.status==="REVERSED"?"opacity-60":""}><td className="px-5 py-4 font-code text-xs text-[var(--finos-accent)]">{item.creditNumber}</td><td className="px-5 py-4">{item.customerName}</td><td className="px-5 py-4">{item.bankName} · {item.accountName}</td><td className="px-5 py-4 text-[var(--text-secondary)]">{formatDate(item.refundedAt)}</td><td className="font-financial px-5 py-4 text-right">{formatCurrency(Number(item.amount),item.currency)}</td><td className="font-financial px-5 py-4 text-right">{formatCurrency(Number(item.baseSettlementAmount))}</td><td className="px-5 py-4 text-[var(--text-secondary)]">{item.reference??"—"}</td><td className="px-5 py-4 text-xs">{item.status.toLowerCase()}</td>{canManage?<td className="px-5 py-4 text-right">{item.status==="POSTED"?<CustomerCreditMovementReversal type="refund" id={item.id} label="customer credit refund"/>:"—"}</td>:null}</tr>)}</tbody></table></div></section>:null}
  </div>;
}

function Metric({icon:Icon,label,value}:{icon:typeof CreditCard;label:string;value:string}){return <div className="rounded-xl border border-[var(--app-border)] bg-white p-5"><div className="flex items-center justify-between"><p className="text-xs font-medium text-[var(--text-secondary)]">{label}</p><Icon className="h-4 w-4 text-[var(--finos-accent)]"/></div><p className="font-financial mt-3 text-[27px] font-medium">{value}</p></div>}
