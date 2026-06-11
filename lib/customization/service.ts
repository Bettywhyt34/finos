/**
 * Customization service — Transaction Number Series.
 *
 * Server-only. All DB functions are tenant-scoped.
 *
 * Pure client-safe helpers (previewTransactionNumber, moduleDisplayLabel,
 * MODULE_GROUPS, etc.) live in ./utils and are re-exported here so callers
 * can import from a single location when needed server-side.
 *
 * Client components should import directly from "@/lib/customization/utils"
 * to avoid pulling pg/prisma into the browser bundle.
 */

import { prisma } from "@/lib/prisma";

// Re-export pure helpers for server-side callers.
export {
  moduleDisplayLabel,
  MODULE_DISPLAY_ORDER,
  MODULE_GROUPS,
  previewTransactionNumber,
  type TransactionNumberSeriesRow,
} from "./utils";

import type { TransactionNumberSeriesRow } from "./utils";
import { moduleDisplayLabel, previewTransactionNumber } from "./utils";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type UpdateTransactionNumberSeriesInput = {
  prefix?:               string;
  suffix?:               string;
  nextNumber?:           number;
  padLength?:            number;
  restartFreq?:          string;
  isEnabled?:            boolean;
  allowManualOverride?:  boolean;
  preventDuplicates?:    boolean;
};

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
      ...(data.prefix               !== undefined ? { prefix:               data.prefix.trim()                                  } : {}),
      ...(data.suffix               !== undefined ? { suffix:               data.suffix.trim()                                  } : {}),
      ...(data.nextNumber           !== undefined ? { nextNumber:           data.nextNumber                                     } : {}),
      ...(data.padLength            !== undefined ? { padLength:            data.padLength                                      } : {}),
      ...(data.restartFreq          !== undefined ? { restartFreq:          data.restartFreq as "NEVER" | "MONTHLY" | "YEARLY" } : {}),
      ...(data.isEnabled            !== undefined ? { isEnabled:            data.isEnabled                                      } : {}),
      ...(data.allowManualOverride  !== undefined ? { allowManualOverride:  data.allowManualOverride                            } : {}),
      ...(data.preventDuplicates    !== undefined ? { preventDuplicates:    data.preventDuplicates                              } : {}),
    },
  });
  return rowToPublic(updated);
}

// ─── Number generation ────────────────────────────────────────────────────────

type TransactionModuleValue =
  | "INVOICE" | "CUSTOMER_PAYMENT" | "CREDIT_NOTE" | "BILL"
  | "VENDOR_PAYMENT" | "JOURNAL" | "ESTIMATE" | "PURCHASE_ORDER"
  | "VENDOR_CREDIT" | "DEBIT_NOTE";

/**
 * Atomically generates the next number for a module, incrementing nextNumber.
 * Uses a Prisma transaction to prevent race conditions.
 */
export async function generateTransactionNumber(
  tenantId: string,
  module:   string,
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const series = await tx.transactionNumberSeries.findFirst({
      where: { tenantId, module: module as TransactionModuleValue },
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
 * Like generateTransactionNumber but participates in a caller-provided Prisma
 * transaction for atomicity with the parent operation.
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
 * Checks whether a formatted number already exists in the relevant module table.
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
      return { isValid: true };
  }

  if (exists) {
    return { isValid: false, reason: `Number "${number}" already exists for ${moduleDisplayLabel(module)}.` };
  }
  return { isValid: true };
}

// ─── Internal helper ──────────────────────────────────────────────────────────

function rowToPublic(r: {
  id: string; module: string; prefix: string; suffix: string; nextNumber: number;
  padLength: number; restartFreq: string; lastResetDate: Date | null;
  isEnabled: boolean; allowManualOverride: boolean; preventDuplicates: boolean;
  updatedAt: Date;
}): TransactionNumberSeriesRow {
  return {
    id:                   r.id,
    module:               r.module,
    prefix:               r.prefix,
    suffix:               r.suffix,
    nextNumber:           r.nextNumber,
    padLength:            r.padLength,
    restartFreq:          r.restartFreq,
    lastResetDate:        r.lastResetDate,
    isEnabled:            r.isEnabled,
    allowManualOverride:  r.allowManualOverride,
    preventDuplicates:    r.preventDuplicates,
    updatedAt:            r.updatedAt,
  };
}
