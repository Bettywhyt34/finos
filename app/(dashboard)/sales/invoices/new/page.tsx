import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { InvoiceForm } from "./invoice-form";

export default async function NewInvoicePage() {
  const session = await auth();
  const tenantId = session!.user.tenantId!;

  const [customers, items, incomeAccounts, taxRates, projects, paymentTerms, reportingTags] = await Promise.all([
    prisma.customer.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, companyName: true, customerCode: true, paymentTerms: true },
      orderBy: { companyName: "asc" },
    }),
    prisma.item.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, itemCode: true, name: true, salesPrice: true, type: true, incomeAccountId: true },
      orderBy: { name: "asc" },
    }),
    prisma.chartOfAccounts.findMany({
      where: { tenantId, isActive: true, type: "INCOME" },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.taxRate.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, name: true, rate: true, type: true, isDefault: true },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    }),
    prisma.$queryRaw<Array<{ id: string; name: string; code: string | null; customerId: string }>>`
      SELECT "id", "name", "code", "customer_id" AS "customerId"
      FROM "projects"
      WHERE "tenant_id" = ${tenantId} AND "status" IN ('DRAFT', 'ACTIVE')
      ORDER BY "name" ASC
    `.catch(() => []),
    prisma.paymentTerm.findMany({
      where: { tenantId, isActive: true, appliesTo: { in: ["CUSTOMERS", "BOTH"] } },
      select: { id: true, name: true, dueInDays: true, isDefault: true },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    }),
    prisma.reportingTag.findMany({
      where: { tenantId, isActive: true, appliesTo: { has: "SALES" } },
      select: { id: true, name: true, options: { where: { isActive: true }, select: { id: true, name: true }, orderBy: { sortOrder: "asc" } } },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900 mb-6">New Invoice</h1>
      <InvoiceForm
        customers={customers}
        items={items.map((i) => ({
          ...i,
          salesPrice: i.salesPrice ? parseFloat(String(i.salesPrice)) : null,
          incomeAccountId: i.incomeAccountId ?? null,
        }))}
        incomeAccounts={incomeAccounts}
        taxRates={taxRates.map((t) => ({ ...t, rate: parseFloat(String(t.rate)) }))}
        projects={projects}
        paymentTerms={paymentTerms}
        reportingTags={reportingTags}
      />
    </div>
  );
}
