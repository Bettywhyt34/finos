"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import type { AccountType, FinancialCategory } from "@prisma/client";

const PATH = "/accounting/chart-of-accounts";

type UiCategory =
  | "CURRENT_ASSETS"
  | "FIXED_ASSETS"
  | "CURRENT_LIABILITIES"
  | "LONG_TERM_LIABILITIES"
  | "EQUITY"
  | "INCOME"
  | "EXPENSES";

const CATEGORY_MAP: Record<UiCategory, { type: AccountType; financialCategory: FinancialCategory }> = {
  CURRENT_ASSETS: { type: "ASSET", financialCategory: "CURRENT_ASSET" },
  FIXED_ASSETS: { type: "ASSET", financialCategory: "NON_CURRENT_ASSET" },
  CURRENT_LIABILITIES: { type: "LIABILITY", financialCategory: "CURRENT_LIABILITY" },
  LONG_TERM_LIABILITIES: { type: "LIABILITY", financialCategory: "NON_CURRENT_LIABILITY" },
  EQUITY: { type: "EQUITY", financialCategory: "EQUITY" },
  INCOME: { type: "INCOME", financialCategory: "INCOME" },
  EXPENSES: { type: "EXPENSE", financialCategory: "EXPENSES" },
};

function resolveClassification(category: string, group: string) {
  const base = CATEGORY_MAP[category as UiCategory];
  if (!base) throw new Error("Invalid account category");

  let financialCategory = base.financialCategory;
  if (category === "INCOME" && group === "Other Income") financialCategory = "OTHER_INCOME";
  if (category === "EXPENSES") {
    if (group === "Cost of Sales / Direct Costs") financialCategory = "COST_OF_SALES";
    else if (group === "Other Expenses") financialCategory = "OTHER_EXPENSES";
    else financialCategory = "EXPENSES";
  }

  return { type: base.type, financialCategory };
}

async function getOrgId() {
  const session = await auth();
  const orgId = session?.user?.tenantId;
  if (!orgId) throw new Error("Unauthorized");
  return orgId;
}

async function validateParent(tenantId: string, parentId: string | null, type: AccountType) {
  if (!parentId) return;
  const parent = await prisma.chartOfAccounts.findFirst({
    where: { id: parentId, tenantId, isActive: true },
    select: { id: true, type: true },
  });
  if (!parent || parent.type !== type) throw new Error("Invalid parent account");
}

export async function createAccount(formData: FormData) {
  try {
    const tenantId = await getOrgId();
    const code = (formData.get("code") as string | null)?.trim() || "";
    const name = (formData.get("name") as string | null)?.trim() || "";
    const category = (formData.get("category") as string | null) || "";
    const group = (formData.get("group") as string | null)?.trim() || "";
    const description = (formData.get("description") as string | null)?.trim() || null;
    const parentId = (formData.get("parentId") as string | null) || null;

    if (!code || !name || !category || !group) {
      return { error: "Account name, category, group and code are required" };
    }

    const { type, financialCategory } = resolveClassification(category, group);
    await validateParent(tenantId, parentId, type);

    await prisma.$transaction(async (tx) => {
      const account = await tx.chartOfAccounts.create({
        data: {
          tenantId,
          code,
          name,
          type,
          subtype: group,
          financialCategory,
          parentId: parentId || null,
        },
        select: { id: true },
      });

      if (description) {
        await tx.$executeRaw`
          update chart_of_accounts
          set description = ${description}
          where id = ${account.id} and tenant_id = ${tenantId}::uuid
        `;
      }
    });

    revalidatePath(PATH);
    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Unique constraint")) return { error: "Account code already exists" };
    if (msg === "Invalid parent account" || msg === "Invalid account category") return { error: msg };
    return { error: "Failed to create account" };
  }
}

export async function updateAccount(id: string, formData: FormData) {
  try {
    const tenantId = await getOrgId();
    const code = (formData.get("code") as string | null)?.trim() || "";
    const name = (formData.get("name") as string | null)?.trim() || "";
    const category = (formData.get("category") as string | null) || "";
    const group = (formData.get("group") as string | null)?.trim() || "";
    const description = (formData.get("description") as string | null)?.trim() || null;
    const parentId = (formData.get("parentId") as string | null) || null;

    if (!code || !name || !category || !group) {
      return { error: "Account name, category, group and code are required" };
    }

    const { type, financialCategory } = resolveClassification(category, group);
    await validateParent(tenantId, parentId, type);

    await prisma.$transaction(async (tx) => {
      await tx.chartOfAccounts.update({
        where: { id, tenantId },
        data: {
          code,
          name,
          type,
          subtype: group,
          financialCategory,
          parentId: parentId || null,
        },
      });

      await tx.$executeRaw`
        update chart_of_accounts
        set description = ${description}
        where id = ${id} and tenant_id = ${tenantId}::uuid
      `;
    });

    revalidatePath(PATH);
    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Unique constraint")) return { error: "Account code already exists" };
    if (msg === "Invalid parent account" || msg === "Invalid account category") return { error: msg };
    return { error: "Failed to update account" };
  }
}

export async function toggleAccountStatus(id: string, isActive: boolean) {
  try {
    const tenantId = await getOrgId();
    await prisma.chartOfAccounts.update({
      where: { id, tenantId },
      data: { isActive },
    });
    revalidatePath(PATH);
    return { success: true };
  } catch {
    return { error: "Failed to update account status" };
  }
}
