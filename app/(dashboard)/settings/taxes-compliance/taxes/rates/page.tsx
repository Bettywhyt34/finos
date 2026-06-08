import { redirect }   from "next/navigation";
import { auth }        from "@/lib/auth";
import { prisma }      from "@/lib/prisma";
import { RatesClient } from "./rates-client";

export const metadata = { title: "Tax Rates" };

export default async function TaxRatesPage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");

  const rows = await prisma.taxRate.findMany({
    where:   { tenantId: session.user.tenantId, isActive: true },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });

  const taxRates = rows.map((r) => ({
    id:        r.id,
    name:      r.name,
    type:      r.type as "VAT" | "WHT" | "PAYE" | "CUSTOM",
    rate:      Number(r.rate),
    isDefault: r.isDefault,
    isActive:  r.isActive,
    createdAt: r.createdAt.toISOString(),
  }));

  return <RatesClient taxRates={taxRates} />;
}
