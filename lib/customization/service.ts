/**
 * Customization service — Transaction Number Series.
 *
 * Provides helpers for reading, updating, previewing, and generating
 * sequential transaction numbers per module per tenant.
 *
 * All functions are tenant-scoped; every write verifies tenantId ownership.
 */

import { prisma } from "@/lib/prisma";

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
  { label: "Sales",      modules: ["INVOICE", "ESTIMATE", "CREDIT_NOTE", "CUSTOMER_PAYMENT"] },
  { label: "Purchases",  modules: ["PURCHASE_ORDER", "BILL", "VENDOR_CREDIT", "VENDOR_PAYMENT", "DEBIT_NOTE"] },
  { label: "Accounting", modules: ["JOURNAL"] },
];

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

export type UpdateTransactionNumberSeriesInput = {
  prefix?:      string;
  nextNumber?:  number;
  padLength?:   number;
  restartFreq?: string;
  isEnabled?:   boolean;
};

// ─── Pure helpers ──────────────────────────────────────────────────────────────

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

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getTransactionNumberSeries(
  tenantId: string,
): Promise<TransactionNumberSeriesRow[]> {
  const rows = await prisma.transactionNumberSeries.findMany({
    where:   { tenantId },
    orderBy: { module: "asc" },
  });

  return rows.map(rowToPublic);
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function updateTransactionNumberSeries(
  tenantId: string,
  seriesId: string,
  data: UpdateTransactionNumberSeriesInput,
): Promise<TransactionNumberSeriesRow> {
  // Verify ownership
  const existing = await prisma.transactionNumberSeries.findFirst({
    where: { id: seriesId, tenantId },
  });
  if (!existing) throw new Error("Series not found.");

  if (data.nextNumber !== undefined && data.nextNumber < 1) {
    throw new Error("Next number must be at least 1.");
  }
  if (data.padLength !== undefined && (data.padLength < 1 || data.padLength > 10)) {
    throw new Error("Pad length must be between 1 and 10.");
  }

  const updated = await prisma.transactionNumberSeries.update({
    where: { id: seriesId },
    data: {
      ...(data.prefix      !== undefined ? { prefix:      data.prefix.trim()                                   } : {}),
      ...(data.nextNumber  !== undefined ? { nextNumber:  data.nextNumber                                      } : {}),
      ...(data.padLength   !== undefined ? { padLength:   data.padLength                                       } : {}),
      ...(data.restartFreq !== undefined ? { restartFreq: data.restartFreq as "NEVER" | "MONTHLY" | "YEARLY"  } : {}),
      ...(data.isEnabled   !== undefined ? { isEnabled:   data.isEnabled                                       } : {}),
    },
  });

  return rowToPublic(updated);
}

// ─── Number generation ────────────────────────────────────────────────────────

/**
 * Atomically generates the next number for a module, incrementing nextNumber.
 * Uses a Prisma transaction to prevent race conditions.
 *
 * For use from transaction creation flows (invoice, bill, etc.).
 */
export async function generateTransactionNumber(
  tenantId: string,
  module:   string,
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const series = await tx.transactionNumberSeries.findFirst({
      where: { tenantId, module: module as "INVOICE" | "CUSTOMER_PAYMENT" | "CREDIT_NOTE" | "BILL" | "VENDOR_PAYMENT" | "JOURNAL" | "ESTIMATE" | "PURCHASE_ORDER" | "VENDOR_CREDIT" | "DEBIT_NOTE" },
    });
    if (!series)           throw new Error(`No number series configured for module: ${module}`);
    if (!series.isEnabled) throw new Error(`Number series is disabled for module: ${module}`);

    const number = previewTransactionNumber(series);

    await tx.transactionNumberSeries.update({
      where: { id: series.id },
      data:  { nextNumber: series.nextNumber + 1 },
    });

    return number;
  });
}

/**
 * Same as generateTransactionNumber but accepts an existing Prisma transaction
 * client so it can participate in a larger atomic operation.
 *
 * Usage:
 *   await prisma.$transaction(async (tx) => {
 *     const num = await reserveTransactionNumber(tenantId, "INVOICE", tx);
 *     await tx.invoice.create({ data: { invoiceNumber: num, ... } });
 *   });
 */
export async function reserveTransactionNumber(
  tenantId: string,
  module:   string,
  tx:       { transactionNumberSeries: { findFirst: Function; update: Function } },
): Promise<string> {
  const series = await (tx as any).transactionNumberSeries.findFirst({
    where: { tenantId, module },
  });
  if (!series)           throw new Error(`No number series configured for module: ${module}`);
  if (!series.isEnabled) throw new Error(`Number series is disabled for module: ${module}`);

  const number = previewTransactionNumber(series);

  await (tx as any).transactionNumberSeries.update({
    where: { id: series.id },
    data:  { nextNumber: series.nextNumber + 1 },
  });

  return number;
}

/**
 * Checks whether a given formatted number already exists in the relevant
 * module's table. Returns { isValid: true } if the number is free to use.
 */
export async function validateTransactionNumber(
  tenantId: string,
  module:   string,
  number:   string,
): Promise<{ isValid: boolean; reason?: string }> {
  let exists = false;

  switch (module) {
    case "INVOICE":
      exists = !!(await prisma.invoice.findFirst({ where: { tenantId, invoiceNumber: number } }));
      break;
    case "CUSTOMER_PAYMENT":
      exists = !!(await prisma.customerPayment.findFirst({ where: { tenantId, paymentNumber: number } }));
      break;
    case "CREDIT_NOTE":
      exists = !!(await prisma.creditNote.findFirst({ where: { tenantId, creditNumber: number } }));
      break;
    case "BILL":
      exists = !!(await prisma.bill.findFirst({ where: { tenantId, billNumber: number } }));
      break;
    case "VENDOR_PAYMENT":
      exists = !!(await prisma.vendorPayment.findFirst({ where: { tenantId, paymentNumber: number } }));
      break;
    case "JOURNAL":
      exists = !!(await prisma.journalEntry.findFirst({ where: { tenantId, entryNumber: number } }));
      break;
    default:
      // Module has no DB table yet (ESTIMATE, PURCHASE_ORDER, etc.) — always valid
      return { isValid: true };
  }

  if (exists) {
    return {
      isValid: false,
      reason:  `Number "${number}" already exists for ${moduleDisplayLabel(module)}.`,
    };
  }
  return { isValid: true };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function rowToPublic(r: {
  id: string;
  module: string;
  prefix: string;
  nextNumber: number;
  padLength: number;
  restartFreq: string;
  lastResetDate: Date | null;
  isEnabled: boolean;
  updatedAt: Date;
}): TransactionNumberSeriesRow {
  return {
    id:            r.id,
    module:        r.module,
    prefix:        r.prefix,
    nextNumber:    r.nextNumber,
    padLength:     r.padLength,
    restartFreq:   r.restartFreq,
    lastResetDate: r.lastResetDate,
    isEnabled:     r.isEnabled,
    updatedAt:     r.updatedAt,
  };
}
