import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ProjectForm } from "./project-form";

export default async function NewProjectPage() {
  const session = await auth();
  const tenantId = session!.user.tenantId!;

  const [tenant, customers, accounts] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } }),
    prisma.customer.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, companyName: true, customerCode: true },
      orderBy: { companyName: "asc" },
    }),
    prisma.chartOfAccounts.findMany({
      where: { tenantId, isActive: true, type: { in: ["INCOME", "ASSET", "LIABILITY"] } },
      select: { id: true, code: true, name: true, type: true },
      orderBy: { code: "asc" },
    }),
  ]);

  const option = (account: { id: string; code: string; name: string }) => ({
    id: account.id,
    label: `${account.code} · ${account.name}`,
  });

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/projects" className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-[var(--finos-accent)]">
        <ArrowLeft className="h-4 w-4" /> Back to Projects
      </Link>
      <div className="mb-6">
        <h1 className="text-[34px] font-medium tracking-[-0.02em] text-[var(--text-primary)]">Create project</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Set up the commercial plan, billing milestones and accounting defaults.</p>
      </div>
      <ProjectForm
        customers={customers.map((customer) => ({ id: customer.id, label: `${customer.companyName} · ${customer.customerCode}` }))}
        incomeAccounts={accounts.filter((account) => account.type === "INCOME").map(option)}
        assetAccounts={accounts.filter((account) => account.type === "ASSET").map(option)}
        liabilityAccounts={accounts.filter((account) => account.type === "LIABILITY").map(option)}
        currency={tenant?.currency ?? "NGN"}
      />
    </div>
  );
}
