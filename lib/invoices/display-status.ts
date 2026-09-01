/**
 * Shared invoice display-status helper.
 *
 * Computes the status to show in UI — separate from the value stored in DB.
 *
 * Rules (in priority order):
 *   DRAFT        → always DRAFT
 *   PAID         → always PAID
 *   VOIDED       → always VOIDED
 *   WRITTEN_OFF  → always WRITTEN_OFF
 *   active AR state with zero balance → SETTLED
 *   SENT, PARTIAL, OVERDUE with open AR
 *                → OVERDUE if dueDate < today
 *                → otherwise return the DB status as-is
 *
 * SETTLED is presentation-only. It covers non-cash settlement such as a credit
 * note reducing the remaining AR to zero without incorrectly labelling it PAID.
 */
export function getInvoiceDisplayStatus(invoice: {
  status: string;
  dueDate: Date | string;
  balanceDue: string | number;
}): string {
  if (["DRAFT", "PAID", "VOIDED", "WRITTEN_OFF"].includes(invoice.status)) {
    return invoice.status;
  }

  const balance = parseFloat(String(invoice.balanceDue));
  if (Number.isFinite(balance) && balance <= 0.01) {
    return "SETTLED";
  }
  if (balance > 0 && new Date(invoice.dueDate) < new Date()) {
    return "OVERDUE";
  }
  return invoice.status;
}
