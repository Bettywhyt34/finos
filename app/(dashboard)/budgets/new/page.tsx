import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { BudgetWizard } from "./budget-wizard";

export default async function NewBudgetPage() {
  const session = await auth();
  const orgId = session?.user?.organizationId;
  if (!orgId) return null;

  const currentYear = new Date().getFullYear();

  // Prior year approved/locked budgets for copy option
  const priorBudgets = await prisma.budget.findMany({
    where: {
      organizationId: orgId,
      fiscalYear: currentYear - 1,
      status: { in: ["APPROVED", "LOCKED"] },
    },
    select: { id: true, name: true, type: true, fiscalYear: true },
    orderBy: { type: "asc" },
  });

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Create Budget</h1>
        <p className="text-sm text-muted-foreground">
          Define a new budget for operating expenses, capital expenditure, or cash flow.
        </p>
      </div>
      <BudgetWizard currentYear={currentYear} priorBudgets={priorBudgets} />
    </div>
  );
}
