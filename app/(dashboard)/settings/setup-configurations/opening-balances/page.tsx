import { redirect }                    from "next/navigation";
import { auth }                         from "@/lib/auth";
import { prisma }                       from "@/lib/prisma";
import { getOpeningBalance }            from "@/lib/setup-configurations/service";
import { OpeningBalancesClient }        from "./opening-balances-client";

export default async function OpeningBalancesPage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");

  const tenantId = session.user.tenantId;

  // Fetch all data in parallel
  const [batch, tenant, coaAccounts, customers, vendors, bankAccounts, journalCount] =
    await Promise.all([
      getOpeningBalance(tenantId),

      prisma.tenant.findUnique({
        where:  { id: tenantId },
        select: { currency: true },
      }),

      prisma.chartOfAccounts.findMany({
        where:   { tenantId, isActive: true },
        select:  { id: true, code: true, name: true, type: true, subtype: true },
        orderBy: [{ type: "asc" }, { code: "asc" }],
      }),

      prisma.customer.findMany({
        where:   { tenantId, isActive: true },
        select:  { id: true, companyName: true, currency: true },
        orderBy: { companyName: "asc" },
      }),

      prisma.vendor.findMany({
        where:   { tenantId, isActive: true },
        select:  { id: true, companyName: true, currency: true },
        orderBy: { companyName: "asc" },
      }),

      prisma.bankAccount.findMany({
        where:   { tenantId, isActive: true },
        select:  { id: true, accountName: true, bankName: true, currency: true },
        orderBy: { accountName: "asc" },
      }),

      // Count existing journal entries to show transaction-exists warning
      prisma.journalEntry.count({
        where: { tenantId, source: { not: "opening_balance" } },
      }),
    ]);

  return (
    <OpeningBalancesClient
      initialBatch={batch}
      tenantCurrency={tenant?.currency ?? "NGN"}
      coaAccounts={coaAccounts.map((a) => ({
        id:      a.id,
        code:    a.code,
        name:    a.name,
        type:    a.type as string,
        subtype: a.subtype,
      }))}
      customers={customers.map((c) => ({
        id:          c.id,
        companyName: c.companyName,
        currency:    c.currency,
      }))}
      vendors={vendors.map((v) => ({
        id:          v.id,
        companyName: v.companyName,
        currency:    v.currency,
      }))}
      bankAccounts={bankAccounts.map((b) => ({
        id:          b.id,
        accountName: b.accountName,
        bankName:    b.bankName,
        currency:    b.currency,
      }))}
      existingTransactionCount={journalCount}
    />
  );
}
