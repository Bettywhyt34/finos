"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

async function getOrgId() {
  const session = await auth();
  const orgId = session?.user?.tenantId;
  if (!orgId) throw new Error("Unauthorized");
  return orgId;
}

export async function createBankAccount(formData: FormData) {
  try {
    const tenantId = await getOrgId();
    const accountName = (formData.get("accountName") as string).trim();
    const accountNumber = (formData.get("accountNumber") as string).trim();
    const bankName = (formData.get("bankName") as string).trim();
    const currency = (formData.get("currency") as string) || "NGN";
    const openingBalance = parseFloat(formData.get("openingBalance") as string) || 0;

    if (!accountName || !accountNumber || !bankName) {
      return { error: "Account name, number, and bank name are required" };
    }

    await prisma.bankAccount.create({
      data: {
        tenantId,
        accountName,
        accountNumber,
        bankName,
        currency,
        openingBalance,
        currentBalance: openingBalance,
      },
    });

    revalidatePath("/banking/accounts");
    return { success: true };
  } catch {
    return { error: "Failed to create bank account" };
  }
}
