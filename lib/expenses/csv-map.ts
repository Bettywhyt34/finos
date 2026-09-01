/**
 * Zoho Expense CSV → FINOS Expense mapper.
 *
 * Zoho exports expenses in a FLAT format: one row per expense (no grouping).
 *
 * Key columns used:
 *   Expense Reference ID  → externalExpenseId (deduplication key)
 *   Expense Date          → expenseDate
 *   Expense Description   → description
 *   Expense Account       → categoryName (matched to ExpenseCategory by name)
 *   Expense Account Code  → categoryCode (fallback for matching)
 *   Vendor                → appended to description if present
 *   Tax Amount            → taxAmount
 *   Expense Amount        → amount (net before tax)
 *   Total                 → totalAmount (gross)
 *   Status / Expense Status / Reimbursement Status → workflow status when explicit
 *   Claimant Email        → submitterEmail (for future employee matching)
 *
 * IMPORTANT: `Is Reimbursable` describes the nature of the claim, not whether
 * the claim has been approved or paid. FINOS must never use that flag to infer
 * an accounting settlement status.
 */

export type ZohoExpenseStatus = "DRAFT" | "PENDING" | "APPROVED" | "REJECTED" | "REIMBURSED"

export interface MappedExpense {
  externalExpenseId: string       // Expense Reference ID from Zoho
  expenseDate: string             // ISO date string (YYYY-MM-DD)
  description: string
  categoryName: string            // Expense Account column
  categoryCode: string | null     // Expense Account Code column
  vendor: string | null
  taxAmount: number
  amount: number                  // net (Expense Amount)
  totalAmount: number             // gross (Total)
  status: ZohoExpenseStatus
  submitterEmail: string | null
  referenceNumber: string | null  // Reference# column
}

/** Normalise a CSV header: lowercase, collapse whitespace + special chars */
function normaliseKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[#&]/g, "")
    .replace(/[\s\-/\\()]+/g, "_")
    .replace(/_+$/g, "")
    .trim()
}

function cell(row: Record<string, string>, key: string): string {
  return (row[key] ?? "").trim()
}

function parseDate(v: string): string {
  if (!v) return new Date().toISOString().slice(0, 10)
  // M/D/YYYY or MM/DD/YYYY
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10)
  return new Date().toISOString().slice(0, 10)
}

function mapStatus(row: Record<string, string>): ZohoExpenseStatus {
  const raw = (
    cell(row, "expense_status") ||
    cell(row, "status") ||
    cell(row, "reimbursement_status")
  ).toLowerCase().replace(/[\s-]+/g, "_")

  if (!raw) return "PENDING"
  if (["draft", "unsubmitted"].includes(raw)) return "DRAFT"
  if (["pending", "submitted", "pending_approval", "awaiting_approval"].includes(raw)) return "PENDING"
  if (["approved", "accepted"].includes(raw)) return "APPROVED"
  if (["rejected", "declined"].includes(raw)) return "REJECTED"
  if (["reimbursed", "paid", "settled"].includes(raw)) return "REIMBURSED"

  // Unknown external statuses are deliberately non-posting until reviewed.
  return "PENDING"
}

function splitLine(line: string, delimiter: string): string[] {
  const result: string[] = []
  let cur = ""
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++ }
      else inQ = !inQ
    } else if (ch === delimiter && !inQ) {
      result.push(cur); cur = ""
    } else {
      cur += ch
    }
  }
  result.push(cur)
  return result
}

/** Parse a Zoho expense CSV string and return mapped expenses. */
export function parseZohoExpenseCsv(csvText: string): {
  expenses: MappedExpense[]
  skipped: number
} {
  const lines = csvText.split(/\r?\n/)
  if (lines.length < 2) return { expenses: [], skipped: 0 }

  const delimiter = lines[0].includes("\t") ? "\t" : ","
  const rawHeaders = lines[0].split(delimiter).map((h) => h.replace(/^"|"$/g, "").trim())
  const headers = rawHeaders.map(normaliseKey)

  const expenses: MappedExpense[] = []
  let skipped = 0

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const values = splitLine(line, delimiter)
    const row: Record<string, string> = {}
    headers.forEach((h, idx) => {
      row[h] = (values[idx] ?? "").replace(/^"|"$/g, "").trim()
    })

    // Deduplication key — Zoho's internal expense ID
    const externalId =
      cell(row, "expense_reference_id") ||
      cell(row, "entry_number")
    if (!externalId) { skipped++; continue }

    const categoryName = cell(row, "expense_account")
    if (!categoryName) { skipped++; continue }

    const amount     = parseFloat(cell(row, "expense_amount")) || 0
    const taxAmount  = parseFloat(cell(row, "tax_amount"))     || 0
    const total      = parseFloat(cell(row, "total"))          || amount + taxAmount

    const vendor = cell(row, "vendor") || null

    // Description: use Expense Description; if blank fall back to vendor
    const description =
      cell(row, "expense_description") ||
      vendor ||
      "Imported expense"

    expenses.push({
      externalExpenseId: externalId,
      expenseDate:       parseDate(cell(row, "expense_date")),
      description,
      categoryName,
      categoryCode:      cell(row, "expense_account_code") || null,
      vendor,
      taxAmount,
      amount,
      totalAmount:       total,
      status:            mapStatus(row),
      submitterEmail:    cell(row, "claimant_email") || null,
      referenceNumber:   cell(row, "reference") || null,
    })
  }

  return { expenses, skipped }
}
