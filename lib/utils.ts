import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { format } from "date-fns"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number | string, currency = "NGN"): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(num);
}

export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return format(d, "dd MMM yyyy");
}

export function getRecognitionPeriod(date: Date = new Date()): string {
  return format(date, "yyyy-MM");
}

export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function validateDoubleEntry(
  lines: { debit: number; credit: number }[]
): boolean {
  const totalDebits = lines.reduce((sum, line) => sum + line.debit, 0);
  const totalCredits = lines.reduce((sum, line) => sum + line.credit, 0);
  return Math.abs(totalDebits - totalCredits) < 0.001;
}

/**
 * Convert a foreign-currency amount to NGN using the stored exchange rate.
 * All report aggregations should use this to produce NGN totals.
 */
export function toNGN(amount: number | string, exchangeRate: number | string): number {
  const amt = typeof amount === "string" ? parseFloat(amount) : amount;
  const rate = typeof exchangeRate === "string" ? parseFloat(exchangeRate) : exchangeRate;
  return Math.round(amt * rate * 100) / 100;
}
