"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function createCustomer(formData: FormData) {
  const session = await auth();
  const orgId = session?.user?.tenantId;
  if (!orgId) return { error: "Unauthorized" };

  const customerCode = String(formData.get("customerCode") || "").trim();
  const companyName = String(formData.get("companyName") || "").trim();

  if (!customerCode || !companyName) return { error: "Code and company name are required" };

  try {
    await prisma.customer.create({
      data: {
        tenantId: orgId,
        customerCode,
        companyName,
        contactName: String(formData.get("contactName") || "") || null,
        email: String(formData.get("email") || "") || null,
        phone: String(formData.get("phone") || "") || null,
        billingAddress: String(formData.get("billingAddress") || "") || null,
        paymentTerms: parseInt(String(formData.get("paymentTerms") || "30")),
        creditLimit: formData.get("creditLimit") ? parseFloat(String(formData.get("creditLimit"))) : null,
      },
    });
    revalidatePath("/customers");
    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Unique constraint")) return { error: "Customer code already exists" };
    return { error: msg };
  }
}

export async function updateCustomer(id: string, formData: FormData) {
  const session = await auth();
  const orgId = session?.user?.tenantId;
  if (!orgId) return { error: "Unauthorized" };

  try {
    await prisma.customer.update({
      where: { id, tenantId: orgId },
      data: {
        companyName: String(formData.get("companyName") || ""),
        contactName: String(formData.get("contactName") || "") || null,
        email: String(formData.get("email") || "") || null,
        phone: String(formData.get("phone") || "") || null,
        billingAddress: String(formData.get("billingAddress") || "") || null,
        paymentTerms: parseInt(String(formData.get("paymentTerms") || "30")),
        creditLimit: formData.get("creditLimit") ? parseFloat(String(formData.get("creditLimit"))) : null,
      },
    });
    revalidatePath("/customers");
    revalidatePath(`/customers/${id}`);
    return { success: true };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deactivateCustomer(id: string) {
  const session = await auth();
  const orgId = session?.user?.tenantId;
  if (!orgId) return { error: "Unauthorized" };

  await prisma.customer.update({
    where: { id, tenantId: orgId },
    data: { isActive: false },
  });
  revalidatePath("/customers");
  return { success: true };
}
