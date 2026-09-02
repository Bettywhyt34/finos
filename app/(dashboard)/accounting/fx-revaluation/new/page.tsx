import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { RevaluationForm } from "./revaluation-form";

export default async function NewRevaluationPage() {
  const session = await auth();
  const orgId = session?.user?.tenantId;
  if (!orgId) return null;

  const [accounts, tenant] = await Promise.all([
    prisma.chartOfAccounts.findMany({
      where: {
        tenantId: orgId,
        isActive: true,
        type: { in: ["INCOME", "EXPENSE"] },
      },
      select: { code: true, name: true, type: true },
      orderBy: { code: "asc" },
    }),
    prisma.tenant.findUnique({ where: { id: orgId }, select: { currency: true } }),
  ]);

  if (!tenant) return null;
  const baseCurrency = tenant.currency.trim().toUpperCase();

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">New FX Revaluation</h1>
        <p className="text-sm text-muted-foreground">
          Revalue open foreign-currency AR, AP and customer-credit monetary balances at the selected closing rate.
        </p>
      </div>
      <RevaluationForm orgId={orgId} baseCurrency={baseCurrency} accounts={accounts} />
    </div>
  );
}
