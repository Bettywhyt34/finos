"use server";

import { revalidatePath }                from "next/cache";
import { auth }                          from "@/lib/auth";
import { prisma }                        from "@/lib/prisma";
import { postJournalEntry }              from "@/lib/journal";
import { getRecognitionPeriod, toNGN }   from "@/lib/utils";
import { sendToBettywhyt }               from "@/lib/integrations/bettywhyt/webhook-sender";
import { sendInvoiceEmail }              from "@/lib/email-notifications/senders/invoice-sent";
import { previewTransactionNumber }      from "@/lib/customization/utils";
import { generateTransactionNumber }     from "@/lib/customization/service";

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
  /** Optional invoice number. Only used when allowManualOverride = true. */
  invoiceNumber?: string;
  /** Set to "bettywhyt_pos" to trigger a BettyWhyt outbound webhook for POS sales */
  source?: string;
}) {
  const session = await auth();
  const orgId   = session?.user?.tenantId;
  const userId  = session?.user?.id;
  if (!orgId || !userId) return { error: "Unauthorized" };

  if (data.lines.length === 0) return { error: "At least one line item is required" };
  const rate = data.exchangeRate || 1;

  // Amounts stored in document currency (e.g., USD)
  const subtotal    = data.lines.reduce((s, l) => s + l.quantity * l.rate, 0);
  const taxAmount   = data.lines.reduce((s, l) => s + l.quantity * l.rate * (l.taxRate / 100), 0);
  const totalAmount = subtotal - data.discountAmount + taxAmount;
  const totalNGN    = toNGN(totalAmount, rate);

  try {
    // ── Single atomic transaction ──────────────────────────────────────────────
    // All of the following happen atomically:
    //   1. Fetch INVOICE number series (with intent to update → implicit row lock)
    //   2. Determine final invoice number
    //   3. Advance the series counter (only when using auto-generated number)
    //   4. Duplicate check (when preventDuplicates = true)
    //   5. Create invoice + lines
    // If any step fails the entire transaction rolls back, including the counter update.
    const invoice = await prisma.$transaction(async (tx) => {

      // Step 1: fetch series
      const series = await tx.transactionNumberSeries.findFirst({
        where: { tenantId: orgId, module: "INVOICE" },
      });

      if (!series || !series.isEnabled) {
        throw new Error(
          "Invoice numbering is not configured. Please check Transaction Number Series in Settings.",
        );
      }

      // Step 2: determine final invoice number
      let finalNumber: string;
      const requestedNumber = data.invoiceNumber?.trim();

      if (requestedNumber) {
        // User supplied a number — check it is allowed
        if (!series.allowManualOverride) {
          throw new Error("Manual invoice number override is disabled.");
        }
        finalNumber = requestedNumber;
        // Counter is NOT advanced when using a manually supplied number.
      } else {
        // Auto-generate: atomically increment and capture the number to use.
        // `update` with `increment` acquires a row-level write lock in PostgreSQL,
        // preventing two concurrent transactions from generating the same number.
        const updated = await tx.transactionNumberSeries.update({
          where:  { id: series.id },
          data:   { nextNumber: { increment: 1 } },
          select: { nextNumber: true },
        });
        // updated.nextNumber is the NEW value; the invoice gets the PREVIOUS value.
        finalNumber = previewTransactionNumber({
          prefix:     series.prefix,
          suffix:     series.suffix,
          nextNumber: updated.nextNumber - 1,
          padLength:  series.padLength,
        });
      }

      // Step 3: duplicate check
      if (series.preventDuplicates) {
        const dup = await tx.invoice.findFirst({
          where: { tenantId: orgId, invoiceNumber: finalNumber },
          select: { id: true },
        });
        if (dup) {
          throw new Error("This invoice number is already in use.");
        }
      }

      // Step 4: create invoice + lines
      return tx.invoice.create({
        data: {
          tenantId:         orgId,
          customerId:       data.customerId,
          invoiceNumber:    finalNumber,
          reference:        data.reference || null,
          issueDate:        new Date(data.issueDate),
          dueDate:          new Date(data.dueDate),
          status:           "DRAFT",
          currency:         data.currency,
          exchangeRate:     rate,
          subtotal,
          discountAmount:   data.discountAmount,
          taxAmount,
          totalAmount,
          amountPaid:       0,
          balanceDue:       totalAmount,
          recognitionPeriod: data.recognitionPeriod,
          notes:            data.notes || null,
          lines: {
            create: data.lines.map((l) => ({
              itemId:      l.itemId || null,
              description: l.description,
              quantity:    l.quantity,
              rate:        l.rate,
              amount:      l.quantity * l.rate,
              taxRate:     l.taxRate,
            })),
          },
        },
      });
    });

    // ── Post journal in NGN (fire-and-forget, outside transaction) ────────────
    // Email/journal failure must not roll back the already-committed invoice.
    const fxNote = rate !== 1 ? ` (${data.currency} @ ${rate})` : "";
    await postJournalEntry({
      tenantId:          orgId,
      createdBy:         userId,
      entryDate:         new Date(data.issueDate),
      reference:         invoice.invoiceNumber,
      description:       `Invoice ${invoice.invoiceNumber}${fxNote}`,
      recognitionPeriod: data.recognitionPeriod,
      source:            "invoice",
      sourceId:          invoice.id,
      lines: [
        { accountCode: "CA-001", description: `AR - ${invoice.invoiceNumber}${fxNote}`,      debit: totalNGN, credit: 0       },
        { accountCode: "IN-001", description: `Revenue - ${invoice.invoiceNumber}${fxNote}`, debit: 0,       credit: totalNGN },
      ],
    }).catch(() => {});

    // BettyWhyt outbound hook: fire-and-forget for POS sales
    if (data.source === "bettywhyt_pos") {
      void sendToBettywhyt(orgId, "pos_sale", {
        invoiceId:     invoice.id,
        invoiceNumber: invoice.invoiceNumber,
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
      notes:     data.notes ?? invoice.notes,
      reference: data.reference !== undefined ? (data.reference || null) : invoice.reference,
      dueDate:   data.dueDate ? new Date(data.dueDate) : invoice.dueDate,
    },
  });
  revalidatePath(`/sales/invoices/${id}`);
  revalidatePath("/sales/invoices");
  return { success: true };
}

export async function updateDraftInvoice(
  id: string,
  data: {
    customerId:        string;
    reference?:        string;
    issueDate:         string;
    dueDate:           string;
    notes?:            string;
    recognitionPeriod: string;
    discountAmount:    number;
    currency:          string;
    exchangeRate:      number;
    lines:             LineItem[];
    /** Only honoured when allowManualOverride=true AND the user explicitly changed the number. */
    invoiceNumber?:    string;
  },
) {
  const session = await auth();
  const orgId   = session?.user?.tenantId;
  const userId  = session?.user?.id;
  if (!orgId || !userId) return { error: "Unauthorized" };

  if (data.lines.length === 0) return { error: "At least one line item is required" };
  const rate = data.exchangeRate || 1;

  const subtotal    = data.lines.reduce((s, l) => s + l.quantity * l.rate, 0);
  const taxAmount   = data.lines.reduce((s, l) => s + l.quantity * l.rate * (l.taxRate / 100), 0);
  const totalAmount = subtotal - data.discountAmount + taxAmount;
  const totalNGN    = toNGN(totalAmount, rate);

  try {
    // 1. Fetch invoice — tenant-scoped
    const existing = await prisma.invoice.findFirst({
      where: { id, tenantId: orgId },
    });
    if (!existing) return { error: "Invoice not found" };
    if (existing.status !== "DRAFT") return { error: "Only DRAFT invoices can be fully edited." };

    // 2. Validate customer belongs to tenant
    const customer = await prisma.customer.findFirst({ where: { id: data.customerId, tenantId: orgId } });
    if (!customer) return { error: "Customer not found" };

    // 3. Resolve invoice number — keep existing by default
    let finalNumber = existing.invoiceNumber;
    const requestedNumber = data.invoiceNumber?.trim();
    if (requestedNumber && requestedNumber !== existing.invoiceNumber) {
      const series = await prisma.transactionNumberSeries.findFirst({
        where: { tenantId: orgId, module: "INVOICE" },
      });
      if (!series?.allowManualOverride) {
        return { error: "Manual invoice number override is disabled." };
      }
      if (series.preventDuplicates) {
        const dup = await prisma.invoice.findFirst({
          where: { tenantId: orgId, invoiceNumber: requestedNumber, NOT: { id } },
          select: { id: true },
        });
        if (dup) return { error: "This invoice number is already in use." };
      }
      // Counter is NOT advanced — manual override only
      finalNumber = requestedNumber;
    }

    // 4. Update invoice header + replace lines atomically
    await prisma.$transaction(async (tx) => {
      // Delete all existing lines first
      await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });

      // Update invoice and create fresh lines
      await tx.invoice.update({
        where: { id, tenantId: orgId },
        data: {
          customerId:        data.customerId,
          invoiceNumber:     finalNumber,
          reference:         data.reference || null,
          issueDate:         new Date(data.issueDate),
          dueDate:           new Date(data.dueDate),
          currency:          data.currency,
          exchangeRate:      rate,
          subtotal,
          discountAmount:    data.discountAmount,
          taxAmount,
          totalAmount,
          balanceDue:        totalAmount, // DRAFT has no payments
          recognitionPeriod: data.recognitionPeriod,
          notes:             data.notes || null,
          lines: {
            create: data.lines.map((l) => ({
              itemId:      l.itemId || null,
              description: l.description,
              quantity:    l.quantity,
              rate:        l.rate,
              amount:      l.quantity * l.rate,
              taxRate:     l.taxRate,
            })),
          },
        },
      });
    });

    // 5. Reverse old journal + post new one if amounts changed (fire-and-forget)
    const oldRate     = parseFloat(String(existing.exchangeRate));
    const oldTotalNGN = toNGN(parseFloat(String(existing.totalAmount)), oldRate);
    const amountsChanged =
      Math.abs(oldTotalNGN - totalNGN) > 0.01 || existing.currency !== data.currency;

    if (amountsChanged) {
      const oldFxNote = oldRate !== 1 ? ` (${existing.currency} @ ${oldRate})` : "";
      const newFxNote = rate    !== 1 ? ` (${data.currency} @ ${rate})`        : "";

      await postJournalEntry({
        tenantId:          orgId,
        createdBy:         userId,
        entryDate:         new Date(),
        reference:         `REV-${existing.invoiceNumber}`,
        description:       `Reverse draft ${existing.invoiceNumber} (edit)${oldFxNote}`,
        recognitionPeriod: data.recognitionPeriod,
        source:            "invoice_edit_reversal",
        sourceId:          id,
        lines: [
          { accountCode: "IN-001", description: `Rev Revenue - ${existing.invoiceNumber}`, debit: oldTotalNGN, credit: 0           },
          { accountCode: "CA-001", description: `Rev AR - ${existing.invoiceNumber}`,      debit: 0,           credit: oldTotalNGN },
        ],
      }).catch(() => {});

      await postJournalEntry({
        tenantId:          orgId,
        createdBy:         userId,
        entryDate:         new Date(data.issueDate),
        reference:         finalNumber,
        description:       `Invoice ${finalNumber} (draft edit)${newFxNote}`,
        recognitionPeriod: data.recognitionPeriod,
        source:            "invoice",
        sourceId:          id,
        lines: [
          { accountCode: "CA-001", description: `AR - ${finalNumber}${newFxNote}`,      debit: totalNGN, credit: 0       },
          { accountCode: "IN-001", description: `Revenue - ${finalNumber}${newFxNote}`, debit: 0,       credit: totalNGN },
        ],
      }).catch(() => {});
    }

    revalidatePath(`/sales/invoices/${id}`);
    revalidatePath("/sales/invoices");
    return { success: true };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function voidInvoice(id: string, reason: string, convertToDraft: boolean) {
  const session = await auth();
  const orgId   = session?.user?.tenantId;
  const userId  = session?.user?.id;
  if (!orgId || !userId) return { error: "Unauthorized" };

  const invoice = await prisma.invoice.findFirst({
    where: { id, tenantId: orgId },
    include: { lines: true, customer: true },
  });
  if (!invoice) return { error: "Invoice not found" };
  if (invoice.status === "VOIDED") return { error: "Invoice already voided" };
  if (invoice.status === "PAID")   return { error: "Cannot void a fully paid invoice" };

  const rate     = parseFloat(String(invoice.exchangeRate));
  const totalNGN = toNGN(parseFloat(String(invoice.totalAmount)), rate);
  const fxNote   = rate !== 1 ? ` (${invoice.currency} @ ${rate})` : "";

  // Void the invoice (committed immediately — not in a transaction with the draft)
  await prisma.invoice.update({
    where: { id },
    data: { status: "VOIDED", voidedAt: new Date(), voidedReason: reason },
  });

  // Post reversal journal (flip DR/CR)
  await postJournalEntry({
    tenantId:          orgId,
    createdBy:         userId,
    entryDate:         new Date(),
    reference:         `VOID-${invoice.invoiceNumber}`,
    description:       `Void ${invoice.invoiceNumber}: ${reason}${fxNote}`,
    recognitionPeriod: getRecognitionPeriod(new Date()),
    source:            "invoice_void",
    sourceId:          invoice.id,
    lines: [
      { accountCode: "IN-001", description: `Void Revenue - ${invoice.invoiceNumber}`, debit: totalNGN, credit: 0       },
      { accountCode: "CA-001", description: `Void AR - ${invoice.invoiceNumber}`,      debit: 0,       credit: totalNGN },
    ],
  }).catch(() => {});

  let newInvoiceId: string | undefined;

  if (convertToDraft) {
    // Generate replacement number from the series (has its own transaction).
    // If the series is not configured this throws — the void is already committed
    // but we surface the error so the user can create the replacement manually.
    const newNumber = await generateTransactionNumber(orgId, "INVOICE");
    const newInvoice = await prisma.invoice.create({
      data: {
        tenantId:         orgId,
        customerId:       invoice.customerId,
        invoiceNumber:    newNumber,
        reference:        invoice.reference,
        issueDate:        invoice.issueDate,
        dueDate:          invoice.dueDate,
        status:           "DRAFT",
        currency:         invoice.currency,
        exchangeRate:     invoice.exchangeRate,
        subtotal:         invoice.subtotal,
        discountAmount:   invoice.discountAmount,
        taxAmount:        invoice.taxAmount,
        totalAmount:      invoice.totalAmount,
        amountPaid:       0,
        balanceDue:       invoice.totalAmount,
        recognitionPeriod: invoice.recognitionPeriod,
        notes:            invoice.notes,
        lines: {
          create: invoice.lines.map((l) => ({
            itemId:      l.itemId,
            description: l.description,
            quantity:    l.quantity,
            rate:        l.rate,
            amount:      l.amount,
            taxRate:     l.taxRate,
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
  const orgId   = session?.user?.tenantId;
  const userId  = session?.user?.id;
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

      const rate     = parseFloat(String(invoice.exchangeRate));
      const totalNGN = toNGN(parseFloat(String(invoice.totalAmount)), rate);
      const fxNote   = rate !== 1 ? ` (${invoice.currency} @ ${rate})` : "";

      const existingJE = await prisma.journalEntry.findFirst({
        where: { tenantId: orgId, sourceId: id },
      });

      if (!existingJE) {
        await postJournalEntry({
          tenantId:          orgId,
          createdBy:         userId,
          entryDate:         invoice.issueDate,
          reference:         invoice.invoiceNumber,
          description:       `Invoice ${invoice.invoiceNumber}${fxNote}`,
          recognitionPeriod: invoice.recognitionPeriod,
          source:            "invoice",
          sourceId:          invoice.id,
          lines: [
            { accountCode: "CA-001", description: `AR - ${invoice.invoiceNumber}${fxNote}`,      debit: totalNGN, credit: 0       },
            { accountCode: "IN-001", description: `Revenue - ${invoice.invoiceNumber}${fxNote}`, debit: 0,       credit: totalNGN },
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
  const orgId   = session?.user?.tenantId;
  const userId  = session?.user?.id;
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
          tenantId:    orgId,
          customerId:  data.customerId,
          paymentNumber,
          paymentDate: new Date(data.paymentDate),
          amount:      data.amount,
          method:      data.method as "BANK_TRANSFER" | "CHECK" | "CASH" | "CARD",
          reference:   data.reference || null,
          notes:       data.notes    || null,
          allocations: {
            create: data.invoiceAllocations.map((a) => ({
              invoiceId: a.invoiceId,
              amount:    a.amount,
            })),
          },
        },
      });

      for (const alloc of data.invoiceAllocations) {
        const inv = await tx.invoice.findUnique({ where: { id: alloc.invoiceId } });
        if (!inv) continue;
        const newPaid    = parseFloat(String(inv.amountPaid)) + alloc.amount;
        const newBalance = parseFloat(String(inv.totalAmount)) - newPaid;
        const newStatus  = newBalance <= 0.01 ? "PAID" : newPaid > 0 ? "PARTIAL" : inv.status;
        await tx.invoice.update({
          where: { id: alloc.invoiceId },
          data: {
            amountPaid: newPaid,
            balanceDue: newBalance,
            status:     newStatus,
            paidAt:     newStatus === "PAID" ? new Date() : undefined,
          },
        });
      }
      return pmt;
    });

    // Journal: DR Bank (NGN received) / CR AR (NGN equivalent)
    await postJournalEntry({
      tenantId:          orgId,
      createdBy:         userId,
      entryDate:         new Date(data.paymentDate),
      reference:         paymentNumber,
      description:       `Customer payment ${paymentNumber}`,
      recognitionPeriod: getRecognitionPeriod(new Date(data.paymentDate)),
      source:            "customer_payment",
      sourceId:          payment.id,
      lines: [
        { accountCode: "CA-003", description: `Bank receipt - ${paymentNumber}`, debit: data.amount, credit: 0           },
        { accountCode: "CA-001", description: `AR cleared - ${paymentNumber}`,  debit: 0,           credit: data.amount },
      ],
    }).catch(() => {});

    revalidatePath("/sales/invoices");
    revalidatePath("/sales/receipts");
    return { success: true, id: payment.id };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
