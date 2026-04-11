"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { postJournalEntry } from "@/lib/journal";
import { getRecognitionPeriod, toNGN } from "@/lib/utils";
import { sendToBettywhyt } from "@/lib/integrations/bettywhyt/webhook-sender";

async function getNextBillNumber(orgId: string): Promise<string> {
  const count = await prisma.bill.count({ where: { tenantId: orgId } });
  return `BILL-${String(count + 1).padStart(5, "0")}`;
}

export interface BillLineItem {
  itemId?: string;
  description: string;
  quantity: number;
  rate: number;
  accountId: string;
}

export async function createBill(data: {
  vendorId: string;
  vendorRef?: string;
  billDate: string;
  dueDate: string;
  notes?: string;
  currency: string;
  exchangeRate: number;
  lines: BillLineItem[];
}) {
  const session = await auth();
  const orgId = session?.user?.tenantId;
  const userId = session?.user?.id;
  if (!orgId || !userId) return { error: "Unauthorized" };

  if (data.lines.length === 0) return { error: "At least one line item is required" };
  if (data.lines.some((l) => !l.accountId)) return { error: "Each line must have an expense account" };

  const rate = data.exchangeRate || 1;
  const subtotal = data.lines.reduce((s, l) => s + l.quantity * l.rate, 0);
  const subtotalNGN = toNGN(subtotal, rate);
  const billNumber = await getNextBillNumber(orgId);
  const fxNote = rate !== 1 ? ` (${data.currency} @ ${rate})` : "";

  try {
    const bill = await prisma.bill.create({
      data: {
        tenantId: orgId,
        vendorId: data.vendorId,
        billNumber,
        vendorRef: data.vendorRef || null,
        billDate: new Date(data.billDate),
        dueDate: new Date(data.dueDate),
        status: "DRAFT",
        currency: data.currency,
        exchangeRate: rate,
        subtotal,
        taxAmount: 0,
        totalAmount: subtotal,
        amountPaid: 0,
        notes: data.notes || null,
        lines: {
          create: data.lines.map((l) => ({
            itemId: l.itemId || null,
            description: l.description,
            quantity: l.quantity,
            rate: l.rate,
            amount: l.quantity * l.rate,
            accountId: l.accountId,
          })),
        },
      },
    });

    // Fetch expense account codes for journal
    const accountIds = Array.from(new Set(data.lines.map((l) => l.accountId)));
    const accounts = await prisma.chartOfAccounts.findMany({
      where: { id: { in: accountIds } },
      select: { id: true, code: true },
    });
    const idToCode = Object.fromEntries(accounts.map((a) => [a.id, a.code]));

    const period = getRecognitionPeriod(new Date(data.billDate));

    // Aggregate by account code in NGN
    const expenseByCode: Record<string, number> = {};
    for (const l of data.lines) {
      const code = idToCode[l.accountId];
      expenseByCode[code] = (expenseByCode[code] ?? 0) + toNGN(l.quantity * l.rate, rate);
    }

    await postJournalEntry({
      tenantId: orgId,
      createdBy: userId,
      entryDate: new Date(data.billDate),
      reference: billNumber,
      description: `Bill ${billNumber}${fxNote}`,
      recognitionPeriod: period,
      source: "bill",
      sourceId: bill.id,
      lines: [
        ...Object.entries(expenseByCode).map(([code, amtNGN]) => ({
          accountCode: code,
          description: `Expense - ${billNumber}${fxNote}`,
          debit: amtNGN,
          credit: 0,
        })),
        { accountCode: "CL-001", description: `AP - ${billNumber}${fxNote}`, debit: 0, credit: subtotalNGN },
      ],
    }).catch(() => {});

    // BettyWhyt outbound hook: notify BettyWhyt of stock receipt (fire-and-forget)
    void sendToBettywhyt(orgId, "stock_received", {
      billId:   bill.id,
      billNumber,
      items: data.lines
        .filter((l) => l.itemId)
        .map((l) => ({
          itemId:      l.itemId,
          description: l.description,
          quantity:    l.quantity,
        })),
    });

    revalidatePath("/purchases/bills");
    return { success: true, id: bill.id };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function recordBillPayment(data: {
  vendorId: string;
  paymentDate: string;
  amount: number;          // always in NGN
  method: string;
  reference?: string;
  whtAmount: number;
  billAllocations: { billId: string; amount: number }[];
}) {
  const session = await auth();
  const orgId = session?.user?.tenantId;
  const userId = session?.user?.id;
  if (!orgId || !userId) return { error: "Unauthorized" };

  const count = await prisma.vendorPayment.count({ where: { tenantId: orgId } });
  const paymentNumber = `VPY-${String(count + 1).padStart(5, "0")}`;
  const netAmount = data.amount - data.whtAmount;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.vendorPayment.create({
        data: {
          tenantId: orgId,
          vendorId: data.vendorId,
          paymentNumber,
          paymentDate: new Date(data.paymentDate),
          amount: data.amount,
          method: data.method as "BANK_TRANSFER" | "CHECK" | "CASH" | "CARD",
          reference: data.reference || null,
          whtAmount: data.whtAmount,
        },
      });

      for (const alloc of data.billAllocations) {
        const bill = await tx.bill.findUnique({ where: { id: alloc.billId } });
        if (!bill) continue;
        const newPaid = parseFloat(String(bill.amountPaid)) + alloc.amount;
        const newBalance = parseFloat(String(bill.totalAmount)) - newPaid;
        const newStatus = newBalance <= 0.01 ? "PAID" : newPaid > 0 ? "PARTIAL" : bill.status;
        await tx.bill.update({
          where: { id: alloc.billId },
          data: { amountPaid: newPaid, status: newStatus },
        });
      }
    });

    const period = getRecognitionPeriod(new Date(data.paymentDate));
    const jLines = [
      { accountCode: "CL-001", description: `AP settled - ${paymentNumber}`, debit: data.amount, credit: 0 },
      { accountCode: "CA-003", description: `Bank payment - ${paymentNumber}`, debit: 0, credit: netAmount },
    ];
    if (data.whtAmount > 0) {
      jLines.push({ accountCode: "CL-002", description: `WHT payable - ${paymentNumber}`, debit: 0, credit: data.whtAmount });
    }
    await postJournalEntry({
      tenantId: orgId,
      createdBy: userId,
      entryDate: new Date(data.paymentDate),
      reference: paymentNumber,
      description: `Vendor payment ${paymentNumber}`,
      recognitionPeriod: period,
      source: "vendor_payment",
      sourceId: paymentNumber,
      lines: jLines,
    }).catch(() => {});

    revalidatePath("/purchases/bills");
    revalidatePath("/purchases/payments");
    return { success: true };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
