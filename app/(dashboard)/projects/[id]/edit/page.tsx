import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ProjectEditForm, type EditableProject } from "./project-edit-form";

interface ProjectEditRow {
  id: string;
  name: string;
  code: string | null;
  customerId: string;
  description: string | null;
  currency: string;
  startDate: Date;
  endDate: Date | null;
  contractValue: unknown;
  costBudget: unknown;
  marginTarget: unknown;
  defaultIncomeAccountId: string | null;
  contractAssetAccountId: string | null;
  unearnedIncomeAccountId: string | null;
  billingSchedule: unknown;
  notes: string | null;
  hasFinancialActivity: boolean;
}

interface Milestone { percentage: number; expectedDate: string }

function parseMilestones(value: unknown): Milestone[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Milestone => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    return typeof row.percentage === "number" && typeof row.expectedDate === "string";
  }).slice(0, 3);
}

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, session] = await Promise.all([params, auth()]);
  const tenantId = session?.user?.tenantId;
  const role = session?.user?.role;
  if (!tenantId || !role || !["OWNER", "ADMIN", "ACCOUNTANT"].includes(role)) notFound();

  const [rows, customers, accounts] = await Promise.all([
    prisma.$queryRaw<ProjectEditRow[]>`
      SELECT
        p."id", p."name", p."code", p."customer_id" AS "customerId", p."description",
        p."currency", p."start_date" AS "startDate", p."end_date" AS "endDate",
        p."contract_value" AS "contractValue", p."cost_budget" AS "costBudget",
        p."margin_target" AS "marginTarget", p."default_income_account_id" AS "defaultIncomeAccountId",
        p."contract_asset_account_id" AS "contractAssetAccountId",
        p."unearned_income_account_id" AS "unearnedIncomeAccountId",
        p."billing_schedule" AS "billingSchedule", p."notes",
        (
          EXISTS (
            SELECT 1 FROM "journal_entry_lines" jel
            INNER JOIN "journal_entries" je ON je."id" = jel."entry_id"
            WHERE je."tenant_id" = p."tenant_id" AND jel."project_id" = p."id"
          )
          OR EXISTS (
            SELECT 1 FROM "invoice_line_revenue_allocations" ila
            WHERE ila."tenant_id" = p."tenant_id" AND ila."project_id" = p."id"
          )
          OR EXISTS (
            SELECT 1 FROM "project_revenue_recognitions" prr
            WHERE prr."tenant_id" = p."tenant_id" AND prr."project_id" = p."id"
          )
        ) AS "hasFinancialActivity"
      FROM "projects" p
      WHERE p."id" = ${id} AND p."tenant_id" = ${tenantId}::uuid
      LIMIT 1
    `,
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

  const row = rows[0];
  if (!row) notFound();

  const project: EditableProject = {
    id: row.id,
    name: row.name,
    code: row.code,
    customerId: row.customerId,
    description: row.description,
    currency: row.currency,
    startDate: row.startDate.toISOString().slice(0, 10),
    endDate: row.endDate?.toISOString().slice(0, 10) ?? null,
    contractValue: Number(row.contractValue),
    costBudget: row.costBudget == null ? null : Number(row.costBudget),
    marginTarget: row.marginTarget == null ? null : Number(row.marginTarget),
    defaultIncomeAccountId: row.defaultIncomeAccountId,
    contractAssetAccountId: row.contractAssetAccountId,
    unearnedIncomeAccountId: row.unearnedIncomeAccountId,
    billingSchedule: parseMilestones(row.billingSchedule),
    notes: row.notes,
    hasFinancialActivity: Boolean(row.hasFinancialActivity),
  };

  const option = (account: { id: string; code: string; name: string }) => ({ id: account.id, label: `${account.code} · ${account.name}` });

  return (
    <div className="mx-auto max-w-6xl">
      <Link href={`/projects/${project.id}`} className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-[var(--finos-accent)] hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to Project
      </Link>
      <div className="mb-6">
        <h1 className="text-[34px] font-medium tracking-[-0.02em] text-[var(--text-primary)]">Edit project</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Revise the commercial plan and future defaults without rewriting posted accounting history.</p>
      </div>
      <ProjectEditForm
        project={project}
        customers={customers.map((customer) => ({ id: customer.id, label: `${customer.companyName} · ${customer.customerCode}` }))}
        incomeAccounts={accounts.filter((account) => account.type === "INCOME").map(option)}
        assetAccounts={accounts.filter((account) => account.type === "ASSET").map(option)}
        liabilityAccounts={accounts.filter((account) => account.type === "LIABILITY").map(option)}
      />
    </div>
  );
}
