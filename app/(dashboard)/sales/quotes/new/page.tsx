import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { QuoteForm } from "./quote-form";

export default async function NewQuotePage() {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  if (!tenantId) return null;

  const [customers, items, incomeAccounts, taxRates, projects, reportingTags] = await Promise.all([
    prisma.customer.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, companyName: true, customerCode: true },
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
      WHERE "tenant_id"=${tenantId}::uuid AND "status" IN ('DRAFT','ACTIVE','ON_HOLD')
      ORDER BY "name" ASC
    `.catch(() => []),
    prisma.reportingTag.findMany({
      where: { tenantId, isActive: true, appliesTo: { has: "SALES" } },
      select: {
        id: true,
        name: true,
        options: { where: { isActive: true }, select: { id: true, name: true }, orderBy: { sortOrder: "asc" } },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link href="/sales/quotes" className="inline-flex items-center gap-2 text-sm font-medium text-[var(--finos-accent)] hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to Quotes
      </Link>
      <div>
        <h1 className="text-[36px] font-medium tracking-[-0.02em] text-[var(--text-primary)]">New quote</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Prepare a commercial proposal. Quotes do not post to the ledger.</p>
      </div>
      <QuoteForm
        customers={customers}
        items={items.map((item) => ({ ...item, salesPrice: item.salesPrice ? Number(item.salesPrice) : null, incomeAccountId: item.incomeAccountId ?? null }))}
        incomeAccounts={incomeAccounts}
        taxRates={taxRates.map((tax) => ({ ...tax, rate: Number(tax.rate) }))}
        projects={projects}
        reportingTags={reportingTags}
      />
    </div>
  );
}
