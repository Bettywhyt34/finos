"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import type { TransactionType } from "@prisma/client";

async function getOrgId() {
  const session = await auth();
  const orgId = session?.user?.tenantId;
  if (!orgId) throw new Error("Unauthorized");
  return orgId;
}

export async function createTransaction(bankAccountId: string, formData: FormData) {
  try {
    const tenantId = await getOrgId();

    // Verify the bank account belongs to this org
    const account = await prisma.bankAccount.findFirst({
      where: { id: bankAccountId, tenantId },
    });
    if (!account) return { error: "Account not found" };

    const transactionDate = new Date(formData.get("transactionDate") as string);
    const description = (formData.get("description") as string).trim();
    const reference = (formData.get("reference") as string | null)?.trim() || null;
    const amount = parseFloat(formData.get("amount") as string);
    const type = formData.get("type") as TransactionType;

    if (!description || isNaN(amount) || amount <= 0) {
      return { error: "Description and a positive amount are required" };
    }

    const balanceDelta = type === "CREDIT" ? amount : -amount;
    const newBalance = parseFloat(String(account.currentBalance)) + balanceDelta;

    await prisma.$transaction([
      prisma.bankTransaction.create({
        data: {
          bankAccountId,
          transactionDate,
          description,
          reference,
          amount,
          type,
        },
      }),
      prisma.bankAccount.update({
        where: { id: bankAccountId },
        data: { currentBalance: newBalance },
      }),
    ]);

    revalidatePath(`/banking/${bankAccountId}`);
    revalidatePath("/banking/accounts");
    return { success: true };
  } catch {
    return { error: "Failed to record transaction" };
  }
}
