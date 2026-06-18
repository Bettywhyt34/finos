/**
 * Shared invoice posting service.
 *
 * Single source of truth for marking an invoice as SENT and posting the
 * corresponding AR/Revenue journal entry.
 *
 * Used by:
 *   - sendInvoice()         — single invoice from UI (Mark as Sent modal)
 *   - postInvoicesToLedger() — bulk posting action
 *
 * Key rules (from FINOS invoice lifecycle):
 *   - Only DRAFT invoices can be posted. Any other status is rejected.
 *   - Journal entry date  = invoice.issueDate  (accounting/revenue date).
 *   - sentAt              = user-selected sent date (operational/customer date).
 *   - Duplicate prevention: checks for an existing JournalEntry with
 *     sourceId = invoiceId AND source = "invoice" before posting.
 *   - Ledger posting is NOT fire-and-forget: failure returns an error and
 *     the invoice status is NOT changed.
 *   - Email IS fire-and-forget: failure is logged but does not block the response.
 */

import { prisma }          from "@/lib/prisma";
import { postJournalEntry } from "@/lib/journal";
import { toNGN }            from "@/lib/utils";
import { sendInvoiceEmail } from "@/lib/email-notifications/senders/invoice-sent";

export interface PostInvoiceOptions {
  tenantId:   string;
  invoiceId:  string;
  userId:     string;
  /** The operational sent date chosen by the user. Capped to now if in the future. */
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

  // Cap sentAt to now — future dates are not allowed
  const now    = new Date();
  const sentAt = opts.sentAt > now ? now : opts.sentAt;

  // Fetch invoice (tenant-scoped)
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
  });
  if (!invoice) return { error: "Invoice not found" };

  // Guard: only DRAFT invoices can be marked as sent
  if (invoice.status !== "DRAFT") {
    return {
      error: `Invoice is already ${invoice.status}. Only DRAFT invoices can be marked as sent.`,
    };
  }

  // Compute NGN amount for journal posting
  const rate     = parseFloat(String(invoice.exchangeRate));
  const totalNGN = toNGN(parseFloat(String(invoice.totalAmount)), rate);
  const fxNote   = rate !== 1 ? ` (${invoice.currency} @ ${rate})` : "";

  // Duplicate journal prevention
  const existingJE = await prisma.journalEntry.findFirst({
    where:  { tenantId, sourceId: invoiceId, source: "invoice" },
    select: { id: true },
  });

  try {
    // 1. Post AR / Revenue journal (NOT fire-and-forget)
    //    Accounting date = invoice.issueDate, NOT sentAt.
    //    sentAt is the operational date; issueDate is the revenue recognition date.
    if (!existingJE) {
      await postJournalEntry({
        tenantId,
        createdBy:         userId,
        entryDate:         invoice.issueDate,          // ← accounting/revenue date
        reference:         invoice.invoiceNumber,
        description:       `Invoice ${invoice.invoiceNumber}${fxNote}`,
        recognitionPeriod: invoice.recognitionPeriod,
        source:            "invoice",
        sourceId:          invoiceId,
        lines: [
          {
            accountCode: "CA-001",
            description: `AR - ${invoice.invoiceNumber}${fxNote}`,
            debit:       totalNGN,
            credit:      0,
          },
          {
            accountCode: "IN-001",
            description: `Revenue - ${invoice.invoiceNumber}${fxNote}`,
            debit:       0,
            credit:      totalNGN,
          },
        ],
      });
    }

    // 2. Mark invoice as SENT with the user-selected sentAt
    await prisma.invoice.update({
      where: { id: invoiceId, tenantId },
      data:  { status: "SENT", sentAt },
    });
  } catch (e: unknown) {
    return {
      error: e instanceof Error
        ? e.message
        : "Failed to post invoice. Invoice status was not changed.",
    };
  }

  // 3. Fire-and-forget email — only after journal + status succeed
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
