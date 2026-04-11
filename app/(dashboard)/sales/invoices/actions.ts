"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { postJournalEntry } from "@/lib/journal";
import { getRecognitionPeriod, toNGN } from "@/lib/utils";
import { sendToBettywhyt } from "@/lib/integrations/bettywhyt/webhook-sender";

async function getNextInvoiceNumber(orgId: string): Promise<string> {
  const count = await prisma.invoice.count({ where: { tenantId: orgId } });
  return `INV-${String(count + 1).padStart(5, "0")}`;
}

export interface LineItem {
  itemId?: string;
  description: string;
  quantity: number;
  rate: number;
  taxRate: number;
}

export async function createInvoice(data: {
  customerId: string;
  reference?: string;
  issueDate: string;
  dueDate: string;
  notes?: string;
  recognitionPeriod: string;
  discountAmount: number;
  currency: string;
  exchangeRate: number;
  lines: LineItem[];
  /** Set to "bettywhyt_pos" to trigger a BettyWhyt outbound webhook for POS sales */
  source?: string;
}) {
  const session = await auth();
  const orgId = session?.user?.tenantId;
  const userId = session?.user?.id;
  if (!orgId || !userId) return { error: "Unauthorized" };

  if (data.lines.length === 0) return { error: "At least one line item is required" };
  const rate = data.exchangeRate || 1;

  // Amounts stored in document currency (e.g., USD)
  const subtotal = data.lines.reduce((s, l) => s + l.quantity * l.rate, 0);
  const taxAmount = data.lines.reduce((s, l) => s + l.quantity * l.rate * (l.taxRate / 100), 0);
  const totalAmount = subtotal - data.discountAmount + taxAmount;
  const invoiceNumber = await getNextInvoiceNumber(orgId);

  // NGN equivalents for journal posting
  const totalNGN = toNGN(totalAmount, rate);

  try {
    const invoice = await prisma.invoice.create({
      data: {
        tenantId: orgId,
        customerId: data.customerId,
        invoiceNumber,
        reference: data.reference || null,
        issueDate: new Date(data.issueDate),
        dueDate: new Date(data.dueDate),
        status: "DRAFT",
        currency: data.currency,
        exchangeRate: rate,
        subtotal,
        discountAmount: data.discountAmount,
        taxAmount,
        totalAmount,
        amountPaid: 0,
        balanceDue: totalAmount,
        recognitionPeriod: data.recognitionPeriod,
        notes: data.notes || null,
        lines: {
          create: data.lines.map((l) => ({
            itemId: l.itemId || null,
            description: l.description,
            quantity: l.quantity,
            rate: l.rate,
            amount: l.quantity * l.rate,
            taxRate: l.taxRate,
          })),
        },
      },
    });

    // Auto-post journal in NGN (DR AR / CR Revenue)
    const fxNote = rate !== 1 ? ` (${data.currency} @ ${rate})` : "";
    await postJournalEntry({
      tenantId: orgId,
      createdBy: userId,
      entryDate: new Date(data.issueDate),
      reference: invoiceNumber,
      description: `Invoice ${invoiceNumber}${fxNote}`,
      recognitionPeriod: data.recognitionPeriod,
      source: "invoice",
      sourceId: invoice.id,
      lines: [
        { accountCode: "CA-001", description: `AR - ${invoiceNumber}${fxNote}`, debit: totalNGN, credit: 0 },
        { accountCode: "IN-001", description: `Revenue - ${invoiceNumber}${fxNote}`, debit: 0, credit: totalNGN },
      ],
    }).catch(() => {});

    // BettyWhyt outbound hook: fire-and-forget for POS sales
    if (data.source === "bettywhyt_pos") {
      void sendToBettywhyt(orgId, "pos_sale", {
        invoiceId:     invoice.id,
        invoiceNumber,
        items: data.lines.map((l) => ({
          itemId:      l.itemId,
          description: l.description,
          quantity:    l.quantity,
          price:       l.rate,
        })),
      });
    }

    revalidatePath("/sales/invoices");
    return { success: true, id: invoice.id };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function sendInvoice(id: string) {
  const session = await auth();
  const orgId = session?.user?.tenantId;
  if (!orgId) return { error: "Unauthorized" };
  await prisma.invoice.update({
    where: { id, tenantId: orgId },
    data: { status: "SENT", sentAt: new Date() },
  });
  revalidatePath(`/sales/invoices/${id}`);
  revalidatePath("/sales/invoices");
  return { success: true };
}

export async function recordPayment(data: {
  customerId: string;
  paymentDate: string;
  amount: number;          // always in NGN (the amount physically received)
  method: string;
  reference?: string;
  notes?: string;
  invoiceAllocations: { invoiceId: string; amount: number }[];
}) {
  const session = await auth();
  const orgId = session?.user?.tenantId;
  const userId = session?.user?.id;
  if (!orgId || !userId) return { error: "Unauthorized" };

  const totalAllocated = data.invoiceAllocations.reduce((s, a) => s + a.amount, 0);
  if (Math.abs(totalAllocated - data.amount) > 0.01) {
    return { error: "Allocated amount must equal payment amount" };
  }

  const count = await prisma.customerPayment.count({ where: { tenantId: orgId } });
  const paymentNumber = `RCP-${String(count + 1).padStart(5, "0")}`;

  try {
    const payment = await prisma.$transaction(async (tx) => {
      const pmt = await tx.customerPayment.create({
        data: {
          tenantId: orgId,
          customerId: data.customerId,
          paymentNumber,
          paymentDate: new Date(data.paymentDate),
          amount: data.amount,
          method: data.method as "BANK_TRANSFER" | "CHECK" | "CASH" | "CARD",
          reference: data.reference || null,
          notes: data.notes || null,
          allocations: {
            create: data.invoiceAllocations.map((a) => ({
              invoiceId: a.invoiceId,
              amount: a.amount,
            })),
          },
        },
      });

      for (const alloc of data.invoiceAllocations) {
        const inv = await tx.invoice.findUnique({ where: { id: alloc.invoiceId } });
        if (!inv) continue;
        const newPaid = parseFloat(String(inv.amountPaid)) + alloc.amount;
        const newBalance = parseFloat(String(inv.totalAmount)) - newPaid;
        const newStatus = newBalance <= 0.01 ? "PAID" : newPaid > 0 ? "PARTIAL" : inv.status;
        await tx.invoice.update({
          where: { id: alloc.invoiceId },
          data: { amountPaid: newPaid, balanceDue: newBalance, status: newStatus },
        });
      }
      return pmt;
    });

    // Journal: DR Bank (NGN received) / CR AR (NGN equivalent)
    await postJournalEntry({
      tenantId: orgId,
      createdBy: userId,
      entryDate: new Date(data.paymentDate),
      reference: paymentNumber,
      description: `Customer payment ${paymentNumber}`,
      recognitionPeriod: getRecognitionPeriod(new Date(data.paymentDate)),
      source: "customer_payment",
      sourceId: payment.id,
      lines: [
        { accountCode: "CA-003", description: `Bank receipt - ${paymentNumber}`, debit: data.amount, credit: 0 },
        { accountCode: "CA-001", description: `AR cleared - ${paymentNumber}`, debit: 0, credit: data.amount },
      ],
    }).catch(() => {});

    revalidatePath("/sales/invoices");
    revalidatePath("/sales/receipts");
    return { success: true, id: payment.id };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
