"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function createVendor(formData: FormData) {
  const session = await auth();
  const orgId = session?.user?.organizationId;
  if (!orgId) return { error: "Unauthorized" };

  const vendorCode = String(formData.get("vendorCode") || "").trim();
  const companyName = String(formData.get("companyName") || "").trim();
  if (!vendorCode || !companyName) return { error: "Code and company name are required" };

  try {
    await prisma.vendor.create({
      data: {
        organizationId: orgId,
        vendorCode,
        companyName,
        contactName: String(formData.get("contactName") || "") || null,
        email: String(formData.get("email") || "") || null,
        phone: String(formData.get("phone") || "") || null,
        address: String(formData.get("address") || "") || null,
        paymentTerms: parseInt(String(formData.get("paymentTerms") || "30")),
        bankName: String(formData.get("bankName") || "") || null,
        bankAccount: String(formData.get("bankAccount") || "") || null,
        isWhtEligible: formData.get("isWhtEligible") === "true",
      },
    });
    revalidatePath("/vendors");
    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Unique constraint")) return { error: "Vendor code already exists" };
    return { error: msg };
  }
}

export async function deactivateVendor(id: string) {
  const session = await auth();
  const orgId = session?.user?.organizationId;
  if (!orgId) return { error: "Unauthorized" };
  await prisma.vendor.update({ where: { id, organizationId: orgId }, data: { isActive: false } });
  revalidatePath("/vendors");
  return { success: true };
}
