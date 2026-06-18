import { auth }              from "@/lib/auth";
import { prisma }            from "@/lib/prisma";
import { notFound }          from "next/navigation";
import Link                  from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { buttonVariants }    from "@/components/ui/button";
import { formatCurrency, toNGN, cn, formatDate } from "@/lib/utils";
import { InvoiceActions }    from "./invoice-actions";
import { getInvoiceDisplayStatus } from "@/lib/invoices/display-status";
import { prepareInvoicePdfData }   from "@/lib/pdf/invoice-data";
import { InvoicePreview }    from "@/components/invoices/invoice-preview";

const statusColors: Record<string, string> = {
  DRAFT:       "bg-slate-100 text-slate-600",
  SENT:        "bg-blue-100 text-blue-700",
  PARTIAL:     "bg-amber-100 text-amber-700",
  PAID:        "bg-green-100 text-green-700",
  OVERDUE:     "bg-red-100 text-red-700",
  WRITTEN_OFF: "bg-slate-100 text-slate-400",
  VOIDED:      "bg-red-100 text-red-500 line-through",
};

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session  = await auth();
  const tenantId = session!.user.tenantId!;

  // Round 1: fetch PDF data (template + all invoice fields) + minimal meta in parallel
  const [pdfData, meta] = await Promise.all([
    prepareInvoicePdfData(tenantId, id),
    prisma.invoice.findFirst({
      where:  { id, tenantId },
      select: { id: true, customerId: true, voidedReason: true, voidedAt: true },
    }),
  ]);

  if (!pdfData || !meta) notFound();

  // Round 2: open invoices for this customer + bank accounts (needs customerId from round 1)
  const [openInvoices, bankAccounts] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        tenantId,
        customerId: meta.customerId,
        status: { in: ["SENT", "PARTIAL", "OVERDUE"] },
      },
      select: { id: true, invoiceNumber: true, balanceDue: true, dueDate: true, currency: true, exchangeRate: true },
      orderBy: { dueDate: "asc" },
    }),
    prisma.bankAccount.findMany({
      where:  { tenantId, isActive: true },
      select: { id: true, accountName: true, bankName: true },
    }),
  ]);

  const { invoice } = pdfData;
  const isNGN       = invoice.currency === "NGN";
  const rate        = invoice.exchangeRate;
  const totalNGN    = toNGN(invoice.totalAmount, rate);
  const balance     = invoice.balanceDue;
  const balanceNGN  = toNGN(balance, rate);

  const displayStatus = getInvoiceDisplayStatus({
    status:     invoice.status,
    dueDate:    invoice.dueDate,
    balanceDue: String(balance),
  });

  return (
    <div className="space-y-6 max-w-5xl">

      {/* ── Top bar: breadcrumb + actions ───────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <Link
            href="/sales/invoices"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          >
            <ArrowLeft className="h-4 w-4 mr-1" /> Invoices
          </Link>
          <span className="text-slate-300">/</span>
          <span className="font-mono text-sm font-semibold">{invoice.invoiceNumber}</span>
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColors[displayStatus] ?? ""}`}
          >
            {displayStatus}
          </span>
          {!isNGN && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
              {invoice.currency}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={`/sales/invoices/${id}/print`}
            target="_blank"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
          >
            <Printer className="h-3.5 w-3.5" />
            Print / PDF
          </Link>
          <InvoiceActions
            invoice={{
              id:         meta.id,
              status:     invoice.status,
              customerId: meta.customerId,
              balanceDue: balance,
              notes:      invoice.notes,
              reference:  invoice.reference,
              dueDate:    invoice.dueDate,
            }}
            openInvoices={openInvoices.map((i) => ({
              ...i,
              balanceDue:   parseFloat(String(i.balanceDue)),
              exchangeRate: parseFloat(String(i.exchangeRate)),
            }))}
            bankAccounts={bankAccounts}
          />
        </div>
      </div>

      {/* ── Void banner ─────────────────────────────────────────────────── */}
      {invoice.status === "VOIDED" && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm">
          <span className="text-red-700 font-medium">Voided</span>
          {meta.voidedReason && (
            <>
              <span className="text-red-500">·</span>
              <span className="text-red-600">{meta.voidedReason}</span>
            </>
          )}
          {meta.voidedAt && (
            <>
              <span className="text-red-300 mx-1">·</span>
              <span className="text-red-400">{formatDate(meta.voidedAt)}</span>
            </>
          )}
        </div>
      )}

      {/* ── FX banner ───────────────────────────────────────────────────── */}
      {!isNGN && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm flex-wrap">
          <span className="text-amber-700">Exchange rate:</span>
          <span className="font-mono font-semibold text-amber-900">
            1 {invoice.currency} = ₦{rate.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
          </span>
          <span className="text-amber-400">·</span>
          <span className="text-amber-700">NGN Total:</span>
          <span className="font-mono font-semibold text-amber-900">{formatCurrency(totalNGN)}</span>
          {balance > 0 && (
            <>
              <span className="text-amber-400">·</span>
              <span className="text-amber-700">Balance ≈</span>
              <span className="font-mono font-semibold text-amber-900">{formatCurrency(balanceNGN)}</span>
            </>
          )}
        </div>
      )}

      {/* ── Invoice document preview (matches selected PDF template) ────── */}
      <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm bg-white">
        <InvoicePreview data={pdfData} />
      </div>

    </div>
  );
}
