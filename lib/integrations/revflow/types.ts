/**
 * Revflow Common Data Model (CDM) — Zod schemas + inferred TypeScript types.
 *
 * Field names match what Revflow's REST API returns verbatim.
 * All monetary fields are plain numbers (NGN base, converted at processor level).
 * Dates are ISO strings; the processor converts them to Date objects.
 */
import { z } from "zod";

// ─── Paginated response wrapper ───────────────────────────────────────────────

export const RFPagedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    data:    z.array(itemSchema),
    total:   z.number(),
    page:    z.number(),
    limit:   z.number(),
    hasMore: z.boolean(),
  });

// ─── Chart of Accounts ────────────────────────────────────────────────────────
// Synced first to validate account mappings exist.

export const RFChartOfAccountSchema = z.object({
  code: z.string(),
  name: z.string(),
  type: z.enum(["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"]),
});
export type RFChartOfAccount = z.infer<typeof RFChartOfAccountSchema>;
export const RFCoAResponseSchema = z.array(RFChartOfAccountSchema);

// ─── Campaign ─────────────────────────────────────────────────────────────────

export const RFCampaignSchema = z.object({
  id:                   z.string(),
  name:                 z.string(),
  clientId:             z.string(),
  clientName:           z.string(),
  campaignCode:         z.string().nullable().optional(),
  plannedValue:         z.number(),
  currency:             z.string().default("NGN"),
  exchangeRate:         z.number().default(1),
  startDate:            z.string().nullable().optional(),   // ISO date
  endDate:              z.string().nullable().optional(),
  status:               z.string().nullable().optional(),
  revenueSplit:         z.record(z.string(), z.number()).nullable().optional(), // YYYY-MM → amount
  compliancePercentage: z.number().min(0).max(100).nullable().optional(),
  updatedAt:            z.string(),
});
export type RFCampaign = z.infer<typeof RFCampaignSchema>;
export const RFCampaignPageSchema = RFPagedResponseSchema(RFCampaignSchema);

// ─── Invoice ──────────────────────────────────────────────────────────────────

export const RFInvoiceStatusSchema = z.enum([
  "DRAFT", "SENT", "PARTIAL", "PAID", "OVERDUE", "VOID", "WRITTEN_OFF",
]);
export type RFInvoiceStatus = z.infer<typeof RFInvoiceStatusSchema>;

export const RFInvoiceSchema = z.object({
  id:                z.string(),
  campaignId:        z.string().nullable().optional(),
  invoiceNumber:     z.string(),
  clientId:          z.string(),
  clientName:        z.string(),
  issueDate:         z.string(),             // ISO date
  dueDate:           z.string().nullable().optional(),
  recognitionPeriod: z.string(),             // YYYY-MM — IFRS 15, always set by Revflow
  currency:          z.string().default("NGN"),
  exchangeRate:      z.number().default(1),
  amountBeforeVat:   z.number(),             // subtotal (net of VAT)
  vatAmount:         z.number().default(0),
  totalAmount:       z.number(),
  paidAmount:        z.number().default(0),
  revenueAccountCode: z.string().nullable().optional(), // overrides IN-001 if set
  status:            RFInvoiceStatusSchema,
  updatedAt:         z.string(),
});
export type RFInvoice = z.infer<typeof RFInvoiceSchema>;
export const RFInvoicePageSchema = RFPagedResponseSchema(RFInvoiceSchema);

// ─── Payment ──────────────────────────────────────────────────────────────────

export const RFPaymentMethodSchema = z.enum([
  "bank_transfer", "cheque", "cash", "card",
]);
export type RFPaymentMethod = z.infer<typeof RFPaymentMethodSchema>;

export const RFPaymentSchema = z.object({
  id:              z.string(),
  invoiceId:       z.string(),
  paymentDate:     z.string(),              // ISO date
  amount:          z.number(),             // gross received (before WHT)
  whtDeducted:     z.number().default(0),  // WHT deducted by client at source
  method:          RFPaymentMethodSchema.default("bank_transfer"),
  reference:       z.string().nullable().optional(),
  bankAccountCode: z.string().nullable().optional(),
  updatedAt:       z.string(),
});
export type RFPayment = z.infer<typeof RFPaymentSchema>;
export const RFPaymentPageSchema = RFPagedResponseSchema(RFPaymentSchema);

// ─── Journal Entry (synced from Revflow GL) ───────────────────────────────────

export const RFJournalEntryTypeSchema = z.enum([
  "INVOICE", "PAYMENT", "WHT", "WRITEOFF", "ACCRUAL", "REVERSAL", "ADJUSTMENT",
]);
export type RFJournalEntryType = z.infer<typeof RFJournalEntryTypeSchema>;

export const RFJournalLineSchema = z.object({
  accountCode:  z.string(),
  description:  z.string().optional(),
  debit:        z.number().default(0),
  credit:       z.number().default(0),
});
export type RFJournalLine = z.infer<typeof RFJournalLineSchema>;

export const RFJournalEntrySchema = z.object({
  id:                z.string(),
  entryType:         RFJournalEntryTypeSchema,
  recognitionPeriod: z.string(),            // YYYY-MM
  clientId:          z.string().nullable().optional(),
  campaignId:        z.string().nullable().optional(),
  sourceRef:         z.string().nullable().optional(), // invoice / payment ID
  lines:             z.array(RFJournalLineSchema),
  updatedAt:         z.string(),
});
export type RFJournalEntry = z.infer<typeof RFJournalEntrySchema>;
export const RFJournalEntryPageSchema = RFPagedResponseSchema(RFJournalEntrySchema);

// ─── Sync cursor ──────────────────────────────────────────────────────────────

export interface RFSyncCursor {
  since: string; // ISO datetime
}

export function parseRFCursor(raw: string | undefined | null): RFSyncCursor {
  if (!raw) return { since: "1970-01-01T00:00:00.000Z" };
  try {
    return JSON.parse(raw) as RFSyncCursor;
  } catch {
    return { since: raw }; // backwards compat: plain ISO string
  }
}

export function stringifyRFCursor(cursor: RFSyncCursor): string {
  return JSON.stringify(cursor);
}
