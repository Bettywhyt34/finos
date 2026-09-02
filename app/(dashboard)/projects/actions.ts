"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export interface ProjectActionState { error?: string; }
const optionalNumber = z.preprocess((value) => value === "" || value == null ? undefined : value, z.coerce.number().nonnegative().optional());
const optionalInteger = z.preprocess((value) => value === "" || value == null ? undefined : value, z.coerce.number().int().min(0).max(3650).optional());

const projectSchema = z.object({
  name: z.string().trim().min(2, "Project name is required").max(160),
  code: z.string().trim().max(50).optional(),
  customerId: z.string().min(1, "Customer is required"),
  description: z.string().trim().max(2000).optional(),
  status: z.enum(["DRAFT", "ACTIVE", "ON_HOLD"]),
  currency: z.string().trim().min(3).max(3),
  startDate: z.coerce.date(),
  endDate: z.preprocess((value) => value === "" ? undefined : value, z.coerce.date().optional()),
  contractValue: z.coerce.number().nonnegative(),
  costBudget: optionalNumber,
  marginTarget: z.preprocess((value) => value === "" || value == null ? undefined : value, z.coerce.number().min(0).max(100).optional()),
  paymentTermsDays: optionalInteger,
  defaultIncomeAccountId: z.string().optional(),
  contractAssetAccountId: z.string().optional(),
  unearnedIncomeAccountId: z.string().optional(),
  notes: z.string().trim().max(4000).optional(),
});

export async function createProject(_previousState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  const userId = session?.user?.id;
  const role = session?.user?.role;
  if (!tenantId || !userId) return { error: "Your session has expired. Please sign in again." };
  if (!role || !["OWNER", "ADMIN", "ACCOUNTANT"].includes(role)) return { error: "You do not have permission to create projects." };

  const parsed = projectSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please review the project information." };
  const data = parsed.data;
  if (data.endDate && data.endDate < data.startDate) return { error: "End date cannot be before the start date." };

  const customer = await prisma.customer.findFirst({ where: { id: data.customerId, tenantId, isActive: true }, select: { id: true } });
  if (!customer) return { error: "Select an active customer that belongs to the current entity." };
  if (data.code) {
    const duplicateCode = await prisma.project.findFirst({ where: { tenantId, code: data.code }, select: { id: true } });
    if (duplicateCode) return { error: "That project code is already in use." };
  }

  const requestedAccounts = [
    data.defaultIncomeAccountId ? { id: data.defaultIncomeAccountId, type: "INCOME" as const, label: "Default income account" } : null,
    data.contractAssetAccountId ? { id: data.contractAssetAccountId, type: "ASSET" as const, label: "Contract Asset account" } : null,
    data.unearnedIncomeAccountId ? { id: data.unearnedIncomeAccountId, type: "LIABILITY" as const, label: "Unearned Income account" } : null,
  ].filter((value): value is NonNullable<typeof value> => Boolean(value));
  if (requestedAccounts.length > 0) {
    const ids = [...new Set(requestedAccounts.map((account) => account.id))];
    const accounts = await prisma.chartOfAccounts.findMany({ where: { tenantId, id: { in: ids }, isActive: true }, select: { id: true, type: true } });
    const accountMap = new Map(accounts.map((account) => [account.id, account.type]));
    for (const account of requestedAccounts) {
      if (accountMap.get(account.id) !== account.type) return { error: `${account.label} must be an active ${account.type.toLowerCase()} account in this entity.` };
    }
  }

  const billingPercentages = [1, 2, 3].map((index) => ({ percentage: Number(formData.get(`billingPercentage${index}`) || 0), expectedDate: String(formData.get(`billingDate${index}`) || "") })).filter((milestone) => milestone.percentage > 0 || milestone.expectedDate);
  if (billingPercentages.some((milestone) => milestone.percentage <= 0 || !milestone.expectedDate)) return { error: "Each billing milestone requires both a percentage and expected date." };
  const billingTotal = billingPercentages.reduce((sum, milestone) => sum + milestone.percentage, 0);
  if (billingPercentages.length > 0 && Math.abs(billingTotal - 100) > 0.001) return { error: "Billing milestone percentages must total 100%." };

  try {
    await prisma.$transaction(async (tx) => {
      const projects = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO "projects" (
          "tenant_id","customer_id","name","code","description","status","currency",
          "start_date","end_date","contract_value","cost_budget","margin_target","payment_terms_days",
          "default_income_account_id","contract_asset_account_id","unearned_income_account_id",
          "billing_schedule","notes","created_by"
        ) VALUES (
          ${tenantId},${data.customerId},${data.name},${data.code || null},${data.description || null},
          ${data.status}::"ProjectStatus",${data.currency.toUpperCase()},${data.startDate},${data.endDate ?? null},
          ${data.contractValue},${data.costBudget ?? null},${data.marginTarget ?? null},${data.paymentTermsDays ?? null},
          ${data.defaultIncomeAccountId || null},${data.contractAssetAccountId || null},${data.unearnedIncomeAccountId || null},
          CAST(${JSON.stringify(billingPercentages)} AS jsonb),${data.notes || null},${userId}
        ) RETURNING "id"
      `;
      await tx.$executeRaw`
        INSERT INTO "project_activities" ("tenant_id","project_id","event_type","title","description","actor_id","actor_name","metadata")
        VALUES (${tenantId}::uuid,${projects[0].id},'PROJECT_CREATED','Project created','Initial project setup was recorded.',${userId},${session.user.email ?? null},
          CAST(${JSON.stringify({ status: data.status, contractValue: data.contractValue, currency: data.currency.toUpperCase(), paymentTermsDays: data.paymentTermsDays ?? null })} AS jsonb))
      `;
    });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2010") return { error: "The project could not be saved. Check that the Projects migration has been applied and try again." };
    return { error: "The project could not be saved. Please check the project details and try again." };
  }
  revalidatePath("/projects");
  redirect("/projects");
}
