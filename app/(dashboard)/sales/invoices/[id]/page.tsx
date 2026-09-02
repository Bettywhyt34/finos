import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, LockKeyhole, Printer } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { formatCurrency, cn, formatDate } from "@/lib/utils";
import { InvoiceActions } from "./invoice-actions";
import { RecogniseRevenueButton } from "./recognise-revenue-button";
import { getInvoiceDisplayStatus } from "@/lib/invoices/display-status";
import { prepareInvoicePdfData } from "@/lib/pdf/invoice-data";
import { InvoicePreview } from "@/components/invoices/invoice-preview";
import {
  InvoiceAccountingTabs,
  type InvoicePaymentTabRow,
  type InvoiceRecognitionTabRow,
  type InvoiceProjectTabRow,
  type InvoiceAuditTabRow,
} from "./invoice-accounting-tabs";

const statusColors: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600", SENT: "bg-blue-100 text-blue-700", PARTIAL: "bg-amber-100 text-amber-700",
  PAID: "bg-green-100 text-green-700", SETTLED: "bg-teal-100 text-teal-700", OVERDUE: "bg-red-100 text-red-700",
  WRITTEN_OFF: "bg-slate-100 text-slate-400", VOIDED: "bg-red-100 text-red-500 line-through",
};
interface ReceiptDestinationRow { id: string; accountName: string; bankName: string; currency: string; }
interface PaymentDbRow { id: string; paymentNumber: string; paymentDate: Date; method: string; amount: unknown; currency: string; status: string; }
interface RecognitionDbRow { id: string; kind: string; date: Date; amountBase: unknown; status: string; note: string | null; }
interface ProjectDbRow { id: string; description: string; projectName: string; projectCode: string | null; incomeAccount: string; invoiceAmountBase: unknown; contractAssetCleared: unknown; immediateRevenue: unknown; unearnedCreated: unknown; }
interface AuditDbRow { id: string; date: Date; source: string; reference: string | null; description: string; }

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const tenantId = session!.user.tenantId!;

  const [pdfData, meta, convertedQuoteRows, tenant] = await Promise.all([
    prepareInvoicePdfData(tenantId, id),
    prisma.invoice.findFirst({
      where: { id, tenantId },
      select: {
        id: true, customerId: true, voidedReason: true, voidedAt: true, recogniseRevenueOnInvoiceDate: true,
        createdAt: true, updatedAt: true, sentAt: true,
        lines: { select: { projectId: true } },
      },
    }),
    prisma.$queryRaw<Array<{ quoteNumber: string }>>`
      SELECT "quote_number" AS "quoteNumber" FROM "quotes"
      WHERE "tenant_id"=${tenantId}::uuid AND "converted_invoice_id"=${id} AND "status"='CONVERTED' LIMIT 1
    `,
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } }),
  ]);

  if (!pdfData || !meta || !tenant) notFound();
  const { invoice } = pdfData;
  const baseCurrency = tenant.currency.trim().toUpperCase();
  const convertedQuote = convertedQuoteRows[0] ?? null;

  const [openInvoices, bankAccounts, paymentRows, recognitionRows, projectRows, auditRows] = await Promise.all([
    prisma.invoice.findMany({
      where: { tenantId, customerId: meta.customerId, currency: invoice.currency, status: { in: ["SENT", "PARTIAL", "OVERDUE"] } },
      select: { id: true, invoiceNumber: true, balanceDue: true, dueDate: true }, orderBy: { dueDate: "asc" },
    }),
    prisma.$queryRaw<ReceiptDestinationRow[]>`
      SELECT ba."id",ba."account_name" AS "accountName",ba."bank_name" AS "bankName",ba."currency"
      FROM "bank_accounts" ba INNER JOIN "chart_of_accounts" coa ON coa."id"=ba."ledger_account_id" AND coa."tenant_id"=ba."tenant_id"
      WHERE ba."tenant_id"=${tenantId}::uuid AND ba."is_active"=true AND upper(ba."currency")=${invoice.currency.toUpperCase()}
        AND ba."ledger_account_id" IS NOT NULL AND coa."is_active"=true AND coa."type"::text='ASSET'
      ORDER BY ba."bank_name",ba."account_name"
    `,
    prisma.$queryRaw<PaymentDbRow[]>`
      SELECT cp."id",cp."payment_number" AS "paymentNumber",cp."payment_date" AS "paymentDate",cp."method"::text AS "method",
        cpa."amount",cp."currency",cp."status"::text AS "status"
      FROM "customer_payment_allocations" cpa
      INNER JOIN "customer_payments" cp ON cp."id"=cpa."payment_id"
      WHERE cpa."invoice_id"=${id} AND cp."tenant_id"=${tenantId}::uuid
      ORDER BY cp."payment_date",cp."created_at"
    `,
    prisma.$queryRaw<RecognitionDbRow[]>`
      SELECT irr."id"::text AS "id",'Invoice'::text AS "kind",irr."recognition_date" AS "date",irr."base_amount" AS "amountBase",irr."status",irr."note"
      FROM "invoice_revenue_recognitions" irr
      WHERE irr."tenant_id"=${tenantId}::uuid AND irr."invoice_id"=${id}
      UNION ALL
      SELECT prr."id"::text AS "id",'Project'::text AS "kind",prr."recognition_date"::timestamp AS "date",SUM(rria."amount") AS "amountBase",prr."status",prr."note"
      FROM "revenue_recognition_invoice_allocations" rria
      INNER JOIN "invoice_line_revenue_allocations" ila ON ila."id"=rria."invoice_line_allocation_id"
      INNER JOIN "project_revenue_recognitions" prr ON prr."id"=rria."recognition_id"
      WHERE ila."tenant_id"=${tenantId}::uuid AND ila."invoice_id"=${id} AND rria."allocation_type"='UNEARNED_RELEASE'
      GROUP BY prr."id",prr."recognition_date",prr."status",prr."note"
      ORDER BY "date"
    `,
    prisma.$queryRaw<ProjectDbRow[]>`
      SELECT ila."id"::text AS "id",il."description",p."name" AS "projectName",p."code" AS "projectCode",
        coa."code" || ' — ' || coa."name" AS "incomeAccount",ila."invoice_amount" AS "invoiceAmountBase",
        ila."contract_asset_cleared" AS "contractAssetCleared",ila."immediate_revenue" AS "immediateRevenue",ila."unearned_created" AS "unearnedCreated"
      FROM "invoice_line_revenue_allocations" ila
      INNER JOIN "invoice_lines" il ON il."id"=ila."invoice_line_id"
      INNER JOIN "projects" p ON p."id"=ila."project_id"
      INNER JOIN "chart_of_accounts" coa ON coa."id"=ila."income_account_id"
      WHERE ila."tenant_id"=${tenantId}::uuid AND ila."invoice_id"=${id} AND ila."project_id" IS NOT NULL
      ORDER BY il."id"
    `,
    prisma.$queryRaw<AuditDbRow[]>`
      SELECT DISTINCT je."id",je."entry_date" AS "date",je."source",je."reference",je."description"
      FROM "journal_entries" je
      LEFT JOIN "credit_notes" cn ON cn."tenant_id"=je."tenant_id" AND (cn."journal_entry_id"=je."id" OR cn."reversal_journal_entry_id"=je."id")
      LEFT JOIN "customer_payment_allocations" cpa ON je."source"='customer_payment' AND cpa."payment_id"=je."source_id"
      LEFT JOIN "invoice_revenue_recognitions" irr ON je."source" IN ('invoice_revenue_recognition','invoice_revenue_recognition_reversal') AND irr."id"::text=je."source_id"
      WHERE je."tenant_id"=${tenantId}::uuid AND (
        (je."source"='invoice' AND je."source_id"=${id})
        OR (cn."invoice_id"=${id})
        OR (cpa."invoice_id"=${id})
        OR (irr."invoice_id"=${id})
      )
      ORDER BY "date",je."id"
    `,
  ]);

  const isBaseCurrency = invoice.currency === baseCurrency;
  const rate = invoice.exchangeRate;
  const totalBase = invoice.totalAmount * rate;
  const balance = invoice.balanceDue;
  const balanceBase = balance * rate;
  const hasProjectLines = meta.lines.some((line) => Boolean(line.projectId));
  const canRecogniseRevenue = ["OWNER", "ADMIN", "ACCOUNTANT"].includes(session?.user?.role ?? "")
    && !meta.recogniseRevenueOnInvoiceDate && !hasProjectLines && !["DRAFT", "VOIDED", "WRITTEN_OFF"].includes(invoice.status);
  const displayStatus = getInvoiceDisplayStatus({ status: invoice.status, dueDate: invoice.dueDate, balanceDue: String(balance) });

  const payments: InvoicePaymentTabRow[] = paymentRows.map((row) => ({
    id: row.id, paymentNumber: row.paymentNumber, paymentDate: row.paymentDate.toISOString().slice(0, 10), method: row.method,
    amount: Number(row.amount), currency: row.currency, status: row.status,
  }));
  const recognitions: InvoiceRecognitionTabRow[] = recognitionRows.map((row) => ({
    id: row.id, kind: row.kind === "Project" ? "Project" : "Invoice", date: row.date.toISOString().slice(0, 10), amountBase: Number(row.amountBase), status: row.status, note: row.note,
  }));
  const immediateBase = projectRows.reduce((sum, row) => sum + Number(row.immediateRevenue), 0);
  if (immediateBase > 0.005) {
    recognitions.unshift({ id: `invoice-date-${id}`, kind: "Invoice", date: invoice.issueDate.toISOString().slice(0, 10), amountBase: immediateBase, status: "POSTED", note: "Revenue recognised on invoice date." });
  }
  const projectDetails: InvoiceProjectTabRow[] = projectRows.map((row) => ({
    id: row.id, description: row.description, projectName: row.projectName, projectCode: row.projectCode, incomeAccount: row.incomeAccount,
    invoiceAmountBase: Number(row.invoiceAmountBase), contractAssetCleared: Number(row.contractAssetCleared), immediateRevenue: Number(row.immediateRevenue), unearnedCreated: Number(row.unearnedCreated),
  }));
  const audit: InvoiceAuditTabRow[] = [
    { id: `created-${id}`, date: meta.createdAt.toISOString().slice(0, 10), source: "invoice_created", reference: invoice.invoiceNumber, description: "Invoice record created." },
    ...(meta.sentAt ? [{ id: `sent-${id}`, date: meta.sentAt.toISOString().slice(0, 10), source: "invoice_sent", reference: invoice.invoiceNumber, description: "Invoice marked as sent / issued." }] : []),
    ...auditRows.map((row) => ({ id: row.id, date: row.date.toISOString().slice(0, 10), source: row.source, reference: row.reference, description: row.description })),
  ];

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/sales/invoices" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}><ArrowLeft className="h-4 w-4 mr-1" /> Invoices</Link>
          <span className="text-slate-300">/</span>
          <span className="font-mono text-sm font-semibold">{invoice.invoiceNumber}</span>
          {invoice.orderNumber ? <span className="font-mono text-xs text-slate-500">Order {invoice.orderNumber}</span> : null}
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColors[displayStatus] ?? "bg-slate-100 text-slate-600"}`}>{displayStatus}</span>
          {convertedQuote && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-violet-50 text-violet-700"><LockKeyhole className="h-3 w-3" /> From {convertedQuote.quoteNumber}</span>}
          {!isBaseCurrency && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">{invoice.currency}</span>}
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Link href={`/sales/invoices/${id}/print`} target="_blank" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}><Printer className="h-3.5 w-3.5" /> Print / PDF</Link>
          {canRecogniseRevenue ? <RecogniseRevenueButton invoiceId={meta.id} currency={invoice.currency} /> : null}
          <InvoiceActions invoice={{ id: meta.id, status: invoice.status, customerId: meta.customerId, balanceDue: balance, notes: invoice.notes, reference: invoice.reference, dueDate: invoice.dueDate, currency: invoice.currency, exchangeRate: invoice.exchangeRate }} openInvoices={openInvoices.map((item) => ({ ...item, balanceDue: Number(item.balanceDue) }))} bankAccounts={bankAccounts} baseCurrency={baseCurrency} />
        </div>
      </div>

      {convertedQuote && invoice.status === "DRAFT" && <div className="flex items-start gap-3 bg-violet-50 border border-violet-200 rounded-xl px-4 py-3 text-sm"><LockKeyhole className="h-4 w-4 text-violet-700 mt-0.5" /><div><p className="font-medium text-violet-900">Commercial terms protected by accepted quote {convertedQuote.quoteNumber}</p><p className="text-violet-700 mt-0.5">Customer, currency, amounts and invoice lines stay aligned with the accepted quote. Administrative fields may still be updated.</p></div></div>}
      {invoice.status === "VOIDED" && <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm"><span className="text-red-700 font-medium">Voided</span>{meta.voidedReason && <><span className="text-red-500">·</span><span className="text-red-600">{meta.voidedReason}</span></>}{meta.voidedAt && <><span className="text-red-300 mx-1">·</span><span className="text-red-400">{formatDate(meta.voidedAt)}</span></>}</div>}

      {!isBaseCurrency && <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm flex-wrap"><span className="text-amber-700">Invoice exchange rate:</span><span className="font-mono font-semibold text-amber-900">1 {invoice.currency} = {rate.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} {baseCurrency}</span><span className="text-amber-400">·</span><span className="text-amber-700">{baseCurrency} Total:</span><span className="font-mono font-semibold text-amber-900">{formatCurrency(totalBase, baseCurrency)}</span>{balance > 0 && <><span className="text-amber-400">·</span><span className="text-amber-700">Balance at invoice rate ≈</span><span className="font-mono font-semibold text-amber-900">{formatCurrency(balanceBase, baseCurrency)}</span></>}</div>}

      <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm bg-white"><InvoicePreview data={pdfData} /></div>

      <InvoiceAccountingTabs
        baseCurrency={baseCurrency}
        invoiceCurrency={invoice.currency}
        payments={payments}
        recognitions={recognitions}
        projects={projectDetails}
        vatLines={pdfData.lines.map((line) => ({ description: line.description, taxName: line.taxName, taxRate: line.taxRate, taxAmount: line.taxAmount }))}
        taxTotal={invoice.taxAmount}
        audit={audit}
      />
    </div>
  );
}
