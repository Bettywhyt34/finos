"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export interface ProjectEditState { error?: string }

const optionalNumber = z.preprocess(
  (value) => value === "" || value == null ? undefined : value,
  z.coerce.number().nonnegative().optional(),
);

const editSchema = z.object({
  name: z.string().trim().min(2, "Project name is required").max(160),
  code: z.string().trim().max(50).optional(),
  customerId: z.string().min(1, "Customer is required"),
  description: z.string().trim().max(2000).optional(),
  currency: z.string().trim().min(3).max(3),
  startDate: z.coerce.date(),
  endDate: z.preprocess((value) => value === "" ? undefined : value, z.coerce.date().optional()),
  contractValue: z.coerce.number().nonnegative(),
  costBudget: optionalNumber,
  marginTarget: z.preprocess(
    (value) => value === "" || value == null ? undefined : value,
    z.coerce.number().min(0).max(100).optional(),
  ),
  defaultIncomeAccountId: z.string().optional(),
  contractAssetAccountId: z.string().optional(),
  unearnedIncomeAccountId: z.string().optional(),
  notes: z.string().trim().max(4000).optional(),
});

export async function updateProject(
  projectId: string,
  _previousState: ProjectEditState,
  formData: FormData,
): Promise<ProjectEditState> {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  const userId = session?.user?.id;
  const role = session?.user?.role;
  if (!tenantId || !userId) return { error: "Your session has expired. Please sign in again." };
  if (!role || !["OWNER", "ADMIN", "ACCOUNTANT"].includes(role)) {
    return { error: "You do not have permission to edit Projects." };
  }

  const parsed = editSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Review the Project information." };
  const data = parsed.data;
  const currency = data.currency.toUpperCase();
  if (data.endDate && data.endDate < data.startDate) return { error: "End date cannot be before the start date." };

  const billingMilestones = [1, 2, 3]
    .map((index) => ({
      percentage: Number(formData.get(`billingPercentage${index}`) || 0),
      expectedDate: String(formData.get(`billingDate${index}`) || ""),
    }))
    .filter((milestone) => milestone.percentage > 0 || milestone.expectedDate);
  if (billingMilestones.some((milestone) => milestone.percentage <= 0 || !milestone.expectedDate)) {
    return { error: "Each billing milestone requires both a percentage and expected date." };
  }
  const billingTotal = billingMilestones.reduce((sum, milestone) => sum + milestone.percentage, 0);
  if (billingMilestones.length && Math.abs(billingTotal - 100) > 0.001) {
    return { error: "Billing milestone percentages must total 100%." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:project-edit:${tenantId}:${projectId}`}))`;
      const project = await tx.project.findFirst({
        where: { id: projectId, tenantId },
        select: {
          id: true,
          name: true,
          code: true,
          customerId: true,
          currency: true,
          contractValue: true,
          costBudget: true,
          marginTarget: true,
          defaultIncomeAccountId: true,
          contractAssetAccountId: true,
          unearnedIncomeAccountId: true,
        },
      });
      if (!project) throw new Error("Project not found.");

      const customer = await tx.customer.findFirst({
        where: { id: data.customerId, tenantId, isActive: true },
        select: { id: true },
      });
      if (!customer) throw new Error("Select an active customer in this entity.");

      if (data.code) {
        const duplicate = await tx.project.findFirst({
          where: { tenantId, code: data.code, id: { not: projectId } },
          select: { id: true },
        });
        if (duplicate) throw new Error("That Project code is already in use.");
      }

      const requestedAccounts = [
        data.defaultIncomeAccountId ? { id: data.defaultIncomeAccountId, type: "INCOME", label: "Default income account" } : null,
        data.contractAssetAccountId ? { id: data.contractAssetAccountId, type: "ASSET", label: "Contract Asset account" } : null,
        data.unearnedIncomeAccountId ? { id: data.unearnedIncomeAccountId, type: "LIABILITY", label: "Unearned Income account" } : null,
      ].filter((value): value is { id: string; type: string; label: string } => Boolean(value));
      if (requestedAccounts.length) {
        const accounts = await tx.chartOfAccounts.findMany({
          where: { tenantId, id: { in: [...new Set(requestedAccounts.map((account) => account.id))] }, isActive: true },
          select: { id: true, type: true },
        });
        const accountMap = new Map(accounts.map((account) => [account.id, String(account.type)]));
        for (const account of requestedAccounts) {
          if (accountMap.get(account.id) !== account.type) {
            throw new Error(`${account.label} must be an active ${account.type.toLowerCase()} account in this entity.`);
          }
        }
      }

      const activity = await tx.$queryRaw<Array<{ hasActivity: boolean }>>`
        SELECT (
          EXISTS (
            SELECT 1 FROM "journal_entry_lines" jel
            INNER JOIN "journal_entries" je ON je."id" = jel."entry_id"
            WHERE je."tenant_id" = ${tenantId}::uuid AND jel."project_id" = ${projectId}
          )
          OR EXISTS (
            SELECT 1 FROM "invoice_line_revenue_allocations" ila
            WHERE ila."tenant_id" = ${tenantId}::uuid AND ila."project_id" = ${projectId}
          )
          OR EXISTS (
            SELECT 1 FROM "project_revenue_recognitions" prr
            WHERE prr."tenant_id" = ${tenantId}::uuid AND prr."project_id" = ${projectId}
          )
        ) AS "hasActivity"
      `;
      const hasFinancialActivity = Boolean(activity[0]?.hasActivity);
      if (hasFinancialActivity && data.customerId !== project.customerId) {
        throw new Error("Customer cannot be changed after the Project has posted financial activity. Create a new Project if the commercial counterparty has changed.");
      }
      if (hasFinancialActivity && currency !== project.currency) {
        throw new Error("Project currency cannot be changed after financial activity has been posted.");
      }

      const changes = {
        name: project.name === data.name ? undefined : { from: project.name, to: data.name },
        code: (project.code ?? "") === (data.code ?? "") ? undefined : { from: project.code, to: data.code || null },
        customerId: project.customerId === data.customerId ? undefined : { from: project.customerId, to: data.customerId },
        currency: project.currency === currency ? undefined : { from: project.currency, to: currency },
        contractValue: Number(project.contractValue) === data.contractValue ? undefined : { from: Number(project.contractValue), to: data.contractValue },
        costBudget: Number(project.costBudget ?? 0) === Number(data.costBudget ?? 0) ? undefined : { from: project.costBudget == null ? null : Number(project.costBudget), to: data.costBudget ?? null },
        marginTarget: Number(project.marginTarget ?? 0) === Number(data.marginTarget ?? 0) ? undefined : { from: project.marginTarget == null ? null : Number(project.marginTarget), to: data.marginTarget ?? null },
        defaultIncomeAccountId: project.defaultIncomeAccountId === (data.defaultIncomeAccountId || null) ? undefined : { from: project.defaultIncomeAccountId, to: data.defaultIncomeAccountId || null },
        contractAssetAccountId: project.contractAssetAccountId === (data.contractAssetAccountId || null) ? undefined : { from: project.contractAssetAccountId, to: data.contractAssetAccountId || null },
        unearnedIncomeAccountId: project.unearnedIncomeAccountId === (data.unearnedIncomeAccountId || null) ? undefined : { from: project.unearnedIncomeAccountId, to: data.unearnedIncomeAccountId || null },
      };
      const materialChanges = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined));

      await tx.$executeRaw`
        UPDATE "projects"
        SET "customer_id" = ${data.customerId},
            "name" = ${data.name},
            "code" = ${data.code || null},
            "description" = ${data.description || null},
            "currency" = ${currency},
            "start_date" = ${data.startDate},
            "end_date" = ${data.endDate ?? null},
            "contract_value" = ${data.contractValue},
            "cost_budget" = ${data.costBudget ?? null},
            "margin_target" = ${data.marginTarget ?? null},
            "default_income_account_id" = ${data.defaultIncomeAccountId || null},
            "contract_asset_account_id" = ${data.contractAssetAccountId || null},
            "unearned_income_account_id" = ${data.unearnedIncomeAccountId || null},
            "billing_schedule" = CAST(${JSON.stringify(billingMilestones)} AS jsonb),
            "notes" = ${data.notes || null},
            "updated_at" = now()
        WHERE "id" = ${projectId} AND "tenant_id" = ${tenantId}::uuid
      `;

      await tx.$executeRaw`
        INSERT INTO "project_activities" (
          "tenant_id", "project_id", "event_type", "title", "description", "actor_id", "actor_name", "metadata"
        ) VALUES (
          ${tenantId}::uuid, ${projectId}, 'PROJECT_UPDATED', 'Project updated',
          'Project commercial plan or future accounting defaults were updated. Posted accounting history was not changed.',
          ${userId}, ${session.user.email ?? null}, CAST(${JSON.stringify({ changes: materialChanges, hasFinancialActivity })} AS jsonb)
        )
      `;
    });
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "The Project could not be updated." };
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  redirect(`/projects/${projectId}`);
}
