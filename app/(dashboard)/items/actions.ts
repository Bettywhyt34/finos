"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function createItem(formData: FormData) {
  const session = await auth();
  const orgId = session?.user?.organizationId;
  if (!orgId) return { error: "Unauthorized" };

  const itemCode = String(formData.get("itemCode") || "").trim();
  const name = String(formData.get("name") || "").trim();
  if (!itemCode || !name) return { error: "Code and name are required" };

  const type = String(formData.get("type") || "SERVICE") as "INVENTORY" | "SERVICE" | "NON_STOCK";

  try {
    await prisma.item.create({
      data: {
        organizationId: orgId,
        itemCode,
        name,
        description: String(formData.get("description") || "") || null,
        type,
        categoryId: String(formData.get("categoryId") || "") || null,
        unit: String(formData.get("unit") || "each"),
        salesPrice: formData.get("salesPrice") ? parseFloat(String(formData.get("salesPrice"))) : null,
        costPrice: formData.get("costPrice") ? parseFloat(String(formData.get("costPrice"))) : null,
        incomeAccountId: String(formData.get("incomeAccountId") || "") || null,
        expenseAccountId: String(formData.get("expenseAccountId") || "") || null,
        assetAccountId: String(formData.get("assetAccountId") || "") || null,
      },
    });
    revalidatePath("/items");
    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Unique constraint")) return { error: "Item code already exists" };
    return { error: msg };
  }
}

export async function createItemCategory(formData: FormData) {
  const session = await auth();
  const orgId = session?.user?.organizationId;
  if (!orgId) return { error: "Unauthorized" };

  const name = String(formData.get("name") || "").trim();
  if (!name) return { error: "Name is required" };

  await prisma.itemCategory.create({
    data: {
      organizationId: orgId,
      name,
      parentId: String(formData.get("parentId") || "") || null,
    },
  });
  revalidatePath("/items/categories");
  return { success: true };
}
