/**
 * Client-side service for Tax Rates and Tax Settings.
 */

export type TaxType = "VAT" | "WHT" | "PAYE" | "CUSTOM";

export interface TaxRate {
  id:        string;
  name:      string;
  type:      TaxType;
  rate:      number;
  isDefault: boolean;
  isActive:  boolean;
  createdAt: string;
}

export interface TaxSettings {
  taxRegistrationLabel:    string;
  taxRegistrationNumber:   string;
  whtEnabled:              boolean;
  reverseChargeSales:      boolean;
  reverseChargePurchases:  boolean;
  trackingMode:            "single" | "separate";
  overrideSales:           boolean;
  overridePurchases:       boolean;
  _note?:                  string;
}

// ─── Tax Rates ────────────────────────────────────────────────────────────────

export async function getTaxRates(): Promise<TaxRate[]> {
  const res = await fetch("/api/settings/taxes");
  if (!res.ok) throw new Error("Failed to load tax rates");
  return res.json();
}

export async function createTaxRate(data: {
  name: string; type: TaxType; rate: number; isDefault?: boolean;
}): Promise<TaxRate> {
  const res = await fetch("/api/settings/taxes", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "Failed to create tax rate");
  }
  return res.json();
}

export async function updateTaxRate(
  id: string,
  data: Partial<{ name: string; type: TaxType; rate: number; isDefault: boolean }>,
): Promise<TaxRate> {
  const res = await fetch(`/api/settings/taxes/${id}`, {
    method:  "PATCH",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "Failed to update tax rate");
  }
  return res.json();
}

export async function deleteTaxRate(id: string): Promise<void> {
  const res = await fetch(`/api/settings/taxes/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete tax rate");
}

// ─── Tax Settings ─────────────────────────────────────────────────────────────

export async function getTaxSettings(): Promise<TaxSettings> {
  const res = await fetch("/api/settings/taxes/settings");
  if (!res.ok) throw new Error("Failed to load tax settings");
  return res.json();
}

export async function updateTaxSettings(data: Partial<TaxSettings>): Promise<TaxSettings> {
  const res = await fetch("/api/settings/taxes/settings", {
    method:  "PATCH",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "Failed to update tax settings");
  }
  return res.json();
}
