import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ReclassifyForm } from "./reclassify-form";
import type { PendingAccount } from "./reclassify-form";

export default async function ReclassifyPage() {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  if (!tenantId) redirect("/login");

  const pending = await prisma.chartOfAccounts.findMany({
    where: {
      tenantId,
      migrationStatus: "pending",
      type: { in: ["EXPENSE", "ASSET", "LIABILITY"] },
    },
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      financialCategory: true,
      migrationStatus: true,
    },
    orderBy: [{ type: "asc" }, { code: "asc" }],
  });

  if (pending.length === 0) {
    redirect("/accounting/chart-of-accounts");
  }

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Link
            href="/accounting/chart-of-accounts"
            className="hover:text-slate-700 transition-colors"
          >
            Chart of Accounts
          </Link>
          <span>/</span>
          <span>Reclassify</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Reclassify Accounts
        </h1>
        <p className="text-sm text-slate-500">
          Assign a financial reporting category to each account. Income and equity
          accounts have been auto-classified. The accounts below require your input.
        </p>
      </div>

      {/* Info banner */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <span className="font-medium">Setup required —</span> these {pending.length} accounts must
        be reclassified before financial statements can generate accurate category breakdowns.
        Your selections are saved immediately.
      </div>

      <ReclassifyForm initialAccounts={pending as PendingAccount[]} />
    </div>
  );
}
