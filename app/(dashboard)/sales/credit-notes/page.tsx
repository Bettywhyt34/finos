import Link from "next/link";
import { CreditCard, FileMinus2, ReceiptText } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDate } from "@/lib/utils";
import { CreditNoteForm, type CreditEligibleInvoice } from "./credit-note-form";
import { ReverseCreditNoteButton } from "./reverse-credit-note-button";

interface CreditNoteRow {
  id:string; creditNumber:string; invoiceId:string; invoiceNumber:string; customerName:string;
  issueDate:Date; amount:unknown; baseAmount:unknown; arAppliedAmount:unknown; customerCreditAmount:unknown;
  currency:string; exchangeRate:unknown; reason:string; status:string;
}
interface EligibleRow {
  id:string; invoiceNumber:string; customerName:string; currency:string; balanceDue:unknown; totalAmount:unknown; credited:unknown;
}

export default async function CreditNotesPage() {
  const session=await auth();
  const tenantId=session?.user?.tenantId;
  if(!tenantId) return null;
  const canManage=["OWNER","ADMIN","ACCOUNTANT"].includes(session?.user?.role??"");

  const [rows,eligible]=await Promise.all([
    prisma.$queryRaw<CreditNoteRow[]>`
      SELECT cn."id",cn."credit_number" AS "creditNumber",cn."invoice_id" AS "invoiceId",i."invoice_number" AS "invoiceNumber",
             c."company_name" AS "customerName",cn."issue_date" AS "issueDate",cn."amount",cn."base_amount" AS "baseAmount",
             cn."ar_applied_amount" AS "arAppliedAmount",cn."customer_credit_amount" AS "customerCreditAmount",
             cn."currency",cn."exchange_rate" AS "exchangeRate",cn."reason",cn."status"::text AS "status"
      FROM "credit_notes" cn JOIN "invoices" i ON i."id"=cn."invoice_id" AND i."tenant_id"=cn."tenant_id"
      JOIN "customers" c ON c."id"=cn."customer_id" AND c."tenant_id"=cn."tenant_id"
      WHERE cn."tenant_id"=${tenantId}::uuid ORDER BY cn."issue_date" DESC,cn."created_at" DESC
    `,
    prisma.$queryRaw<EligibleRow[]>`
      SELECT i."id",i."invoice_number" AS "invoiceNumber",c."company_name" AS "customerName",i."currency",i."balance_due" AS "balanceDue",i."total_amount" AS "totalAmount",
             COALESCE((SELECT SUM(cn."amount") FROM "credit_notes" cn WHERE cn."tenant_id"=i."tenant_id" AND cn."invoice_id"=i."id" AND cn."status"='APPLIED'::"CreditNoteStatus"),0) AS "credited"
      FROM "invoices" i JOIN "customers" c ON c."id"=i."customer_id" AND c."tenant_id"=i."tenant_id"
      WHERE i."tenant_id"=${tenantId}::uuid
        AND i."status" NOT IN ('DRAFT','VOIDED','WRITTEN_OFF')
        AND NOT EXISTS (SELECT 1 FROM "invoice_lines" il WHERE il."invoice_id"=i."id" AND il."project_id" IS NOT NULL)
      ORDER BY i."issue_date" DESC
    `,
  ]);

  const formInvoices:CreditEligibleInvoice[]=eligible
    .map((invoice)=>({id:invoice.id,invoiceNumber:invoice.invoiceNumber,customerName:invoice.customerName,currency:invoice.currency,balanceDue:Number(invoice.balanceDue),creditableRemaining:Math.max(0,Number(invoice.totalAmount)-Number(invoice.credited))}))
    .filter((invoice)=>invoice.creditableRemaining>0.01);
  const applied=rows.filter((row)=>row.status==="APPLIED");
  const arCredited=applied.reduce((sum,row)=>sum+Number(row.arAppliedAmount??0)*Number(row.exchangeRate??1),0);
  const customerCreditCreated=applied.reduce((sum,row)=>sum+Number(row.customerCreditAmount??0)*Number(row.exchangeRate??1),0);

  return <div className="mx-auto max-w-[1500px] space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-[36px] font-medium tracking-[-0.02em] text-[var(--text-primary)]">Credit notes</h1><p className="mt-1 text-sm text-[var(--text-secondary)]">Reduce billed customer value without confusing the adjustment with cash collection.</p></div>{canManage?<CreditNoteForm invoices={formInvoices}/>:null}</header>
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-3"><Metric icon={FileMinus2} label="Applied credit notes" value={String(applied.length)}/><Metric icon={CreditCard} label="AR reduced" value={formatCurrency(arCredited)}/><Metric icon={ReceiptText} label="Customer credit created" value={formatCurrency(customerCreditCreated)}/></section>
    <p className="text-xs text-[var(--text-secondary)]">A credit note can reduce open AR and, where the invoice was already settled, create a customer-credit liability. Neither outcome is a new customer payment.</p>
    {!rows.length?<div className="grid min-h-80 place-items-center rounded-xl border border-dashed border-[var(--app-border)] bg-white px-6 py-14 text-center"><div className="max-w-md"><FileMinus2 className="mx-auto h-6 w-6 text-[var(--finos-accent)]"/><h2 className="font-serif mt-5 text-xl font-medium">No credit notes yet</h2><p className="mt-2 text-sm text-[var(--text-secondary)]">Create a controlled billing adjustment against an eligible invoice.</p></div></div>:
    <section className="overflow-hidden rounded-xl border border-[var(--app-border)] bg-white"><div className="border-b border-[var(--app-border)] px-6 py-5"><h2 className="font-serif text-xl font-medium">Credit note register</h2></div><div className="overflow-x-auto"><table className="w-full min-w-[1380px] text-sm"><thead className="bg-[var(--surface-muted)] text-left text-xs text-[var(--text-secondary)]"><tr><th className="px-5 py-3">Credit note</th><th className="px-5 py-3">Invoice</th><th className="px-5 py-3">Customer</th><th className="px-5 py-3">Date</th><th className="px-5 py-3">Reason</th><th className="px-5 py-3 text-right">Credit</th><th className="px-5 py-3 text-right">AR reduction</th><th className="px-5 py-3 text-right">Customer credit</th><th className="px-5 py-3">Status</th>{canManage?<th className="px-5 py-3 text-right">Action</th>:null}</tr></thead><tbody className="divide-y divide-[var(--app-border)]">{rows.map((row)=>{const reversed=row.status==="REVERSED";return <tr key={row.id} className={reversed?"bg-[var(--surface-muted)] opacity-70":"hover:bg-[var(--app-bg)]"}><td className="px-5 py-4 font-code text-xs font-semibold text-[var(--finos-accent)]">{row.creditNumber}</td><td className="px-5 py-4"><Link href={`/sales/invoices/${row.invoiceId}`} className="text-[var(--finos-accent)] hover:underline">{row.invoiceNumber}</Link></td><td className="px-5 py-4 font-medium">{row.customerName}</td><td className="px-5 py-4 text-[var(--text-secondary)]">{formatDate(row.issueDate)}</td><td className="max-w-[300px] px-5 py-4 text-[var(--text-secondary)]">{row.reason}</td><td className="font-financial px-5 py-4 text-right">{formatCurrency(Number(row.amount),row.currency)}</td><td className="font-financial px-5 py-4 text-right">{formatCurrency(Number(row.arAppliedAmount),row.currency)}</td><td className="font-financial px-5 py-4 text-right">{Number(row.customerCreditAmount)>0?formatCurrency(Number(row.customerCreditAmount),row.currency):"—"}</td><td className="px-5 py-4"><span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs">{row.status.toLowerCase()}</span></td>{canManage?<td className="px-5 py-4 text-right">{row.status==="APPLIED"?<ReverseCreditNoteButton creditNoteId={row.id} creditNumber={row.creditNumber}/>:<span className="text-xs text-[var(--text-secondary)]">Reversed</span>}</td>:null}</tr>})}</tbody></table></div></section>}
  </div>;
}

function Metric({icon:Icon,label,value}:{icon:typeof FileMinus2;label:string;value:string}){return <div className="rounded-xl border border-[var(--app-border)] bg-white p-5"><div className="flex items-center justify-between"><p className="text-xs font-medium text-[var(--text-secondary)]">{label}</p><Icon className="h-4 w-4 text-[var(--finos-accent)]"/></div><p className="font-financial mt-3 text-[27px] font-medium">{value}</p></div>}
