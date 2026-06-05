/**
 * Zoho Books bill CSV → FINOS Bill + BillLine mapper.
 *
 * Zoho exports bills in a FLAT format: one row per line item, with the bill
 * header columns repeated on every row. Multiple rows sharing the same
 * Bill ID belong to the same bill.
 *
 * Status mapping:
 *   Paid         → PAID
 *   Open         → RECORDED
 *   Overdue      → OVERDUE
 *   Partially Paid / PartiallyPaid → PARTIAL
 *   Draft        → DRAFT
 *   (anything else) → RECORDED
 */

export type ZohoBillStatus = "DRAFT" | "RECORDED" | "PARTIAL" | "PAID" | "OVERDUE"

export interface MappedBillLine {
  description: string
  quantity: number
  rate: number
  amount: number
  taxAmount: number
  accountCode: string | null   // resolved from "Account Code" column
  accountName: string | null   // fallback if no code
}

export interface MappedBill {
  externalBillId: string       // Zoho Bill ID
  billNumber: string
  vendorName: string
  billDate: string             // ISO date string
  dueDate: string              // ISO date string
  status: ZohoBillStatus
  currency: string
  exchangeRate: number
  subtotal: number
  taxAmount: number
  totalAmount: number
  amountPaid: number
  purchaseOrderNumber: string | null
  notes: string | null
  campaignRef: string | null   // raw value from Campaigns / Campaign Outlet col
  lines: MappedBillLine[]
}

/** Normalise a CSV header: lowercase, collapse whitespace + special chars */
function normaliseKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[&]/g, "and")
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

function mapStatus(raw: string): ZohoBillStatus {
  const s = raw.toLowerCase().replace(/\s+/g, "")
  if (s === "paid") return "PAID"
  if (s === "overdue") return "OVERDUE"
  if (s.includes("partial")) return "PARTIAL"
  if (s === "draft") return "DRAFT"
  return "RECORDED"
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

/** Parse a Zoho bill CSV string and return grouped bills. */
export function parseZohoBillCsv(csvText: string): {
  bills: MappedBill[]
  skipped: number
} {
  const lines = csvText.split(/\r?\n/)
  if (lines.length < 2) return { bills: [], skipped: 0 }

  const delimiter = lines[0].includes("\t") ? "\t" : ","
  const rawHeaders = lines[0].split(delimiter).map((h) => h.replace(/^"|"$/g, "").trim())
  const headers = rawHeaders.map(normaliseKey)

  // Collect raw rows
  const rawRows: Record<string, string>[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const values = splitLine(line, delimiter)
    const row: Record<string, string> = {}
    headers.forEach((h, idx) => {
      row[h] = (values[idx] ?? "").replace(/^"|"$/g, "").trim()
    })
    rawRows.push(row)
  }

  // Group by Bill ID
  const grouped = new Map<string, Record<string, string>[]>()
  let skipped = 0

  for (const row of rawRows) {
    const billId =
      cell(row, "bill_id") ||
      cell(row, "billid") ||
      cell(row, "bill_number")   // fallback
    if (!billId) { skipped++; continue }
    if (!grouped.has(billId)) grouped.set(billId, [])
    grouped.get(billId)!.push(row)
  }

  const bills: MappedBill[] = []

  for (const [billId, rows] of Array.from(grouped.entries())) {
    const h = rows[0]  // bill header comes from the first row

    const vendorName = cell(h, "vendor_name")
    if (!vendorName) { skipped += rows.length; continue }

    const subtotal    = parseFloat(cell(h, "subtotal"))    || 0
    const total       = parseFloat(cell(h, "total"))       || 0
    const balance     = parseFloat(cell(h, "balance"))     || 0
    const amountPaid  = Math.max(0, total - balance)

    // Tax = total - subtotal (Zoho includes tax in total)
    const taxAmount   = Math.max(0, total - subtotal)

    // Campaign: try "campaigns" col first, then "campaign_outlet"
    const campaignRef =
      cell(h, "campaigns") ||
      cell(h, "campaign_outlet") ||
      null

    const lines: MappedBillLine[] = rows
      .map((r: Record<string, string>) => {
        const desc    = cell(r, "description") || cell(r, "item_name") || "—"
        const qty     = parseFloat(cell(r, "quantity"))   || 1
        const rate    = parseFloat(cell(r, "rate"))       || 0
        const amt     = parseFloat(cell(r, "item_total")) || rate * qty
        const tax     = parseFloat(cell(r, "tax_amount")) || 0
        const acCode  = cell(r, "account_code") || null
        const acName  = cell(r, "account")      || null
        return { description: desc, quantity: qty, rate, amount: amt, taxAmount: tax, accountCode: acCode, accountName: acName }
      })
      .filter((l: MappedBillLine) => l.amount !== 0 || l.description !== "—")

    bills.push({
      externalBillId: billId,
      billNumber: cell(h, "bill_number") || billId,
      vendorName,
      billDate: parseDate(cell(h, "bill_date")),
      dueDate:  parseDate(cell(h, "due_date")),
      status:   mapStatus(cell(h, "bill_status")),
      currency: cell(h, "currency_code") || "NGN",
      exchangeRate: parseFloat(cell(h, "exchange_rate")) || 1,
      subtotal,
      taxAmount,
      totalAmount: total,
      amountPaid,
      purchaseOrderNumber: cell(h, "purchaseorder") || cell(h, "purchase_order_number") || null,
      notes: cell(h, "vendor_notes") || null,
      campaignRef: campaignRef || null,
      lines,
    })
  }

  return { bills, skipped }
}
