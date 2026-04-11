"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import type { AccountType } from "@prisma/client";

const PATH = "/accounting/chart-of-accounts";

async function getOrgId() {
  const session = await auth();
  const orgId = session?.user?.tenantId;
  if (!orgId) throw new Error("Unauthorized");
  return orgId;
}

export async function createAccount(formData: FormData) {
  try {
    const tenantId = await getOrgId();
    const code = (formData.get("code") as string).trim();
    const name = (formData.get("name") as string).trim();
    const type = formData.get("type") as AccountType;
    const subtype = (formData.get("subtype") as string | null)?.trim() || null;
    const parentId = (formData.get("parentId") as string | null) || null;

    if (!code || !name || !type) return { error: "Code, name and type are required" };

    await prisma.chartOfAccounts.create({
      data: { tenantId, code, name, type, subtype, parentId: parentId || null },
    });

    revalidatePath(PATH);
    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Unique constraint")) return { error: "Account code already exists" };
    return { error: "Failed to create account" };
  }
}

export async function updateAccount(id: string, formData: FormData) {
  try {
    const tenantId = await getOrgId();
    const code = (formData.get("code") as string).trim();
    const name = (formData.get("name") as string).trim();
    const type = formData.get("type") as AccountType;
    const subtype = (formData.get("subtype") as string | null)?.trim() || null;
    const parentId = (formData.get("parentId") as string | null) || null;

    if (!code || !name || !type) return { error: "Code, name and type are required" };

    await prisma.chartOfAccounts.update({
      where: { id, tenantId },
      data: { code, name, type, subtype, parentId: parentId || null },
    });

    revalidatePath(PATH);
    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Unique constraint")) return { error: "Account code already exists" };
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
