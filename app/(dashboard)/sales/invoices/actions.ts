"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { postJournalEntry } from "@/lib/journal";
import { getRecognitionPeriod, toNGN } from "@/lib/utils";
import { sendToBettywhyt }   from "@/lib/integrations/bettywhyt/webhook-sender";
import { sendInvoiceEmail }  from "@/lib/email-notifications/senders/invoice-sent";

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

export async function sendInvoice(id: string, dateSent?: string) {
  const session = await auth();
  const orgId = session?.user?.tenantId;
  if (!orgId) return { error: "Unauthorized" };
  const sentAt = dateSent ? new Date(dateSent) : new Date();
  await prisma.invoice.update({
    where: { id, tenantId: orgId },
    data: { status: "SENT", sentAt },
  });

  // Fire-and-forget: email failure must not block the status update.
  // TODO: replace console logs with email delivery log table (future audit improvement).
  void sendInvoiceEmail({ tenantId: orgId, invoiceId: id })
    .then((result) => {
      if (!result.sent) {
        console.warn(`[INVOICE_SENT] Email not sent for invoice ${id}: ${result.reason}`);
      }
    })
    .catch((err: unknown) => {
      console.error(`[INVOICE_SENT] Unexpected error sending email for invoice ${id}:`, err);
    });

  revalidatePath(`/sales/invoices/${id}`);
  revalidatePath("/sales/invoices");
  return { success: true };
}

export async function updateInvoice(id: string, data: {
  notes?: string;
  reference?: string;
  dueDate?: string;
}) {
  const session = await auth();
  const orgId = session?.user?.tenantId;
  if (!orgId) return { error: "Unauthorized" };

  const invoice = await prisma.invoice.findFirst({ where: { id, tenantId: orgId } });
  if (!invoice) return { error: "Invoice not found" };
  if (invoice.status === "VOIDED") return { error: "Cannot edit a voided invoice" };

  await prisma.invoice.update({
    where: { id },
    data: {
      notes: data.notes ?? invoice.notes,
      reference: data.reference !== undefined ? (data.reference || null) : invoice.reference,
      dueDate: data.dueDate ? new Date(data.dueDate) : invoice.dueDate,
    },
  });
  revalidatePath(`/sales/invoices/${id}`);
  revalidatePath("/sales/invoices");
  return { success: true };
}

export async function voidInvoice(id: string, reason: string, convertToDraft: boolean) {
  const session = await auth();
  const orgId = session?.user?.tenantId;
  const userId = session?.user?.id;
  if (!orgId || !userId) return { error: "Unauthorized" };

  const invoice = await prisma.invoice.findFirst({
    where: { id, tenantId: orgId },
    include: { lines: true, customer: true },
  });
  if (!invoice) return { error: "Invoice not found" };
  if (invoice.status === "VOIDED") return { error: "Invoice already voided" };
  if (invoice.status === "PAID") return { error: "Cannot void a fully paid invoice" };

  const rate = parseFloat(String(invoice.exchangeRate));
  const totalNGN = toNGN(parseFloat(String(invoice.totalAmount)), rate);
  const fxNote = rate !== 1 ? ` (${invoice.currency} @ ${rate})` : "";

  // Void the invoice
  await prisma.invoice.update({
    where: { id },
    data: { status: "VOIDED", voidedAt: new Date(), voidedReason: reason },
  });

  // Post reversal journal (flip DR/CR)
  await postJournalEntry({
    tenantId: orgId,
    createdBy: userId,
    entryDate: new Date(),
    reference: `VOID-${invoice.invoiceNumber}`,
    description: `Void ${invoice.invoiceNumber}: ${reason}${fxNote}`,
    recognitionPeriod: getRecognitionPeriod(new Date()),
    source: "invoice_void",
    sourceId: invoice.id,
    lines: [
      { accountCode: "IN-001", description: `Void Revenue - ${invoice.invoiceNumber}`, debit: totalNGN, credit: 0 },
      { accountCode: "CA-001", description: `Void AR - ${invoice.invoiceNumber}`, debit: 0, credit: totalNGN },
    ],
  }).catch(() => {});

  let newInvoiceId: string | undefined;

  if (convertToDraft) {
    const newNumber = await getNextInvoiceNumber(orgId);
    const newInvoice = await prisma.invoice.create({
      data: {
        tenantId: orgId,
        customerId: invoice.customerId,
        invoiceNumber: newNumber,
        reference: invoice.reference,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        status: "DRAFT",
        currency: invoice.currency,
        exchangeRate: invoice.exchangeRate,
        subtotal: invoice.subtotal,
        discountAmount: invoice.discountAmount,
        taxAmount: invoice.taxAmount,
        totalAmount: invoice.totalAmount,
        amountPaid: 0,
        balanceDue: invoice.totalAmount,
        recognitionPeriod: invoice.recognitionPeriod,
        notes: invoice.notes,
        lines: {
          create: invoice.lines.map((l) => ({
            itemId: l.itemId,
            description: l.description,
            quantity: l.quantity,
            rate: l.rate,
            amount: l.amount,
            taxRate: l.taxRate,
          })),
        },
      },
    });
    newInvoiceId = newInvoice.id;
  }

  revalidatePath(`/sales/invoices/${id}`);
  revalidatePath("/sales/invoices");
  return { success: true, newInvoiceId };
}

export async function postInvoicesToLedger(ids: string[]) {
  const session = await auth();
  const orgId = session?.user?.tenantId;
  const userId = session?.user?.id;
  if (!orgId || !userId) return { error: "Unauthorized" };

  let posted = 0;
  let skipped = 0;
  const errors: Array<{ id: string; error: string }> = [];

  for (const id of ids) {
    try {
      const invoice = await prisma.invoice.findFirst({
        where: { id, tenantId: orgId, status: "DRAFT" },
      });
      if (!invoice) { skipped++; continue; }

      const rate = parseFloat(String(invoice.exchangeRate));
      const totalNGN = toNGN(parseFloat(String(invoice.totalAmount)), rate);
      const fxNote = rate !== 1 ? ` (${invoice.currency} @ ${rate})` : "";

      // Check if a journal entry was already posted for this invoice
      const existingJE = await prisma.journalEntry.findFirst({
        where: { tenantId: orgId, sourceId: id },
      });

      if (!existingJE) {
        await postJournalEntry({
          tenantId: orgId,
          createdBy: userId,
          entryDate: invoice.issueDate,
          reference: invoice.invoiceNumber,
          description: `Invoice ${invoice.invoiceNumber}${fxNote}`,
          recognitionPeriod: invoice.recognitionPeriod,
          source: "invoice",
          sourceId: invoice.id,
          lines: [
            { accountCode: "CA-001", description: `AR - ${invoice.invoiceNumber}${fxNote}`, debit: totalNGN, credit: 0 },
            { accountCode: "IN-001", description: `Revenue - ${invoice.invoiceNumber}${fxNote}`, debit: 0, credit: totalNGN },
          ],
        });
      }

      await prisma.invoice.update({
        where: { id },
        data: { status: "SENT", sentAt: new Date() },
      });
      posted++;
    } catch (e: unknown) {
      errors.push({ id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  revalidatePath("/sales/invoices");
  return { posted, skipped, errors };
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
          data: {
            amountPaid: newPaid,
            balanceDue: newBalance,
            status: newStatus,
            paidAt: newStatus === "PAID" ? new Date() : undefined,
          },
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
