import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Pencil } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { InvoiceEditForm } from "./invoice-edit-form";

export default async function InvoiceEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");
  const tenantId = session.user.tenantId;

  // Fetch invoice — tenant scoped
  const invoice = await prisma.invoice.findFirst({
    where: { id, tenantId },
    include: {
      lines: {
        orderBy: { id: "asc" },
        include: { item: { select: { id: true, itemCode: true } } },
      },
    },
  });

  if (!invoice) notFound();
  // Only DRAFT invoices can be fully edited.
  if (invoice.status !== "DRAFT") redirect(`/sales/invoices/${id}`);

  // A draft created from an accepted quote is not an ordinary editable draft.
  // The accepted commercial terms are preserved through conversion and protected
  // again by database triggers. Keep full commercial edits out of this route.
  const convertedQuote = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "quotes"
    WHERE "tenant_id" = ${tenantId}::uuid
      AND "converted_invoice_id" = ${id}
      AND "status" = 'CONVERTED'
    LIMIT 1
  `;
  if (convertedQuote.length) redirect(`/sales/invoices/${id}`);

  const [customers, items, series, taxRates, incomeAccounts] = await Promise.all([
    prisma.customer.findMany({
      where: { tenantId },
      select: { id: true, companyName: true, customerCode: true, paymentTerms: true },
      orderBy: { companyName: "asc" },
    }),
    prisma.item.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, itemCode: true, name: true, salesPrice: true, type: true, incomeAccountId: true },
      orderBy: { name: "asc" },
    }).then((rows) => rows.map((i) => ({
      ...i,
      salesPrice: i.salesPrice !== null ? parseFloat(String(i.salesPrice)) : null,
      incomeAccountId: i.incomeAccountId ?? null,
    }))),
    prisma.transactionNumberSeries.findFirst({
      where: { tenantId, module: "INVOICE" },
      select: { allowManualOverride: true, isEnabled: true },
    }),
    prisma.taxRate.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, name: true, rate: true, type: true, isDefault: true },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    }),
    prisma.chartOfAccounts.findMany({
      where: { tenantId, isActive: true, type: "INCOME" },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
  ]);

  const allowManualOverride = series?.allowManualOverride ?? false;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link
          href={`/sales/invoices/${id}`}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1 -ml-2")}
        >
          <ArrowLeft className="h-4 w-4" /> Back to Invoice
        </Link>
        <span className="text-slate-300">/</span>
        <span className="font-mono text-slate-700 font-medium">{invoice.invoiceNumber}</span>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500">
          DRAFT
        </span>
      </div>

      {/* Page heading */}
      <div className="flex items-start gap-4">
        <div
          className="mt-0.5 h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: "color-mix(in srgb, var(--finos-accent) 10%, white)", border: "1px solid color-mix(in srgb, var(--finos-accent) 20%, white)" }}
        >
          <Pencil
            className="h-4 w-4"
            style={{ color: "var(--finos-accent)" }}
          />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Edit Draft Invoice</h1>
          <p className="text-sm text-slate-500 mt-1">
            Draft invoices remain fully editable. No accounting entry is posted until the invoice is marked as sent.
          </p>
        </div>
      </div>

      <InvoiceEditForm
        invoiceId={id}
        initialData={{
          customerId:        invoice.customerId,
          invoiceNumber:     invoice.invoiceNumber,
          reference:         invoice.reference ?? "",
          issueDate:         invoice.issueDate.toISOString().split("T")[0],
          dueDate:           invoice.dueDate.toISOString().split("T")[0],
          recognitionPeriod: invoice.recognitionPeriod,
          currency:          invoice.currency,
          exchangeRate:      parseFloat(String(invoice.exchangeRate)),
          discountAmount:    parseFloat(String(invoice.discountAmount)),
          notes:             invoice.notes ?? "",
          lines: invoice.lines.map((l) => ({
            itemId:          l.itemId ?? "",
            description:     l.description,
            quantity:        parseFloat(String(l.quantity)),
            rate:            parseFloat(String(l.rate)),
            taxRateId:       l.taxRateId ?? "",
            discountType:    (l.discountType as "PERCENT" | "FIXED"),
            discountValue:   parseFloat(String(l.discountValue)),
            incomeAccountId: l.incomeAccountId ?? "",
          })),
        }}
        customers={customers}
        items={items}
        incomeAccounts={incomeAccounts}
        allowManualOverride={allowManualOverride}
        taxRates={taxRates.map((t) => ({ ...t, rate: parseFloat(String(t.rate)) }))}
      />
    </div>
  );
}
