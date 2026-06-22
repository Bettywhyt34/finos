/**
 * Shared invoice posting service.
 *
 * Single source of truth for marking an invoice as SENT and posting the
 * corresponding AR / Revenue / VAT journal entry.
 *
 * Used by:
 *   - sendInvoice()          — single invoice from UI (Mark as Sent modal)
 *   - postInvoicesToLedger() — bulk posting action
 *
 * Posting rules:
 *   - Only DRAFT invoices can be marked as sent.
 *   - Journal entry date  = invoice.issueDate  (accounting/revenue date).
 *   - sentAt              = user-selected sent date (operational/customer date).
 *   - Journal structure:
 *       DR  CA-001 (Accounts Receivable)  = invoice total (NGN)
 *       CR  [incomeAccountId per group]   = net revenue per income account (NGN)
 *       CR  CL-OUTPUT-VAT (if tax > 0)   = total VAT / tax payable (NGN)
 *   - Invoice-level additional discount allocated proportionally across income groups.
 *   - sentAt must be today or in the past; future dates are rejected with a clear error.
 *   - Duplicate prevention: pre-transaction fast-fail + definitive check inside the
 *     $transaction (catches concurrent "Mark as Sent" requests).
 *   - Inside the $transaction: re-checks invoice status, checks for duplicate journal,
 *     generates entry number, creates journal entry, updates invoice with status=DRAFT guard.
 *   - Journal creation + invoice status update run inside one prisma.$transaction.
 *     If either fails the other is rolled back; invoice status is NOT changed.
 *   - Email is fire-and-forget; fired only after a successful transaction.
 *
 * TODO: When TaxRate gains a linked payable account, route each tax type to its
 *       own liability account instead of consolidating all tax to CL-OUTPUT-VAT.
 */

import { prisma }           from "@/lib/prisma";
import { toNGN }            from "@/lib/utils";
import { sendInvoiceEmail } from "@/lib/email-notifications/senders/invoice-sent";
import { COA_AR_CODE, COA_OUTPUT_VAT_CODE } from "@/lib/constants";

export interface PostInvoiceOptions {
  tenantId:   string;
  invoiceId:  string;
  userId:     string;
  /** The operational sent date chosen by the user. Must be today or in the past; future dates are rejected. */
  sentAt:     Date;
  /**
   * Whether to fire the invoice-sent email after successful posting.
   * Defaults to true. Pass false for bulk/silent operations.
   */
  sendEmail?: boolean;
}

export async function postInvoiceAndMarkSent(
  opts: PostInvoiceOptions,
): Promise<{ success: true } | { error: string }> {
  const { tenantId, invoiceId, userId, sendEmail = true } = opts;

  // Reject future sent dates — sentAt is an audit field and must not be silently corrected.
  // Today (any time today) is allowed; tomorrow or later is rejected.
  const now = new Date();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  if (opts.sentAt > todayEnd) {
    return { error: "Sent date cannot be in the future. Please select today or a past date." };
  }
  const sentAt = opts.sentAt;

  // ── 1. Fetch invoice with lines ─────────────────────────────────────────────
  const invoice = await prisma.invoice.findFirst({
    where:   { id: invoiceId, tenantId },
    include: {
      lines: {
        select: {
          id:              true,
          amount:          true,   // gross = qty × rate (document currency)
          discountAmount:  true,   // line-level discount (document currency)
          taxAmount:       true,   // line-level tax (document currency)
          incomeAccountId: true,
        },
      },
    },
  });

  if (!invoice) return { error: "Invoice not found" };

  // ── 2. Guard: only DRAFT invoices may be posted ─────────────────────────────
  if (invoice.status !== "DRAFT") {
    return {
      error: `Invoice is already ${invoice.status}. Only DRAFT invoices can be marked as sent.`,
    };
  }

  if (invoice.lines.length === 0) {
    return { error: "Invoice has no line items. Add at least one line before marking as sent." };
  }

  // ── 3. Validate income accounts on every line ────────────────────────────────
  const missingLine = invoice.lines.find((l) => !l.incomeAccountId);
  if (missingLine) {
    return {
      error:
        "One or more invoice lines are missing an income account. " +
        "Edit the invoice and assign an income account to every line.",
    };
  }

  const incomeAccountIds = Array.from(new Set(invoice.lines.map((l) => l.incomeAccountId!)));
  const validIncomeAccounts = await prisma.chartOfAccounts.findMany({
    where:  { id: { in: incomeAccountIds }, tenantId, type: "INCOME", isActive: true },
    select: { id: true },
  });
  const validIncomeSet = new Set(validIncomeAccounts.map((a) => a.id));
  const invalidIds = incomeAccountIds.filter((id) => !validIncomeSet.has(id));
  if (invalidIds.length > 0) {
    return {
      error:
        "One or more income accounts on this invoice are inactive or do not belong to this organisation. " +
        "Edit the invoice to reselect valid income accounts.",
    };
  }

  // ── 4. Currency / NGN amounts ────────────────────────────────────────────────
  const rate               = parseFloat(String(invoice.exchangeRate));
  const totalAmountNGN     = toNGN(parseFloat(String(invoice.totalAmount)),    rate);
  const taxAmountNGN       = toNGN(parseFloat(String(invoice.taxAmount)),      rate);
  const invoiceDiscountNGN = toNGN(parseFloat(String(invoice.discountAmount)), rate);

  // ── 5. Resolve posting accounts ──────────────────────────────────────────────
  const arAccount = await prisma.chartOfAccounts.findFirst({
    where:  { tenantId, code: COA_AR_CODE, isActive: true },
    select: { id: true },
  });
  if (!arAccount) {
    return {
      error:
        `Accounts Receivable account (${COA_AR_CODE}) not found or inactive. ` +
        `Run the Chart of Accounts baseline migration.`,
    };
  }

  let vatAccountId: string | null = null;
  if (taxAmountNGN > 0.001) {
    const vatAccount = await prisma.chartOfAccounts.findFirst({
      where:  { tenantId, code: COA_OUTPUT_VAT_CODE, isActive: true },
      select: { id: true },
    });
    if (!vatAccount) {
      return {
        error:
          `Output VAT account (${COA_OUTPUT_VAT_CODE}) not found or inactive. ` +
          `Run the Chart of Accounts baseline migration.`,
      };
    }
    vatAccountId = vatAccount.id;
  }

  // ── 6. Duplicate journal prevention (pre-transaction fast-fail) ─────────────
  // This is a quick read-outside-transaction to fail early without acquiring a TX.
  // The definitive guard is repeated INSIDE the $transaction below.
  const existingJE = await prisma.journalEntry.findFirst({
    where:  { tenantId, sourceId: invoiceId, source: "invoice" },
    select: { id: true },
  });
  if (existingJE) {
    return {
      error:
        "A journal entry already exists for this invoice. " +
        "Duplicate posting prevented. If the invoice status appears incorrect, contact support.",
    };
  }

  // ── 7. Compute revenue per income account group ──────────────────────────────
  // Net revenue per line = gross (amount) − line discount (discountAmount).
  // Lines sharing the same incomeAccountId are summed into one journal credit.
  const revenueByAccount = new Map<string, number>(); // accountId → NGN
  for (const line of invoice.lines) {
    const gross    = parseFloat(String(line.amount));
    const lineDisc = parseFloat(String(line.discountAmount));
    const netNGN   = toNGN(gross - lineDisc, rate);
    const accId    = line.incomeAccountId!;
    revenueByAccount.set(
      accId,
      Math.round(((revenueByAccount.get(accId) ?? 0) + netNGN) * 100) / 100,
    );
  }

  // ── 8. Allocate invoice-level additional discount proportionally ─────────────
  // Example: Group A = ₦700k, Group B = ₦300k, invoice discount = ₦100k
  //          A reduction = 100k × (700k / 1000k) = ₦70k  →  A final = ₦630k
  //          B reduction = 100k × (300k / 1000k) = ₦30k  →  B final = ₦270k
  if (invoiceDiscountNGN > 0.001) {
    const totalPreDisc = Array.from(revenueByAccount.values()).reduce((s, v) => s + v, 0);
    if (totalPreDisc > 0) {
      for (const [accId, amount] of Array.from(revenueByAccount.entries())) {
        const reduction = Math.round(invoiceDiscountNGN * (amount / totalPreDisc) * 100) / 100;
        revenueByAccount.set(accId, Math.round((amount - reduction) * 100) / 100);
      }
    }
  }

  // ── 9. Rounding adjustment ───────────────────────────────────────────────────
  // Target invariant: sumRevenue + taxAmountNGN == totalAmountNGN
  // Per-line toNGN() rounds to 2 decimal places; the aggregated sum may deviate
  // from the invoice header total by a few kobo. Correct on the largest group.
  const sumRevenue      = Array.from(revenueByAccount.values()).reduce((s, v) => s + v, 0);
  const expectedRevenue = Math.round((totalAmountNGN - taxAmountNGN) * 100) / 100;
  const diff            = Math.round((expectedRevenue - sumRevenue) * 100) / 100;

  if (Math.abs(diff) > 1.00) {
    // More than ₦1 imbalance is a data error, not rounding noise.
    return {
      error:
        `Journal rounding imbalance exceeds tolerance (${diff} NGN). ` +
        `This may indicate a data inconsistency. Please contact support.`,
    };
  }

  if (diff !== 0) {
    let largestAccId = "";
    let largestAmt   = -Infinity;
    for (const [accId, amount] of Array.from(revenueByAccount.entries())) {
      if (amount > largestAmt) { largestAmt = amount; largestAccId = accId; }
    }
    if (largestAccId) {
      revenueByAccount.set(largestAccId, Math.round((largestAmt + diff) * 100) / 100);
    }
  }

  // ── 10. Build journal lines ──────────────────────────────────────────────────
  const fxNote = rate !== 1 ? ` (${invoice.currency} @ ${rate})` : "";
  type JELine  = { accountId: string; description: string; debit: number; credit: number };
  const journalLines: JELine[] = [];

  // DR — Accounts Receivable
  journalLines.push({
    accountId:   arAccount.id,
    description: `AR - ${invoice.invoiceNumber}${fxNote}`,
    debit:       totalAmountNGN,
    credit:      0,
  });

  // CR — Revenue (one credit line per income account group)
  for (const [accId, amount] of Array.from(revenueByAccount.entries())) {
    if (amount > 0) {
      journalLines.push({
        accountId:   accId,
        description: `Revenue - ${invoice.invoiceNumber}${fxNote}`,
        debit:       0,
        credit:      amount,
      });
    }
  }

  // CR — Output VAT / Tax Payable
  // TODO: Future: support tax-rate-level payable accounts so VAT, WHT, and other
  //       taxes each post to their own liability account instead of CL-OUTPUT-VAT.
  if (taxAmountNGN > 0.001 && vatAccountId) {
    journalLines.push({
      accountId:   vatAccountId,
      description: `Output VAT - ${invoice.invoiceNumber}${fxNote}`,
      debit:       0,
      credit:      taxAmountNGN,
    });
  }

  // ── 11. Final balance sanity check ───────────────────────────────────────────
  const totalDebits  = Math.round(journalLines.reduce((s, l) => s + l.debit,  0) * 100) / 100;
  const totalCredits = Math.round(journalLines.reduce((s, l) => s + l.credit, 0) * 100) / 100;
  if (Math.abs(totalDebits - totalCredits) > 0.005) {
    return {
      error:
        `Journal entry does not balance (DR=${totalDebits}, CR=${totalCredits}). ` +
        `Please contact support.`,
    };
  }

  // ── 12. Accounting period open check ────────────────────────────────────────
  const periodRow = await prisma.accountingPeriod.findUnique({
    where:  { tenantId_period: { tenantId, period: invoice.recognitionPeriod } },
    select: { isClosed: true },
  });
  if (periodRow?.isClosed) {
    return {
      error: `Accounting period ${invoice.recognitionPeriod} is closed. Reopen it before posting.`,
    };
  }

  // ── 13. Atomic transaction: post journal + mark invoice SENT ─────────────────
  // All four steps run in one $transaction so a failure in any step rolls back all.
  try {
    await prisma.$transaction(async (tx) => {

      // ── Concurrency guards (definitive, inside transaction) ──────────────────
      // Re-check invoice status and duplicate journal under transaction isolation.
      // Catches a second concurrent "Mark as Sent" that passed the pre-TX fast-fail.

      const liveInvoice = await tx.invoice.findFirst({
        where:  { id: invoiceId, tenantId },
        select: { status: true },
      });
      if (!liveInvoice) {
        throw new Error("Invoice not found.");
      }
      if (liveInvoice.status !== "DRAFT") {
        throw new Error(
          `Invoice is already ${liveInvoice.status}. ` +
          `Another request may have posted it concurrently.`,
        );
      }

      const duplicateJE = await tx.journalEntry.findFirst({
        where:  { tenantId, sourceId: invoiceId, source: "invoice" },
        select: { id: true },
      });
      if (duplicateJE) {
        throw new Error(
          "A journal entry already exists for this invoice. " +
          "Concurrent duplicate posting prevented.",
        );
      }

      // ── Entry number (generated inside TX for consistent snapshot) ───────────
      const jeCount     = await tx.journalEntry.count({ where: { tenantId } });
      const entryNumber = `JE-${String(jeCount + 1).padStart(5, "0")}`;

      // ── Create journal entry header + lines ──────────────────────────────────
      // Uses JournalEntryLine (debit/credit model) — consistent with legacy posting.
      await tx.journalEntry.create({
        data: {
          tenantId,
          entryNumber,
          entryDate:         invoice.issueDate,         // accounting date = invoice issue date
          reference:         invoice.invoiceNumber,
          description:       `Invoice ${invoice.invoiceNumber}${fxNote}`,
          recognitionPeriod: invoice.recognitionPeriod,
          source:            "invoice",
          sourceId:          invoiceId,
          createdBy:         userId,
          isLocked:          true,
          lines: { create: journalLines },
        },
      });

      // ── Mark invoice SENT — status=DRAFT guard in WHERE ───────────────────────
      // updateMany returns a count; if 0 the invoice status changed after our
      // re-check (extremely rare race) and we roll back the entire transaction.
      const updated = await tx.invoice.updateMany({
        where: { id: invoiceId, tenantId, status: "DRAFT" },
        data:  { status: "SENT", sentAt },
      });
      if (updated.count === 0) {
        throw new Error(
          "Invoice status changed before the update could complete. Transaction rolled back.",
        );
      }
    });
  } catch (e: unknown) {
    return {
      error: e instanceof Error
        ? e.message
        : "Failed to post invoice. Invoice status was not changed.",
    };
  }

  // ── 15. Fire-and-forget email — only after transaction succeeds ───────────────
  if (sendEmail) {
    void sendInvoiceEmail({ tenantId, invoiceId })
      .then((result) => {
        if (!result.sent) {
          console.warn(
            `[INVOICE_SENT] Email not sent for invoice ${invoiceId}: ${result.reason}`,
          );
        }
      })
      .catch((err: unknown) => {
        console.error(
          `[INVOICE_SENT] Unexpected error sending email for invoice ${invoiceId}:`,
          err,
        );
      });
  }

  return { success: true };
}
