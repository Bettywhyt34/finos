import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { JournalForm } from "./journal-form";

export default async function NewJournalEntryPage() {
  const session = await auth();
  const orgId = session?.user?.organizationId;
  if (!orgId) return null;

  const accounts = await prisma.chartOfAccounts.findMany({
    where: { organizationId: orgId, isActive: true },
    select: { id: true, code: true, name: true, type: true },
    orderBy: { code: "asc" },
  });

  const today = new Date().toISOString().split("T")[0];
  const currentPeriod = today.slice(0, 7);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold">New Journal Entry</h1>
        <p className="text-sm text-muted-foreground">
          Manual double-entry posting. Debits must equal credits before posting.
        </p>
      </div>
      <JournalForm accounts={accounts} defaultDate={today} defaultPeriod={currentPeriod} />
    </div>
  );
}
