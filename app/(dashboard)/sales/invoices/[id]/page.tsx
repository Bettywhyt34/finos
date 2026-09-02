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

const statusColors: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600", SENT: "bg-blue-100 text-blue-700", PARTIAL: "bg-amber-100 text-amber-700",
  PAID: "bg-green-100 text-green-700", SETTLED: "bg-teal-100 text-teal-700", OVERDUE: "bg-red-100 text-red-700",
  WRITTEN_OFF: "bg-slate-100 text-slate-400", VOIDED: "bg-red-100 text-red-500 line-through",
};
interface ReceiptDestinationRow { id: string; accountName: string; bankName: string; currency: string; }

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const tenantId = session!.user.tenantId!;

  const [pdfData, meta, convertedQuoteRows, tenant] = await Promise.all([
    prepareInvoicePdfData(tenantId, id),
    prisma.invoice.findFirst({
      where: { id, tenantId },
      select: { id: true, customerId: true, voidedReason: true, voidedAt: true, recogniseRevenueOnInvoiceDate: true, lines: { select: { projectId: true } } },
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

  const [openInvoices, bankAccounts] = await Promise.all([
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
          <InvoiceActions
            invoice={{ id: meta.id, status: invoice.status, customerId: meta.customerId, balanceDue: balance, notes: invoice.notes, reference: invoice.reference, dueDate: invoice.dueDate, currency: invoice.currency, exchangeRate: invoice.exchangeRate }}
            openInvoices={openInvoices.map((item) => ({ ...item, balanceDue: Number(item.balanceDue) }))}
            bankAccounts={bankAccounts}
            baseCurrency={baseCurrency}
          />
        </div>
      </div>

      {convertedQuote && invoice.status === "DRAFT" && <div className="flex items-start gap-3 bg-violet-50 border border-violet-200 rounded-xl px-4 py-3 text-sm"><LockKeyhole className="h-4 w-4 text-violet-700 mt-0.5" /><div><p className="font-medium text-violet-900">Commercial terms protected by accepted quote {convertedQuote.quoteNumber}</p><p className="text-violet-700 mt-0.5">Customer, currency, amounts and invoice lines stay aligned with the accepted quote. Administrative fields may still be updated.</p></div></div>}
      {invoice.status === "VOIDED" && <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm"><span className="text-red-700 font-medium">Voided</span>{meta.voidedReason && <><span className="text-red-500">·</span><span className="text-red-600">{meta.voidedReason}</span></>}{meta.voidedAt && <><span className="text-red-300 mx-1">·</span><span className="text-red-400">{formatDate(meta.voidedAt)}</span></>}</div>}

      {!isBaseCurrency && <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm flex-wrap">
        <span className="text-amber-700">Invoice exchange rate:</span>
        <span className="font-mono font-semibold text-amber-900">1 {invoice.currency} = {rate.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} {baseCurrency}</span>
        <span className="text-amber-400">·</span><span className="text-amber-700">{baseCurrency} Total:</span><span className="font-mono font-semibold text-amber-900">{formatCurrency(totalBase, baseCurrency)}</span>
        {balance > 0 && <><span className="text-amber-400">·</span><span className="text-amber-700">Balance at invoice rate ≈</span><span className="font-mono font-semibold text-amber-900">{formatCurrency(balanceBase, baseCurrency)}</span></>}
      </div>}

      <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm bg-white"><InvoicePreview data={pdfData} /></div>
    </div>
  );
}
