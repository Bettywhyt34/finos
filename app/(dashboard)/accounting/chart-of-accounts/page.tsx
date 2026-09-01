import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AccountTable } from "./account-table";
import { AccountForm } from "./account-form";

export default async function ChartOfAccountsPage() {
  const session = await auth();
  const tenantId = session!.user.tenantId!;

  const accounts = await prisma.chartOfAccounts.findMany({
    where: { tenantId },
    orderBy: { code: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      subtype: true,
      financialCategory: true,
      parentId: true,
      isActive: true,
    },
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Chart of Accounts
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            View and manage the accounts used to organise your financial records.
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Click an account to view its transactions.
          </p>
        </div>

        <AccountForm accounts={accounts} />
      </div>

      <AccountTable accounts={accounts} />
    </div>
  );
}
