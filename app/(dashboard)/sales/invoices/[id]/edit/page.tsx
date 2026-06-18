import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
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
  // Only DRAFT invoices can be fully edited
  if (invoice.status !== "DRAFT") redirect(`/sales/invoices/${id}`);

  const [customers, items, series] = await Promise.all([
    prisma.customer.findMany({
      where: { tenantId },
      select: { id: true, companyName: true, customerCode: true, paymentTerms: true },
      orderBy: { companyName: "asc" },
    }),
    prisma.item.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, itemCode: true, name: true, salesPrice: true, type: true, },
      orderBy: { name: "asc" },
    }).then((rows) => rows.map((i) => ({
      ...i,
      salesPrice: i.salesPrice !== null ? parseFloat(String(i.salesPrice)) : null,
    }))),
    prisma.transactionNumberSeries.findFirst({
      where: { tenantId, module: "INVOICE" },
      select: { allowManualOverride: true, isEnabled: true },
    }),
  ]);

  const allowManualOverride = series?.allowManualOverride ?? false;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Link
          href={`/sales/invoices/${id}`}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to Invoice
        </Link>
        <span className="text-slate-300">/</span>
        <span className="font-mono text-sm font-semibold">{invoice.invoiceNumber}</span>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
          DRAFT
        </span>
      </div>

      <div>
        <h1 className="text-xl font-semibold text-slate-900">Edit Draft Invoice</h1>
        <p className="text-sm text-slate-500 mt-1">
          You can edit all fields of a draft invoice. Invoice number will not be regenerated.
        </p>
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
            itemId:      l.itemId ?? "",
            description: l.description,
            quantity:    parseFloat(String(l.quantity)),
            rate:        parseFloat(String(l.rate)),
            taxRate:     parseFloat(String(l.taxRate)),
          })),
        }}
        customers={customers}
        items={items}
        allowManualOverride={allowManualOverride}
      />
    </div>
  );
}
