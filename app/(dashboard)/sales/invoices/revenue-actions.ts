"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { postStandaloneInvoiceRevenueRecognition } from "@/lib/invoices/revenue-evidence";

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export async function recogniseStandaloneInvoiceRevenue(input: {
  invoiceId: string;
  amount: number;
  recognitionDate: string;
  note?: string;
}): Promise<{ success: true; recognitionId: string; amount: number } | { error: string }> {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  const userId = session?.user?.id;
  const role = session?.user?.role;
  if (!tenantId || !userId) return { error: "Your session has expired. Please sign in again." };
  if (!role || !["OWNER", "ADMIN", "ACCOUNTANT"].includes(role)) {
    return { error: "You do not have permission to recognise revenue." };
  }

  const amount = roundMoney(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Recognition amount must be greater than zero." };
  const recognitionDate = new Date(`${input.recognitionDate}T00:00:00`);
  if (Number.isNaN(recognitionDate.getTime())) return { error: "Enter a valid recognition date." };
  if (recognitionDate > new Date()) return { error: "Recognition date cannot be in the future." };
  const note = input.note?.trim() || null;
  if (note && note.length > 2000) return { error: "Recognition note is too long." };

  try {
    const recognitionId = crypto.randomUUID();
    const result = await prisma.$transaction((tx) => postStandaloneInvoiceRevenueRecognition(tx, {
      tenantId,
      invoiceId: input.invoiceId,
      userId,
      recognitionId,
      recognitionDate,
      transactionAmount: amount,
      note,
    }));

    revalidatePath("/sales/invoices");
    revalidatePath(`/sales/invoices/${input.invoiceId}`);
    revalidatePath("/accounting/profit-loss");
    revalidatePath("/accounting/balance-sheet");
    return { success: true, recognitionId, amount: result.transactionAmount };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Revenue could not be recognised." };
  }
}
