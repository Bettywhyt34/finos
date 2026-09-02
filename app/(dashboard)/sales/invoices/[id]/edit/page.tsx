import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Pencil } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { InvoiceEditForm } from "./invoice-edit-form";

function reportingTags(value: unknown): Record<string, string> {
  if (!value || Array.isArray(value) || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).filter(([, optionId]) => typeof optionId === "string" && optionId.length > 0)) as Record<string, string>;
}

export default async function InvoiceEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");
  const tenantId = session.user.tenantId;
  if (!["OWNER", "ADMIN", "ACCOUNTANT"].includes(session.user.role ?? "")) redirect(`/sales/invoices/${id}`);

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
  if (invoice.status !== "DRAFT") redirect(`/sales/invoices/${id}`);

  const convertedQuote = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "quotes"
    WHERE "tenant_id"=${tenantId}::uuid AND "converted_invoice_id"=${id} AND "status"='CONVERTED'
    LIMIT 1
  `;
  if (convertedQuote.length) redirect(`/sales/invoices/${id}`);

  const [customers, items, series, taxRates, incomeAccounts, projects, tagDefinitions, tenant] = await Promise.all([
    prisma.customer.findMany({ where: { tenantId }, select: { id: true, companyName: true, customerCode: true, paymentTerms: true }, orderBy: { companyName: "asc" } }),
    prisma.item.findMany({ where: { tenantId, isActive: true }, select: { id: true, itemCode: true, name: true, salesPrice: true, type: true, incomeAccountId: true }, orderBy: { name: "asc" } }).then((rows) => rows.map((item) => ({ ...item, salesPrice: item.salesPrice !== null ? Number(item.salesPrice) : null, incomeAccountId: item.incomeAccountId ?? null }))),
    prisma.transactionNumberSeries.findFirst({ where: { tenantId, module: "INVOICE" }, select: { allowManualOverride: true, isEnabled: true } }),
    prisma.taxRate.findMany({ where: { tenantId, isActive: true }, select: { id: true, name: true, rate: true, type: true, isDefault: true }, orderBy: [{ type: "asc" }, { name: "asc" }] }),
    prisma.chartOfAccounts.findMany({ where: { tenantId, isActive: true, type: "INCOME" }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
    prisma.$queryRaw<Array<{ id: string; name: string; code: string | null; customerId: string }>>`
      SELECT "id","name","code","customer_id" AS "customerId"
      FROM "projects"
      WHERE "tenant_id"=${tenantId} AND "status" IN ('DRAFT','ACTIVE')
      ORDER BY "name"
    `.catch(() => []),
    prisma.reportingTag.findMany({ where: { tenantId, isActive: true, appliesTo: { has: "SALES" } }, select: { id: true, name: true, options: { where: { isActive: true }, select: { id: true, name: true }, orderBy: { sortOrder: "asc" } } }, orderBy: { name: "asc" } }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } }),
  ]);

  if (!tenant) notFound();
  const baseCurrency = tenant.currency.trim().toUpperCase();
  const allowManualOverride = series?.allowManualOverride ?? false;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href={`/sales/invoices/${id}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1 -ml-2")}><ArrowLeft className="h-4 w-4" /> Back to Invoice</Link>
        <span className="text-slate-300">/</span><span className="font-mono text-slate-700 font-medium">{invoice.invoiceNumber}</span>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500">DRAFT</span>
      </div>

      <div className="flex items-start gap-4">
        <div className="mt-0.5 h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "color-mix(in srgb, var(--finos-accent) 10%, white)", border: "1px solid color-mix(in srgb, var(--finos-accent) 20%, white)" }}><Pencil className="h-4 w-4" style={{ color: "var(--finos-accent)" }} /></div>
        <div><h1 className="text-xl font-semibold text-slate-900">Edit Draft Invoice</h1><p className="text-sm text-slate-500 mt-1">Draft invoices remain fully editable. Project and Reporting Tag dimensions are preserved when saved.</p></div>
      </div>

      <InvoiceEditForm
        invoiceId={id}
        baseCurrency={baseCurrency}
        initialData={{
          customerId: invoice.customerId,
          invoiceNumber: invoice.invoiceNumber,
          reference: invoice.reference ?? "",
          issueDate: invoice.issueDate.toISOString().split("T")[0],
          dueDate: invoice.dueDate.toISOString().split("T")[0],
          recognitionPeriod: invoice.recognitionPeriod,
          currency: invoice.currency,
          exchangeRate: Number(invoice.exchangeRate),
          discountAmount: Number(invoice.discountAmount),
          notes: invoice.notes ?? "",
          lines: invoice.lines.map((line) => ({
            itemId: line.itemId ?? "",
            description: line.description,
            quantity: Number(line.quantity),
            rate: Number(line.rate),
            taxRateId: line.taxRateId ?? "",
            discountType: line.discountType as "PERCENT" | "FIXED",
            discountValue: Number(line.discountValue),
            incomeAccountId: line.incomeAccountId ?? "",
            projectId: line.projectId ?? "",
            reportingTags: reportingTags(line.reportingTags),
          })),
        }}
        customers={customers}
        items={items}
        incomeAccounts={incomeAccounts}
        allowManualOverride={allowManualOverride}
        taxRates={taxRates.map((tax) => ({ ...tax, rate: Number(tax.rate) }))}
        projects={projects}
        reportingTags={tagDefinitions}
      />
    </div>
  );
}
