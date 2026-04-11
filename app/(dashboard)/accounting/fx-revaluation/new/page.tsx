import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { RevaluationForm } from "./revaluation-form";

export default async function NewRevaluationPage() {
  const session = await auth();
  const orgId = session?.user?.tenantId;
  if (!orgId) return null;

  // Load FX-eligible account codes for the gain/loss selectors
  const accounts = await prisma.chartOfAccounts.findMany({
    where: {
      tenantId: orgId,
      isActive: true,
      type: { in: ["INCOME", "EXPENSE"] },
    },
    select: { code: true, name: true, type: true },
    orderBy: { code: "asc" },
  });

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">New FX Revaluation</h1>
        <p className="text-sm text-muted-foreground">
          Revalue outstanding foreign-currency AR and AP balances at the period-end closing rate.
        </p>
      </div>
      <RevaluationForm orgId={orgId} accounts={accounts} />
    </div>
  );
}
