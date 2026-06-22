import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { InvoiceForm } from "./invoice-form";

export default async function NewInvoicePage() {
  const session = await auth();
  const tenantId = session!.user.tenantId!;

  const [customers, items, incomeAccounts, taxRates] = await Promise.all([
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
      />
    </div>
  );
}
