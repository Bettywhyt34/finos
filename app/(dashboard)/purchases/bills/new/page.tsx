import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BillForm } from "./bill-form";

export default async function NewBillPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId!;

  const [vendors, items, accounts] = await Promise.all([
    prisma.vendor.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, companyName: true, vendorCode: true, paymentTerms: true },
      orderBy: { companyName: "asc" },
    }),
    prisma.item.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, itemCode: true, name: true, costPrice: true },
      orderBy: { name: "asc" },
    }),
    prisma.chartOfAccounts.findMany({
      where: { organizationId, isActive: true, type: { in: ["EXPENSE", "ASSET"] } },
      select: { id: true, code: true, name: true, type: true },
      orderBy: { code: "asc" },
    }),
  ]);

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900 mb-6">New Bill</h1>
      <BillForm
        vendors={vendors}
        items={items.map((i) => ({ ...i, costPrice: i.costPrice ? parseFloat(String(i.costPrice)) : null }))}
        accounts={accounts}
      />
    </div>
  );
}
