/**
 * Foreign exchange helpers.
 *
 * fetchExchangeRate — live rate from Frankfurter (free, no key).
 * toNGN            — multiply a foreign-currency amount by the stored rate.
 *
 * All monetary fields on Invoice / Bill are stored in the document currency
 * (e.g., USD). Journal entries are always posted in NGN = amount × exchangeRate.
 */

export const SUPPORTED_CURRENCIES = ["NGN", "USD", "GBP", "EUR", "JPY", "CAD", "AUD", "CHF", "ZAR", "GHS"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export const CURRENCY_SYMBOLS: Record<string, string> = {
  NGN: "₦",
  USD: "$",
  GBP: "£",
  EUR: "€",
  JPY: "¥",
  CAD: "CA$",
  AUD: "A$",
  CHF: "CHF",
  ZAR: "R",
  GHS: "GH₵",
};

/**
 * Fetch live exchange rate from Frankfurter API.
 * Returns 1 if from === to, or on any error.
 */
export async function fetchExchangeRate(from: string, to = "NGN"): Promise<number> {
  if (from === to) return 1;
  try {
    const res = await fetch(
      `https://api.frankfurter.app/latest?from=${from}&to=${to}`,
      { next: { revalidate: 3600 } } // cache 1 hour server-side
    );
    if (!res.ok) return 1;
    const json = (await res.json()) as { rates?: Record<string, number> };
    return json.rates?.[to] ?? 1;
  } catch {
    return 1;
  }
}

/**
 * Convert a foreign-currency amount to NGN using the stored exchange rate.
 * Rounds to 2 decimal places.
 */
export function toNGN(amount: number, exchangeRate: number): number {
  return Math.round(amount * exchangeRate * 100) / 100;
}

/**
 * Format an amount in a given currency for display.
 * Uses Intl.NumberFormat — falls back gracefully for unknown codes.
 */
export function formatFX(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    const sym = CURRENCY_SYMBOLS[currency] ?? currency;
    return `${sym}${amount.toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
  }
}
