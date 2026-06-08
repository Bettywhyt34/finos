/**
 * Setup & Configurations service layer.
 *
 * General preferences: no model in DB yet — all write ops throw.
 * Currencies: reads tenant.currency (base currency) from DB.
 *             Full TenantCurrency table does not exist yet — add/edit/disable ops throw.
 */

import { prisma }           from "@/lib/prisma";
import { CURRENCY_SYMBOLS } from "@/lib/fx";

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
