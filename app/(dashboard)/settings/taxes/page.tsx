import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import TaxesClient from "./taxes-client";

export const metadata = { title: "Tax Settings" };

export default async function TaxSettingsPage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");

  const taxRates = await prisma.taxRate.findMany({
    where:   { tenantId: session.user.tenantId, isActive: true },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Tax Settings
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Configure VAT, WHT, PAYE, and custom tax rates for your organisation.
        </p>
      </div>
      <TaxesClient
        taxRates={taxRates.map((r) => ({
          id:        r.id,
          name:      r.name,
          type:      r.type as "VAT" | "WHT" | "PAYE" | "CUSTOM",
          rate:      Number(r.rate),
          isDefault: r.isDefault,
          isActive:  r.isActive,
        }))}
      />
    </div>
  );
}
