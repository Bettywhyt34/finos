/**
 * Invoice PDF template registry.
 *
 * Maps layout keys (stored in PdfTemplate.layoutKey) to renderer identifiers.
 * To add a new template renderer, register its key here.
 *
 * Supported keys:
 *   standard                    — Clean simple layout (default fallback)
 *   professional_branded_invoice — Full branded layout with org accent colour
 */

export const SUPPORTED_INVOICE_LAYOUT_KEYS = [
  "standard",
  "professional_branded_invoice",
] as const;

export type InvoiceLayoutKey = (typeof SUPPORTED_INVOICE_LAYOUT_KEYS)[number];

/**
 * Returns the effective layout key to use for rendering.
 * Falls back to "standard" if the stored key is unrecognised or missing.
 */
export function resolveInvoiceLayoutKey(raw: string): InvoiceLayoutKey {
  if ((SUPPORTED_INVOICE_LAYOUT_KEYS as readonly string[]).includes(raw)) {
    return raw as InvoiceLayoutKey;
  }
  return "standard";
}
