/**
 * Shared invoice display-status helper.
 *
 * Computes the status to show in UI — separate from the value stored in DB.
 *
 * Rules (in priority order):
 *   DRAFT        → always DRAFT   (not subject to overdue check)
 *   PAID         → always PAID
 *   VOIDED       → always VOIDED
 *   WRITTEN_OFF  → always WRITTEN_OFF
 *   SENT, PARTIAL, OVERDUE (DB value)
 *                → OVERDUE if dueDate < today AND balanceDue > 0
 *                → otherwise return the DB status as-is
 *
 * Use this everywhere a status badge is rendered:
 *   invoice list, invoice detail, summary counters.
 * Do NOT duplicate this logic in individual components.
 */
export function getInvoiceDisplayStatus(invoice: {
  status: string;
  dueDate: Date | string;
  balanceDue: string | number;
}): string {
  // Terminal / non-AR states — never compute overdue
  if (["DRAFT", "PAID", "VOIDED", "WRITTEN_OFF"].includes(invoice.status)) {
    return invoice.status;
  }
  // Active AR states — check for overdue
  const balance = parseFloat(String(invoice.balanceDue));
  if (balance > 0 && new Date(invoice.dueDate) < new Date()) {
    return "OVERDUE";
  }
  return invoice.status;
}
