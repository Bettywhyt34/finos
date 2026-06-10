/**
 * Setup & Configurations service layer.
 *
 * General preferences: no model in DB yet — all write ops throw.
 * Currencies: reads tenant.currency (base currency) from DB.
 *             Full TenantCurrency table does not exist yet — add/edit/disable ops throw.
 * Opening Balances: OpeningBalanceBatch + OpeningBalanceLine tables.
 *   Finalisation posts a balanced opening journal entry via lib/accounting/journals.ts.
 */

import { prisma }           from "@/lib/prisma";
import { CURRENCY_SYMBOLS } from "@/lib/fx";
import {
  postJournalEntry,
  type JournalLineInput,
}                           from "@/lib/accounting/journals";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function currencyName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
}

// ─── General Preferences ─────────────────────────────────────────────────────

/**
 * No general_preferences table exists in the current schema.
 * Returns null to signal that the backend is not connected.
 */
export async function getGeneralPreferences(
  _tenantId: string,
): Promise<null> {
  return null;
}

export async function updateGeneralPreferences(
  _tenantId: string,
  _data: Record<string, unknown>,
): Promise<never> {
  throw new Error("General preferences backend is not connected yet.");
}

// ─── Currencies ───────────────────────────────────────────────────────────────

export type TenantCurrencyRow = {
  id:           string;
  name:         string;
  symbol:       string;
  code:         string;
  exchangeRate: number;
  status:       "active" | "inactive";
  isBase:       boolean;
};

export type CurrenciesData = {
  baseCurrency: string | null;
  currencies:   TenantCurrencyRow[];
};

/**
 * Reads the tenant's base currency from tenant.currency.
 * No TenantCurrency join-table exists — only the base row is returned.
 */
export async function getCurrencies(tenantId: string): Promise<CurrenciesData> {
  const tenant = await prisma.tenant.findUnique({
    where:  { id: tenantId },
    select: { currency: true },
  });

  if (!tenant) return { baseCurrency: null, currencies: [] };

  const base: TenantCurrencyRow = {
    id:           "base",
    name:         currencyName(tenant.currency),
    symbol:       CURRENCY_SYMBOLS[tenant.currency] ?? tenant.currency,
    code:         tenant.currency,
    exchangeRate: 1,
    status:       "active",
    isBase:       true,
  };

  return { baseCurrency: tenant.currency, currencies: [base] };
}

export async function createCurrency(
  _tenantId: string,
  _data: Record<string, unknown>,
): Promise<never> {
  throw new Error("Currency backend is not connected yet.");
}

export async function updateCurrency(
  _tenantId: string,
  _currencyId: string,
  _data: Record<string, unknown>,
): Promise<never> {
  throw new Error("Currency backend is not connected yet.");
}

export async function disableCurrency(
  _tenantId: string,
  _currencyId: string,
): Promise<never> {
  throw new Error("Currency backend is not connected yet.");
}

// ─── Payment Terms ────────────────────────────────────────────────────────────

export type PaymentTermRow = {
  id:        string;
  name:      string;
  dueInDays: number | null;
  dueType:   string;
  appliesTo: string;
  isDefault: boolean;
  isSystem:  boolean;
  isActive:  boolean;
  createdAt: string; // ISO string — safe for RSC → client serialisation
  updatedAt: string;
};

export type CreatePaymentTermInput = {
  name:       string;
  dueType:    string;
  dueInDays?: number | null;
  appliesTo?: string;
  isDefault?: boolean;
};

export type UpdatePaymentTermInput = {
  name?:      string;
  dueType?:   string;
  dueInDays?: number | null;
  appliesTo?: string;
  isDefault?: boolean;
  isActive?:  boolean;
};

/** Returns all payment terms for the tenant, ordered by due type then days. */
export async function getPaymentTerms(tenantId: string): Promise<PaymentTermRow[]> {
  const rows = await prisma.paymentTerm.findMany({
    where:   { tenantId },
    orderBy: [{ isSystem: "desc" }, { dueInDays: "asc" }, { name: "asc" }],
    select: {
      id: true, name: true, dueInDays: true, dueType: true,
      appliesTo: true, isDefault: true, isSystem: true, isActive: true,
      createdAt: true, updatedAt: true,
    },
  });
  return rows.map((r) => ({
    ...r,
    dueType:   r.dueType as string,
    appliesTo: r.appliesTo as string,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/** Creates a custom payment term.  If isDefault=true, clears the previous default first. */
export async function createPaymentTerm(
  tenantId: string,
  data: CreatePaymentTermInput,
): Promise<PaymentTermRow> {
  const row = await prisma.$transaction(async (tx) => {
    if (data.isDefault) {
      await tx.paymentTerm.updateMany({
        where: { tenantId, isDefault: true },
        data:  { isDefault: false },
      });
    }
    return tx.paymentTerm.create({
      data: {
        tenantId,
        name:      data.name,
        dueType:   data.dueType as never,
        dueInDays: data.dueInDays ?? null,
        appliesTo: (data.appliesTo ?? "BOTH") as never,
        isDefault: data.isDefault ?? false,
        isSystem:  false,
        isActive:  true,
      },
      select: {
        id: true, name: true, dueInDays: true, dueType: true,
        appliesTo: true, isDefault: true, isSystem: true, isActive: true,
        createdAt: true, updatedAt: true,
      },
    });
  });
  return {
    ...row,
    dueType:   row.dueType as string,
    appliesTo: row.appliesTo as string,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Updates an existing payment term. Enforces tenant ownership and system-term rules. */
export async function updatePaymentTerm(
  tenantId: string,
  termId:   string,
  data:     UpdatePaymentTermInput,
): Promise<PaymentTermRow> {
  const existing = await prisma.paymentTerm.findFirst({
    where: { id: termId, tenantId },
  });
  if (!existing) throw new Error("Payment term not found.");

  // System terms: block structural changes; allow only isDefault + isActive
  if (existing.isSystem) {
    const allowed: (keyof UpdatePaymentTermInput)[] = ["isDefault", "isActive"];
    const badKey = (Object.keys(data) as (keyof UpdatePaymentTermInput)[])
      .find((k) => !allowed.includes(k) && data[k] !== undefined);
    if (badKey) {
      throw new Error("System payment terms cannot have their name, due type, or applies-to changed.");
    }
  }

  // Guard: cannot deactivate the default term via update
  if (data.isActive === false && existing.isDefault) {
    throw new Error("Cannot deactivate the default payment term. Set another term as default first.");
  }

  const row = await prisma.$transaction(async (tx) => {
    if (data.isDefault === true) {
      await tx.paymentTerm.updateMany({
        where: { tenantId, isDefault: true, id: { not: termId } },
        data:  { isDefault: false },
      });
    }
    return tx.paymentTerm.update({
      where: { id: termId },
      data: {
        ...(data.name      !== undefined && !existing.isSystem && { name:      data.name      }),
        ...(data.dueType   !== undefined && !existing.isSystem && { dueType:   data.dueType   as never }),
        ...(data.dueInDays !== undefined && !existing.isSystem && { dueInDays: data.dueInDays }),
        ...(data.appliesTo !== undefined && !existing.isSystem && { appliesTo: data.appliesTo as never }),
        ...(data.isDefault !== undefined && { isDefault: data.isDefault }),
        ...(data.isActive  !== undefined && { isActive:  data.isActive  }),
      },
      select: {
        id: true, name: true, dueInDays: true, dueType: true,
        appliesTo: true, isDefault: true, isSystem: true, isActive: true,
        createdAt: true, updatedAt: true,
      },
    });
  });
  return {
    ...row,
    dueType:   row.dueType as string,
    appliesTo: row.appliesTo as string,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Sets a term as the default, clearing any previous default for the tenant. */
export async function setDefaultPaymentTerm(
  tenantId: string,
  termId:   string,
): Promise<PaymentTermRow> {
  return updatePaymentTerm(tenantId, termId, { isDefault: true });
}

/**
 * Soft-deactivates a payment term (sets isActive = false).
 * Blocks deactivation of system terms and the current default term.
 */
export async function deactivatePaymentTerm(
  tenantId: string,
  termId:   string,
): Promise<void> {
  const existing = await prisma.paymentTerm.findFirst({
    where: { id: termId, tenantId },
  });
  if (!existing) throw new Error("Payment term not found.");
  if (existing.isSystem)  throw new Error("System payment terms cannot be deleted.");
  if (existing.isDefault) throw new Error("Cannot deactivate the default payment term. Set another term as default first.");

  await prisma.paymentTerm.update({
    where: { id: termId },
    data:  { isActive: false },
  });
}

/**
 * Calculates the due date from a transaction date and a payment term rule.
 *
 * DUE_ON_RECEIPT    → transaction date (payment due immediately)
 * FIXED_DAYS        → transaction date + dueInDays
 * END_OF_MONTH      → last day of the transaction's calendar month
 * END_OF_NEXT_MONTH → last day of the following calendar month
 */
export function calculateDueDate(
  transactionDate: Date,
  dueType:         string,
  dueInDays?:      number | null,
): Date {
  const d = new Date(transactionDate);
  switch (dueType) {
    case "DUE_ON_RECEIPT":
      return d;
    case "FIXED_DAYS":
      d.setDate(d.getDate() + (dueInDays ?? 0));
      return d;
    case "END_OF_MONTH":
      // Day 0 of the next month = last day of the current month
      return new Date(d.getFullYear(), d.getMonth() + 1, 0);
    case "END_OF_NEXT_MONTH":
      return new Date(d.getFullYear(), d.getMonth() + 2, 0);
    default:
      return d;
  }
}

// ─── Opening Balances ─────────────────────────────────────────────────────────

export type OpeningBalanceLineRow = {
  id:              string;
  batchId:         string;
  tenantId:        string;
  accountId:       string | null;
  lineType:        string;   // "ACCOUNT" | "CUSTOMER" | "VENDOR" | "BANK"
  customerId:      string | null;
  vendorId:        string | null;
  bankAccountId:   string | null;
  label:           string;
  accountCategory: string | null;
  currency:        string;
  exchangeRate:    number;
  debit:           number;
  credit:          number;
  createdAt:       string;
  updatedAt:       string;
};

export type OpeningBalanceBatchRow = {
  id:             string;
  tenantId:       string;
  migrationDate:  string;   // ISO date string — safe for RSC → client serialisation
  status:         "DRAFT" | "FINALISED";
  notes:          string | null;
  finalisedAt:    string | null;
  finalisedById:  string | null;
  journalEntryId: string | null;
  createdAt:      string;
  updatedAt:      string;
  lines:          OpeningBalanceLineRow[];
};

export type OpeningBalanceSummary = {
  totalDebit:  number;
  totalCredit: number;
  difference:  number;
  isBalanced:  boolean;
};

export type CreateOpeningBalanceDraftInput = {
  migrationDate: string;   // ISO date string
  notes?:        string;
};

export type UpdateOpeningBalanceDraftInput = {
  migrationDate?: string;
  notes?:         string;
};

export type AddOpeningBalanceLineInput = {
  lineType:        string;
  accountId?:      string | null;
  customerId?:     string | null;
  vendorId?:       string | null;
  bankAccountId?:  string | null;
  label:           string;
  accountCategory?: string | null;
  currency?:       string;
  exchangeRate?:   number;
  debit?:          number;
  credit?:         number;
};

export type UpdateOpeningBalanceLineInput = {
  accountId?:      string | null;
  customerId?:     string | null;
  vendorId?:       string | null;
  bankAccountId?:  string | null;
  label?:          string;
  accountCategory?: string | null;
  currency?:       string;
  exchangeRate?:   number;
  debit?:          number;
  credit?:         number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function lineToRow(line: {
  id: string;
  batchId: string;
  tenantId: string;
  accountId: string | null;
  lineType: string;
  customerId: string | null;
  vendorId: string | null;
  bankAccountId: string | null;
  label: string;
  accountCategory: string | null;
  currency: string;
  exchangeRate: { toNumber(): number } | number;
  debit: { toNumber(): number } | number;
  credit: { toNumber(): number } | number;
  createdAt: Date;
  updatedAt: Date;
}): OpeningBalanceLineRow {
  return {
    id:              line.id,
    batchId:         line.batchId,
    tenantId:        line.tenantId,
    accountId:       line.accountId,
    lineType:        line.lineType,
    customerId:      line.customerId,
    vendorId:        line.vendorId,
    bankAccountId:   line.bankAccountId,
    label:           line.label,
    accountCategory: line.accountCategory,
    currency:        line.currency,
    exchangeRate:    typeof line.exchangeRate === "number"
                       ? line.exchangeRate
                       : (line.exchangeRate as { toNumber(): number }).toNumber(),
    debit:           typeof line.debit === "number"
                       ? line.debit
                       : (line.debit as { toNumber(): number }).toNumber(),
    credit:          typeof line.credit === "number"
                       ? line.credit
                       : (line.credit as { toNumber(): number }).toNumber(),
    createdAt:       line.createdAt.toISOString(),
    updatedAt:       line.updatedAt.toISOString(),
  };
}

function batchToRow(batch: {
  id: string;
  tenantId: string;
  migrationDate: Date;
  status: string;
  notes: string | null;
  finalisedAt: Date | null;
  finalisedById: string | null;
  journalEntryId: string | null;
  createdAt: Date;
  updatedAt: Date;
  lines: Parameters<typeof lineToRow>[0][];
}): OpeningBalanceBatchRow {
  return {
    id:             batch.id,
    tenantId:       batch.tenantId,
    migrationDate:  batch.migrationDate.toISOString(),
    status:         batch.status as "DRAFT" | "FINALISED",
    notes:          batch.notes,
    finalisedAt:    batch.finalisedAt?.toISOString() ?? null,
    finalisedById:  batch.finalisedById,
    journalEntryId: batch.journalEntryId,
    createdAt:      batch.createdAt.toISOString(),
    updatedAt:      batch.updatedAt.toISOString(),
    lines:          batch.lines.map(lineToRow),
  };
}

/** Returns total debit/credit/difference across all lines. */
export function validateOpeningBalance(
  lines: Pick<OpeningBalanceLineRow, "debit" | "credit">[],
): OpeningBalanceSummary {
  const totalDebit  = lines.reduce((s, l) => s + l.debit,  0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  const difference  = Math.abs(totalDebit - totalCredit);
  return { totalDebit, totalCredit, difference, isBalanced: difference < 0.005 };
}

// ── Reads ─────────────────────────────────────────────────────────────────────

/** Returns the tenant's current opening balance batch (most recent) with all lines. */
export async function getOpeningBalance(
  tenantId: string,
): Promise<OpeningBalanceBatchRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const batch = await (prisma as any).openingBalanceBatch.findFirst({
    where:   { tenantId },
    include: { lines: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
  if (!batch) return null;
  return batchToRow(batch);
}

/** Returns lines for a specific account category within the latest batch. */
export async function getOpeningBalanceAccountDetails(
  tenantId:        string,
  accountCategory: string,
): Promise<OpeningBalanceLineRow[]> {
  const batch = await getOpeningBalance(tenantId);
  if (!batch) return [];
  return batch.lines.filter(
    (l) => (l.accountCategory ?? "").toLowerCase() === accountCategory.toLowerCase(),
  );
}

// ── Writes ────────────────────────────────────────────────────────────────────

/** Creates a new DRAFT opening balance batch.
 *  Only one active batch per tenant is recommended; a second call will succeed
 *  but the UI surfaces only the latest. */
export async function createOpeningBalanceDraft(
  tenantId: string,
  data:     CreateOpeningBalanceDraftInput,
): Promise<OpeningBalanceBatchRow> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const batch = await (prisma as any).openingBalanceBatch.create({
    data: {
      tenantId,
      migrationDate: new Date(data.migrationDate),
      status:        "DRAFT",
      notes:         data.notes ?? null,
    },
    include: { lines: true },
  });
  return batchToRow(batch);
}

/** Updates migration date / notes on a DRAFT batch. */
export async function updateOpeningBalanceDraft(
  tenantId: string,
  batchId:  string,
  data:     UpdateOpeningBalanceDraftInput,
): Promise<OpeningBalanceBatchRow> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = await (prisma as any).openingBalanceBatch.findFirst({
    where: { id: batchId, tenantId },
  });
  if (!existing) throw new Error("Opening balance not found.");
  if (existing.status !== "DRAFT") throw new Error("Only DRAFT opening balances can be edited.");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const batch = await (prisma as any).openingBalanceBatch.update({
    where: { id: batchId },
    data: {
      ...(data.migrationDate !== undefined && {
        migrationDate: new Date(data.migrationDate),
      }),
      ...(data.notes !== undefined && { notes: data.notes }),
    },
    include: { lines: { orderBy: { createdAt: "asc" } } },
  });
  return batchToRow(batch);
}

/** Adds a line to a DRAFT batch. */
export async function addOpeningBalanceLine(
  tenantId: string,
  batchId:  string,
  data:     AddOpeningBalanceLineInput,
): Promise<OpeningBalanceLineRow> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const batch = await (prisma as any).openingBalanceBatch.findFirst({
    where: { id: batchId, tenantId },
  });
  if (!batch) throw new Error("Opening balance not found.");
  if (batch.status !== "DRAFT") throw new Error("Only DRAFT opening balances can be edited.");

  const debit  = data.debit  ?? 0;
  const credit = data.credit ?? 0;
  if (debit < 0 || credit < 0)    throw new Error("Debit and credit must be non-negative.");
  if (debit > 0 && credit > 0)    throw new Error("A line cannot have both a debit and a credit value.");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const line = await (prisma as any).openingBalanceLine.create({
    data: {
      batchId,
      tenantId,
      lineType:        data.lineType ?? "ACCOUNT",
      accountId:       data.accountId    ?? null,
      customerId:      data.customerId   ?? null,
      vendorId:        data.vendorId     ?? null,
      bankAccountId:   data.bankAccountId ?? null,
      label:           data.label,
      accountCategory: data.accountCategory ?? null,
      currency:        data.currency     ?? "NGN",
      exchangeRate:    data.exchangeRate ?? 1,
      debit,
      credit,
    },
  });
  return lineToRow(line);
}

/** Updates a single line on a DRAFT batch. */
export async function updateOpeningBalanceLine(
  tenantId: string,
  batchId:  string,
  lineId:   string,
  data:     UpdateOpeningBalanceLineInput,
): Promise<OpeningBalanceLineRow> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const line = await (prisma as any).openingBalanceLine.findFirst({
    where: { id: lineId, batchId, tenantId },
    include: { batch: { select: { status: true } } },
  });
  if (!line) throw new Error("Opening balance line not found.");
  if (line.batch.status !== "DRAFT") throw new Error("Only DRAFT opening balances can be edited.");

  const newDebit  = data.debit  !== undefined ? data.debit  : Number(line.debit);
  const newCredit = data.credit !== undefined ? data.credit : Number(line.credit);
  if (newDebit < 0 || newCredit < 0)      throw new Error("Debit and credit must be non-negative.");
  if (newDebit > 0 && newCredit > 0)      throw new Error("A line cannot have both a debit and a credit value.");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updated = await (prisma as any).openingBalanceLine.update({
    where: { id: lineId },
    data: {
      ...(data.accountId      !== undefined && { accountId:      data.accountId      }),
      ...(data.customerId     !== undefined && { customerId:     data.customerId     }),
      ...(data.vendorId       !== undefined && { vendorId:       data.vendorId       }),
      ...(data.bankAccountId  !== undefined && { bankAccountId:  data.bankAccountId  }),
      ...(data.label          !== undefined && { label:          data.label          }),
      ...(data.accountCategory !== undefined && { accountCategory: data.accountCategory }),
      ...(data.currency       !== undefined && { currency:       data.currency       }),
      ...(data.exchangeRate   !== undefined && { exchangeRate:   data.exchangeRate   }),
      debit:  newDebit,
      credit: newCredit,
    },
  });
  return lineToRow(updated);
}

/** Deletes a line from a DRAFT batch. */
export async function deleteOpeningBalanceLine(
  tenantId: string,
  batchId:  string,
  lineId:   string,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const line = await (prisma as any).openingBalanceLine.findFirst({
    where: { id: lineId, batchId, tenantId },
    include: { batch: { select: { status: true } } },
  });
  if (!line) throw new Error("Opening balance line not found.");
  if (line.batch.status !== "DRAFT") throw new Error("Only DRAFT opening balances can be edited.");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma as any).openingBalanceLine.delete({ where: { id: lineId } });
}

/**
 * Finalises the opening balance:
 * 1. Validates balance (DR = CR).
 * 2. Verifies all lines have an accountId.
 * 3. Posts a balanced opening journal entry via lib/accounting/journals.
 * 4. Marks the batch FINALISED.
 *
 * Throws with clear error messages for each invariant violation.
 */
export async function finaliseOpeningBalance(
  tenantId: string,
  batchId:  string,
  userId:   string,
): Promise<OpeningBalanceBatchRow> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = await (prisma as any).openingBalanceBatch.findFirst({
    where:   { id: batchId, tenantId },
    include: { lines: true },
  });
  if (!raw) throw new Error("Opening balance not found.");
  if (raw.status !== "DRAFT") throw new Error("Only DRAFT opening balances can be finalised.");

  const lines = (raw.lines as Parameters<typeof lineToRow>[0][]).map(lineToRow);

  if (lines.length === 0) {
    throw new Error("Cannot finalise: no lines have been entered.");
  }

  const validation = validateOpeningBalance(lines);
  if (!validation.isBalanced) {
    throw new Error(
      `Opening balances are not balanced. Difference: ${validation.difference.toFixed(2)} ` +
      `(Debit ${validation.totalDebit.toFixed(2)} vs Credit ${validation.totalCredit.toFixed(2)}).`,
    );
  }

  // Verify all lines have accountId before posting to ledger
  const missingAccount = lines.filter((l) => !l.accountId);
  if (missingAccount.length > 0) {
    const names = missingAccount.slice(0, 3).map((l) => `"${l.label}"`).join(", ");
    throw new Error(
      `${missingAccount.length} line(s) have no account assigned: ${names}. ` +
      "Assign a Chart of Accounts entry to every line before finalising.",
    );
  }

  // Build canonical journal lines
  const migrationDate    = raw.migrationDate as Date;
  const recognitionPeriod =
    `${migrationDate.getFullYear()}-${String(migrationDate.getMonth() + 1).padStart(2, "0")}`;

  const journalLines: JournalLineInput[] = [];
  for (const line of lines) {
    const rate   = line.exchangeRate;
    const amtNgn = (amount: number) => Math.round(amount * rate * 100) / 100;

    if (line.debit > 0) {
      journalLines.push({
        accountId:   line.accountId!,
        direction:   "DR",
        amountNgn:   amtNgn(line.debit),
        description: line.label,
      });
    }
    if (line.credit > 0) {
      journalLines.push({
        accountId:   line.accountId!,
        direction:   "CR",
        amountNgn:   amtNgn(line.credit),
        description: line.label,
      });
    }
  }

  // Post journal entry — throws if period is closed or lines unbalanced
  const entry = await postJournalEntry({
    tenantId,
    createdBy:         userId,
    entryDate:         migrationDate,
    reference:         "OPENING-BAL",
    description:       "Opening Balances",
    recognitionPeriod,
    source:            "opening_balance",
    sourceId:          batchId,
    lines:             journalLines,
  });

  // Mark batch finalised
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updated = await (prisma as any).openingBalanceBatch.update({
    where: { id: batchId },
    data: {
      status:         "FINALISED",
      finalisedAt:    new Date(),
      finalisedById:  userId,
      journalEntryId: entry.id,
    },
    include: { lines: { orderBy: { createdAt: "asc" } } },
  });
  return batchToRow(updated);
}

/**
 * Deletes a DRAFT opening balance batch and all its lines.
 * Finalised batches cannot be deleted this way — reverse via journal if needed.
 */
export async function deleteOpeningBalanceDraft(
  tenantId: string,
  batchId:  string,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const batch = await (prisma as any).openingBalanceBatch.findFirst({
    where: { id: batchId, tenantId },
  });
  if (!batch) throw new Error("Opening balance not found.");
  if (batch.status !== "DRAFT") {
    throw new Error(
      "Finalised opening balances cannot be deleted. " +
      "Reverse the opening journal entry from the Journal Entries module.",
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma as any).openingBalanceBatch.delete({ where: { id: batchId } });
}
