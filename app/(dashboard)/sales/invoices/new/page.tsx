import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { InvoiceForm } from "./invoice-form";

export default async function NewInvoicePage() {
  const session = await auth();
  const organizationId = session!.user.organizationId!;

  const [customers, items, accounts] = await Promise.all([
    prisma.customer.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, companyName: true, customerCode: true, paymentTerms: true },
      orderBy: { companyName: "asc" },
    }),
    prisma.item.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, itemCode: true, name: true, salesPrice: true, type: true },
      orderBy: { name: "asc" },
    }),
    prisma.chartOfAccounts.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
  ]);

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900 mb-6">New Invoice</h1>
      <InvoiceForm
        customers={customers}
        items={items.map((i) => ({ ...i, salesPrice: i.salesPrice ? parseFloat(String(i.salesPrice)) : null }))}
        accounts={accounts}
      />
    </div>
  );
}
