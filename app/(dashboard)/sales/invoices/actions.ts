"use server";

import { revalidatePath }                from "next/cache";
import { auth }                          from "@/lib/auth";
import { prisma }                        from "@/lib/prisma";
import { postJournalEntry }              from "@/lib/journal";
import { getRecognitionPeriod, toNGN }   from "@/lib/utils";
import { sendToBettywhyt }               from "@/lib/integrations/bettywhyt/webhook-sender";
import { postInvoiceAndMarkSent }        from "@/lib/invoices/post-invoice";
import { previewTransactionNumber }      from "@/lib/customization/utils";
import { generateTransactionNumber }     from "@/lib/customization/service";

export interface LineItem {
  itemId?:         string;
  description:     string;
  quantity:        number;
  rate:            number;
  taxRateId?:      string;          // FK to TaxRate ("" or undefined = no tax)
  discountType:    "PERCENT" | "FIXED";
  discountValue:   number;
  incomeAccountId?: string;         // FK to ChartOfAccounts ("" or undefined = fallback)
}

interface ResolvedLine {
  itemId:          string | null;
  description:     string;
  quantity:        number;
  rate:            number;
  amount:          number;          // gross = qty × rate
  taxRateId:       string | null;
  taxName:         string | null;
  taxRate:         number;
  taxAmount:       number;
  discountType:    string;
  discountValue:   number;
  discountAmount:  number;
  lineTotal:       number;
  incomeAccountId: string | null;
}

/** Server-side: resolve tax FKs, income account FKs, snapshot names/rates, compute per-line amounts. */
async function resolveLines(
  tenantId: string,
  lines:    LineItem[],
): Promise<ResolvedLine[]> {
  // ── Tax rates ──────────────────────────────────────────────────────────────
  const taxIds = Array.from(
    new Set(lines.map((l) => l.taxRateId?.trim() || "").filter(Boolean)),
  );

  const taxRateMap = new Map<string, { name: string; rate: number }>();
  if (taxIds.length > 0) {
    const rows = await prisma.taxRate.findMany({
      where: { id: { in: taxIds }, tenantId, isActive: true },
      select: { id: true, name: true, rate: true },
    });
    for (const r of rows) {
      taxRateMap.set(r.id, { name: r.name, rate: parseFloat(String(r.rate)) });
    }
    // Unknown ids → silently treated as "no tax" (prevents cross-tenant injection)
  }

  // ── Income accounts ────────────────────────────────────────────────────────
  const incomeIds = Array.from(
    new Set(lines.map((l) => l.incomeAccountId?.trim() || "").filter(Boolean)),
  );

  // Validate explicitly submitted income accounts.
  // Unknown ids (wrong tenant, wrong type, inactive) are collected for rejection.
  const incomeAccountMap = new Map<string, string>();
  if (incomeIds.length > 0) {
    const rows = await prisma.chartOfAccounts.findMany({
      where: { id: { in: incomeIds }, tenantId, type: "INCOME", isActive: true },
      select: { id: true },
    });
    for (const r of rows) incomeAccountMap.set(r.id, r.id);

    // Any submitted id not found in the validated map is invalid.
    // Reject immediately — do not silently fallback for an explicitly chosen account.
    const invalidIds = incomeIds.filter((id) => !incomeAccountMap.has(id));
    if (invalidIds.length > 0) {
      throw new Error(
        `One or more income accounts are invalid, inactive, or do not belong to this organisation. ` +
        `Please refresh the form and reselect the income account for each affected line.`
      );
    }
  }

  // Fallback chain (used only when incomeAccountId is empty/missing):
  //   1. item.incomeAccountId  (resolved per-line below)
  //   2. tenant's active IN-001
  //   3. first active INCOME account (order by code)
  //   4. null
  let fallbackIncomeAccountId: string | null = null;
  const fallback = await prisma.chartOfAccounts.findFirst({
    where: { tenantId, code: "IN-001", type: "INCOME", isActive: true },
    select: { id: true },
  }) ?? await prisma.chartOfAccounts.findFirst({
    where:   { tenantId, type: "INCOME", isActive: true },
    orderBy: { code: "asc" },
    select:  { id: true },
  });
  if (fallback) fallbackIncomeAccountId = fallback.id;

  return lines.map((l) => {
    const gross = l.quantity * l.rate;

    const disc =
      l.discountType === "FIXED"
        ? Math.min(Math.max(0, l.discountValue), gross)
        : (gross * Math.min(Math.max(0, l.discountValue), 100)) / 100;

    const taxable = gross - disc;

    const taxInfo = taxRateMap.get(l.taxRateId?.trim() || "") ?? null;
    const taxRate = taxInfo?.rate ?? 0;
    const taxAmt  = Math.round(taxable * taxRate / 100 * 100) / 100;

    // Resolve income account:
    //   - Explicit validated id → use it
    //   - Empty/missing → apply fallback chain
    const suppliedId = l.incomeAccountId?.trim() || "";
    const resolvedIncomeId = suppliedId
      ? incomeAccountMap.get(suppliedId) ?? null   // already validated above; null = shouldn't happen
      : fallbackIncomeAccountId;

    return {
      itemId:          l.itemId || null,
      description:     l.description,
      quantity:        l.quantity,
      rate:            l.rate,
      amount:          gross,
      taxRateId:       taxInfo ? (l.taxRateId?.trim() || null) : null,
      taxName:         taxInfo?.name ?? null,
      taxRate,
      taxAmount:       taxAmt,
      discountType:    l.discountType,
      discountValue:   l.discountValue,
      discountAmount:  Math.round(disc * 100) / 100,
      lineTotal:       Math.round((taxable + taxAmt) * 100) / 100,
      incomeAccountId: resolvedIncomeId,
    };
  });
}

interface Totals {
  subtotal:          number;
  lineDiscountTotal: number;
  taxAmount:         number;
  totalAmount:       number;
}

/** Compute invoice header totals from resolved lines + optional invoice-level discount. */
function computeTotals(resolved: ResolvedLine[], invoiceDiscount: number): Totals {
  const subtotal          = resolved.reduce((s, l) => s + l.amount, 0);
  const lineDiscountTotal = resolved.reduce((s, l) => s + l.discountAmount, 0);
  const taxAmount         = resolved.reduce((s, l) => s + l.taxAmount, 0);
  const maxDiscount       = Math.max(0, subtotal - lineDiscountTotal);
  const clampedDiscount   = Math.min(Math.max(0, invoiceDiscount), maxDiscount);
  const totalAmount       = subtotal - lineDiscountTotal - clampedDiscount + taxAmount;
  return { subtotal, lineDiscountTotal, taxAmount, totalAmount };
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
  const fxRate = data.exchangeRate || 1;

  // Validate customer belongs to tenant
  const customer = await prisma.customer.findFirst({
    where: { id: data.customerId, tenantId: orgId },
    select: { id: true },
  });
  if (!customer) return { error: "Customer not found" };

  // Resolve lines server-side (validates taxRateIds, snapshots names, computes amounts)
  const resolved = await resolveLines(orgId, data.lines);
  const { subtotal, taxAmount, totalAmount } = computeTotals(resolved, data.discountAmount);

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
          exchangeRate:     fxRate,
          subtotal,
          discountAmount:   data.discountAmount,
          taxAmount,
          totalAmount,
          amountPaid:       0,
          balanceDue:       totalAmount,
          recognitionPeriod: data.recognitionPeriod,
          notes:            data.notes || null,
          lines: {
            create: resolved.map((l) => ({
              itemId:          l.itemId,
              description:     l.description,
              quantity:        l.quantity,
              rate:            l.rate,
              amount:          l.amount,
              taxRateId:       l.taxRateId,
              taxName:         l.taxName,
              taxRate:         l.taxRate,
              taxAmount:       l.taxAmount,
              discountType:    l.discountType,
              discountValue:   l.discountValue,
              discountAmount:  l.discountAmount,
              lineTotal:       l.lineTotal,
              incomeAccountId: l.incomeAccountId,
            })),
          },
        },
      });
    });

    // NOTE: No journal posting on draft creation.
    // AR/Revenue is posted only when the invoice is marked as Sent (sendInvoice).

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
  const orgId   = session?.user?.tenantId;
  const userId  = session?.user?.id;
  if (!orgId || !userId) return { error: "Unauthorized" };

  const sentAt = dateSent ? new Date(dateSent) : new Date();

  const result = await postInvoiceAndMarkSent({
    tenantId:  orgId,
    invoiceId: id,
    userId,
    sentAt,
    sendEmail: true,
  });
  if ("error" in result) return result;

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
  const fxRate = data.exchangeRate || 1;

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

    // Resolve lines server-side before the transaction
    const resolved = await resolveLines(orgId, data.lines);
    const { subtotal, taxAmount, totalAmount } = computeTotals(resolved, data.discountAmount);

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
          exchangeRate:      fxRate,
          subtotal,
          discountAmount:    data.discountAmount,
          taxAmount,
          totalAmount,
          balanceDue:        totalAmount, // DRAFT has no payments
          recognitionPeriod: data.recognitionPeriod,
          notes:             data.notes || null,
          lines: {
            create: resolved.map((l) => ({
              itemId:          l.itemId,
              description:     l.description,
              quantity:        l.quantity,
              rate:            l.rate,
              amount:          l.amount,
              taxRateId:       l.taxRateId,
              taxName:         l.taxName,
              taxRate:         l.taxRate,
              taxAmount:       l.taxAmount,
              discountType:    l.discountType,
              discountValue:   l.discountValue,
              discountAmount:  l.discountAmount,
              lineTotal:       l.lineTotal,
              incomeAccountId: l.incomeAccountId,
            })),
          },
        },
      });
    });

    // NOTE: No journal reversal/repost on draft edit.
    // The draft has not been posted yet; there is nothing to reverse.
    // AR/Revenue will be posted when the invoice is marked as Sent.

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

  // Void the invoice
  await prisma.invoice.update({
    where: { id },
    data: { status: "VOIDED", voidedAt: new Date(), voidedReason: reason },
  });

  // Post reversal journal only if the invoice was already posted (i.e., not DRAFT).
  // A DRAFT invoice has never had AR/Revenue posted, so there is nothing to reverse.
  if (invoice.status !== "DRAFT") {
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
  }

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
            itemId:          l.itemId,
            description:     l.description,
            quantity:        l.quantity,
            rate:            l.rate,
            amount:          l.amount,
            taxRateId:       l.taxRateId,
            taxName:         l.taxName,
            taxRate:         l.taxRate,
            taxAmount:       l.taxAmount,
            discountType:    l.discountType,
            discountValue:   l.discountValue,
            discountAmount:  l.discountAmount,
            lineTotal:       l.lineTotal,
            incomeAccountId: l.incomeAccountId,
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
    const result = await postInvoiceAndMarkSent({
      tenantId:  orgId,
      invoiceId: id,
      userId,
      sentAt:    new Date(),
      sendEmail: false,   // bulk posting does not send individual emails
    });
    if ("error" in result) {
      // "not found" and "already sent" are silent skips; everything else is an error
      if (
        result.error === "Invoice not found" ||
        result.error.startsWith("Invoice is already")
      ) {
        skipped++;
      } else {
        errors.push({ id, error: result.error });
      }
    } else {
      posted++;
    }
  }

  revalidatePath("/sales/invoices");
  return { posted, skipped, errors };
}

export async function bulkDeleteInvoices(ids: string[]) {
  const session = await auth();
  const orgId   = session?.user?.tenantId;
  if (!orgId) return { error: "Unauthorized" };
  if (ids.length === 0) return { deleted: 0, skipped: 0 };

  // Fetch all requested invoices that belong to this tenant
  const invoices = await prisma.invoice.findMany({
    where:  { id: { in: ids }, tenantId: orgId },
    select: { id: true, status: true },
  });

  const draftIds   = invoices.filter((i) => i.status === "DRAFT").map((i) => i.id);
  const skipped    = ids.length - draftIds.length;

  if (draftIds.length === 0) return { deleted: 0, skipped };

  // Delete lines first (FK constraint), then invoices — all in one transaction
  await prisma.$transaction(async (tx) => {
    await tx.invoiceLine.deleteMany({ where: { invoiceId: { in: draftIds } } });
    await tx.invoice.deleteMany({ where: { id: { in: draftIds } } });
  });

  revalidatePath("/sales/invoices");
  return { deleted: draftIds.length, skipped };
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
