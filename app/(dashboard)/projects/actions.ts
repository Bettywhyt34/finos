"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export interface ProjectActionState {
  error?: string;
}

const optionalNumber = z.preprocess(
  (value) => value === "" || value == null ? undefined : value,
  z.coerce.number().nonnegative().optional()
);

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
  marginTarget: z.preprocess(
    (value) => value === "" || value == null ? undefined : value,
    z.coerce.number().min(0).max(100).optional()
  ),
  defaultIncomeAccountId: z.string().optional(),
  contractAssetAccountId: z.string().optional(),
  unearnedIncomeAccountId: z.string().optional(),
  notes: z.string().trim().max(4000).optional(),
});

export async function createProject(
  _previousState: ProjectActionState,
  formData: FormData
): Promise<ProjectActionState> {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  const userId = session?.user?.id;
  const role = session?.user?.role;

  if (!tenantId || !userId) return { error: "Your session has expired. Please sign in again." };
  if (!role || !["OWNER", "ADMIN", "ACCOUNTANT"].includes(role)) {
    return { error: "You do not have permission to create projects." };
  }

  const parsed = projectSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please review the project information." };
  }

  const data = parsed.data;
  if (data.endDate && data.endDate < data.startDate) {
    return { error: "End date cannot be before the start date." };
  }

  const customer = await prisma.customer.findFirst({
    where: { id: data.customerId, tenantId },
    select: { id: true },
  });
  if (!customer) return { error: "Select a customer that belongs to the active entity." };

  const accountIds = [
    data.defaultIncomeAccountId,
    data.contractAssetAccountId,
    data.unearnedIncomeAccountId,
  ].filter((value): value is string => Boolean(value));
  if (accountIds.length > 0) {
    const accountCount = await prisma.chartOfAccounts.count({
      where: { tenantId, id: { in: [...new Set(accountIds)] }, isActive: true },
    });
    if (accountCount !== new Set(accountIds).size) {
      return { error: "One or more selected accounts are not available to the active entity." };
    }
  }

  const billingPercentages = [1, 2, 3]
    .map((index) => ({
      percentage: Number(formData.get(`billingPercentage${index}`) || 0),
      expectedDate: String(formData.get(`billingDate${index}`) || ""),
    }))
    .filter((milestone) => milestone.percentage > 0 || milestone.expectedDate);
  if (billingPercentages.some((milestone) => milestone.percentage <= 0 || !milestone.expectedDate)) {
    return { error: "Each billing milestone requires both a percentage and expected date." };
  }
  const billingTotal = billingPercentages.reduce((sum, milestone) => sum + milestone.percentage, 0);
  if (billingPercentages.length > 0 && Math.abs(billingTotal - 100) > 0.001) {
    return { error: "Billing milestone percentages must total 100%." };
  }

  try {
    await prisma.$executeRaw`
      INSERT INTO "projects" (
        "tenant_id", "customer_id", "name", "code", "description", "status", "currency",
        "start_date", "end_date", "contract_value", "cost_budget", "margin_target",
        "default_income_account_id", "contract_asset_account_id", "unearned_income_account_id",
        "billing_schedule", "notes", "created_by"
      ) VALUES (
        ${tenantId}, ${data.customerId}, ${data.name}, ${data.code || null}, ${data.description || null},
        ${data.status}::"ProjectStatus", ${data.currency.toUpperCase()}, ${data.startDate}, ${data.endDate ?? null},
        ${data.contractValue}, ${data.costBudget ?? null}, ${data.marginTarget ?? null},
        ${data.defaultIncomeAccountId || null}, ${data.contractAssetAccountId || null},
        ${data.unearnedIncomeAccountId || null},
        CAST(${JSON.stringify(billingPercentages)} AS jsonb), ${data.notes || null}, ${userId}
      )
    `;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2010") {
      return { error: "The project could not be saved. Check that the local Projects migration has been applied." };
    }
    return { error: "The project could not be saved. Please check the code and try again." };
  }

  revalidatePath("/projects");
  redirect("/projects");
}
