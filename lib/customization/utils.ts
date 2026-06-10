/**
 * Pure client-safe helpers for transaction number series.
 * No server-side imports — safe to use in "use client" components.
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

export type TransactionNumberSeriesRow = {
  id:            string;
  module:        string;
  prefix:        string;
  nextNumber:    number;
  padLength:     number;
  restartFreq:   string;
  lastResetDate: Date | null;
  isEnabled:     boolean;
  updatedAt:     Date;
};

// ─── Display labels ────────────────────────────────────────────────────────────

const MODULE_DISPLAY: Record<string, string> = {
  INVOICE:          "Invoice",
  CUSTOMER_PAYMENT: "Customer Payment",
  CREDIT_NOTE:      "Credit Note",
  BILL:             "Bill",
  VENDOR_PAYMENT:   "Vendor Payment",
  JOURNAL:          "Journal Entry",
  ESTIMATE:         "Estimate",
  PURCHASE_ORDER:   "Purchase Order",
  VENDOR_CREDIT:    "Vendor Credit",
  DEBIT_NOTE:       "Debit Note",
};

export function moduleDisplayLabel(module: string): string {
  return MODULE_DISPLAY[module] ?? module;
}

// Display order for the settings UI (Sales → Purchases → Accounting)
export const MODULE_DISPLAY_ORDER: string[] = [
  "INVOICE",
  "ESTIMATE",
  "CREDIT_NOTE",
  "CUSTOMER_PAYMENT",
  "PURCHASE_ORDER",
  "BILL",
  "VENDOR_CREDIT",
  "VENDOR_PAYMENT",
  "DEBIT_NOTE",
  "JOURNAL",
];

export const MODULE_GROUPS: { label: string; modules: string[] }[] = [
  { label: "Sales",      modules: ["INVOICE", "ESTIMATE", "CREDIT_NOTE", "CUSTOMER_PAYMENT"]                  },
  { label: "Purchases",  modules: ["PURCHASE_ORDER", "BILL", "VENDOR_CREDIT", "VENDOR_PAYMENT", "DEBIT_NOTE"] },
  { label: "Accounting", modules: ["JOURNAL"]                                                                  },
];

// ─── Pure format helper ───────────────────────────────────────────────────────

/**
 * Returns the formatted number string for a given series state.
 * Pure function — no DB access, no side effects.
 */
export function previewTransactionNumber(series: {
  prefix:     string;
  nextNumber: number;
  padLength:  number;
}): string {
  const padded = String(series.nextNumber).padStart(series.padLength, "0");
  return series.prefix ? `${series.prefix}-${padded}` : padded;
}
