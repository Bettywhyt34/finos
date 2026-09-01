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

function normalizeText(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function rowKey(input: {
  date: Date;
  amount: number;
  type: TransactionType;
  reference?: string | null;
  description: string;
}) {
  const date = input.date.toISOString().slice(0, 10);
  return [
    date,
    input.type,
    input.amount.toFixed(2),
    normalizeText(input.reference),
    normalizeText(input.description),
  ].join("|");
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const orgId = session?.user?.tenantId;
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const accountId = String(body?.accountId ?? "");
  const transactions = Array.isArray(body?.transactions) ? body.transactions as ImportRow[] : [];

  if (!accountId) return NextResponse.json({ error: "Bank account is required" }, { status: 400 });
  if (!transactions.length) return NextResponse.json({ error: "No statement transactions supplied" }, { status: 400 });
  if (transactions.length > 10000) {
    return NextResponse.json({ error: "Import is limited to 10,000 statement rows at a time" }, { status: 400 });
  }

  const account = await prisma.bankAccount.findFirst({
    where: { id: accountId, tenantId: orgId },
    select: { id: true, currentBalance: true },
  });
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const prepared = transactions.map((row, index) => {
    const date = new Date(row.date);
    const amount = Number.parseFloat(String(row.amount).replace(/,/g, ""));
    const type: TransactionType = row.type === "DEBIT" ? "DEBIT" : "CREDIT";
    const description = String(row.description ?? "").trim();
    const reference = String(row.reference ?? "").trim() || null;

    if (Number.isNaN(date.getTime())) throw new Error(`Invalid date on row ${index + 1}`);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error(`Invalid amount on row ${index + 1}`);
    if (!description) throw new Error(`Description is required on row ${index + 1}`);

    return { bankAccountId: accountId, transactionDate: date, description, reference, amount, type };
  });

  const minDate = new Date(Math.min(...prepared.map((row) => row.transactionDate.getTime())));
  const maxDate = new Date(Math.max(...prepared.map((row) => row.transactionDate.getTime())));
  maxDate.setDate(maxDate.getDate() + 1);

  const existing = await prisma.bankTransaction.findMany({
    where: {
      bankAccountId: accountId,
      transactionDate: { gte: minDate, lt: maxDate },
    },
    select: {
      transactionDate: true,
      description: true,
      reference: true,
      amount: true,
      type: true,
    },
  });

  const existingKeys = new Set(existing.map((row) => rowKey({
    date: row.transactionDate,
    amount: Number(row.amount),
    type: row.type,
    reference: row.reference,
    description: row.description,
  })));

  const batchKeys = new Set<string>();
  const uniqueRows = prepared.filter((row) => {
    const key = rowKey({
      date: row.transactionDate,
      amount: row.amount,
      type: row.type,
      reference: row.reference,
      description: row.description,
    });
    if (existingKeys.has(key) || batchKeys.has(key)) return false;
    batchKeys.add(key);
    return true;
  });

  const skipped = prepared.length - uniqueRows.length;
  const balanceDelta = uniqueRows.reduce(
    (sum, row) => sum + (row.type === "CREDIT" ? row.amount : -row.amount),
    0,
  );

  if (uniqueRows.length) {
    const newBalance = Number(account.currentBalance) + balanceDelta;
    await prisma.$transaction([
      prisma.bankTransaction.createMany({ data: uniqueRows }),
      prisma.bankAccount.update({
        where: { id: accountId },
        data: { currentBalance: newBalance },
      }),
    ]);
  }

  revalidatePath(`/banking/${accountId}`);
  revalidatePath("/banking/accounts");
  revalidatePath("/banking/reconciliation");

  return NextResponse.json({
    success: true,
    count: uniqueRows.length,
    skipped,
    received: prepared.length,
  });
}
