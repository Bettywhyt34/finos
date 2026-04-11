import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import type { TransactionType } from "@prisma/client";

interface ImportRow {
  date: string;
  description: string;
  amount: string;
  type: TransactionType;
  reference: string;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const orgId = session?.user?.tenantId;
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { accountId, transactions }: { accountId: string; transactions: ImportRow[] } =
    await req.json();

  const account = await prisma.bankAccount.findFirst({
    where: { id: accountId, tenantId: orgId },
  });
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  let balanceDelta = 0;

  const txData = transactions.map((row) => {
    const amount = parseFloat(row.amount) || 0;
    const type: TransactionType = row.type === "DEBIT" ? "DEBIT" : "CREDIT";
    balanceDelta += type === "CREDIT" ? amount : -amount;
    return {
      bankAccountId: accountId,
      transactionDate: new Date(row.date),
      description: row.description,
      reference: row.reference || null,
      amount,
      type,
    };
  });

  const newBalance = parseFloat(String(account.currentBalance)) + balanceDelta;

  await prisma.$transaction([
    prisma.bankTransaction.createMany({ data: txData }),
    prisma.bankAccount.update({
      where: { id: accountId },
      data: { currentBalance: newBalance },
    }),
  ]);

  revalidatePath(`/banking/${accountId}`);
  revalidatePath("/banking/accounts");

  return NextResponse.json({ success: true, count: txData.length });
}
