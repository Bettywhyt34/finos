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

export async function markTransactionsReconciled(transactionIds: string[]) {
  try {
    const tenantId = await getOrgId();

    // Verify all transactions belong to this org
    const count = await prisma.bankTransaction.count({
      where: {
        id: { in: transactionIds },
        bankAccount: { tenantId },
      },
    });
    if (count !== transactionIds.length) return { error: "Unauthorized" };

    await prisma.bankTransaction.updateMany({
      where: { id: { in: transactionIds } },
      data: { isReconciled: true },
    });

    revalidatePath("/banking/reconciliation");
    return { success: true, count: transactionIds.length };
  } catch {
    return { error: "Failed to mark transactions as reconciled" };
  }
}

export async function fetchUnreconciledTransactions(
  bankAccountId: string,
  from: string,
  to: string
) {
  try {
    const tenantId = await getOrgId();

    const account = await prisma.bankAccount.findFirst({
      where: { id: bankAccountId, tenantId },
    });
    if (!account) return { error: "Account not found" };

    const transactions = await prisma.bankTransaction.findMany({
      where: {
        bankAccountId,
        isReconciled: false,
        transactionDate: {
          gte: new Date(from),
          lte: new Date(to),
        },
      },
      orderBy: { transactionDate: "asc" },
    });

    return {
      transactions: transactions.map((t) => ({
        id: t.id,
        transactionDate: t.transactionDate.toISOString(),
        description: t.description,
        reference: t.reference,
        amount: parseFloat(String(t.amount)),
        type: t.type,
        isReconciled: t.isReconciled,
      })),
      accountName: account.accountName,
      currency: account.currency,
      currentBalance: parseFloat(String(account.currentBalance)),
    };
  } catch {
    return { error: "Failed to load transactions" };
  }
}
