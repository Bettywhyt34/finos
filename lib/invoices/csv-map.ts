// lib/invoices/csv-map.ts
// Bidirectional FINOS ↔ Zoho column mapping for invoice CSV import/export

// ─── Shared Types ─────────────────────────────────────────────────────────────

export interface InvoiceLineImport {
  description: string
  quantity: number
  rate: number
  taxRate: number
}

export interface InvoiceImportRecord {
  invoiceNumber: string
  invoiceDate: string       // YYYY-MM-DD
  dueDate: string           // YYYY-MM-DD
  customerName: string
  currency: string
  exchangeRate: number
  reference?: string        // PO number
  notes?: string
  discountAmount: number
  campaignId?: string       // Campaign identifier for campaign reports
  externalTxnId?: string    // Deduplication key — prevents re-import of same record
  lines: InvoiceLineImport[]
}

// ─── Format Detection ─────────────────────────────────────────────────────────

export function detectInvoiceFormat(headers: string[]): "zoho" | "finos" {
  const set = new Set(headers.map((h) => h.toLowerCase().trim()))
  if (
    set.has("item price") ||
    set.has("purchaseorder") ||
    set.has("currency code") ||
    set.has("entity discount amount") ||
    set.has("item tax %")
  ) {
    return "zoho"
  }
  return "finos"
}

// ─── Date Normalisation ───────────────────────────────────────────────────────

const MONTH_NAMES: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
}

function expandYear(y: string): string {
  if (y.length === 2) return parseInt(y) < 30 ? `20${y}` : `19${y}`
  return y
}

// Scan all rows to detect whether numeric dates are MM/DD or DD/MM.
// Strategy: if ANY date has a second numeric part > 12, it can't be a month
// so the whole file must be MM/DD/YYYY.
export function sniffDateOrder(
  rows: Record<string, string>[],
  cols: string[]
): "mdy" | "dmy" {
  for (const row of rows) {
    for (const col of cols) {
      const v = (row[col] ?? "").trim()
      const m = v.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-]/)
      if (m && parseInt(m[2]) > 12) return "mdy"
    }
  }
  return "dmy" // default: DD/MM/YYYY
}

// Handles: "27/04/2022", "2022-04-27", "Apr 27 2022", "27-Apr-2022",
//          "27 Apr 2022", "Apr 27, 2022", "27-Apr-22", ISO strings,
//          and MM/DD/YYYY when dateOrder="mdy"
export function normaliseDate(
  raw: string | undefined | null,
  dateOrder: "dmy" | "mdy" = "dmy"
): string {
  if (!raw?.trim()) return new Date().toISOString().split("T")[0]
  const s = raw.trim()

  // Already ISO YYYY-MM-DD (with optional time component)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)

  // Numeric date: X/Y/YYYY or X-Y-YYYY
  const num = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/)
  if (num) {
    const a = parseInt(num[1])
    const b = parseInt(num[2])
    const y = expandYear(num[3])
    // b > 12 → b can't be a month → unambiguously MM/DD/YYYY
    // Otherwise follow the file-level hint
    const useMdy = b > 12 || (a <= 12 && b <= 12 && dateOrder === "mdy")
    if (useMdy) {
      return `${y}-${num[1].padStart(2, "0")}-${num[2].padStart(2, "0")}`
    }
    return `${y}-${num[2].padStart(2, "0")}-${num[1].padStart(2, "0")}`
  }

  // DD-Mon-YYYY or DD-Mon-YY  e.g. "26-May-2026", "26-May-26"
  const dmony = s.match(/^(\d{1,2})[\-\s]([A-Za-z]{3,9})[\-\s,\s]*(\d{2,4})/)
  if (dmony) {
    const mon = MONTH_NAMES[dmony[2].slice(0, 3).toLowerCase()]
    if (mon) {
      const y = expandYear(dmony[3])
      return `${y}-${mon}-${dmony[1].padStart(2, "0")}`
    }
  }

  // Mon DD YYYY or Mon DD, YYYY  e.g. "May 26 2026", "May 26, 2026"
  const mdy = s.match(/^([A-Za-z]{3,9})[\s\-,]+(\d{1,2})[,\s]+(\d{2,4})/)
  if (mdy) {
    const mon = MONTH_NAMES[mdy[1].slice(0, 3).toLowerCase()]
    if (mon) {
      const y = expandYear(mdy[3])
      return `${y}-${mon}-${mdy[2].padStart(2, "0")}`
    }
  }

  // Fallback: let JS parse it
  const parsed = new Date(s)
  if (!isNaN(parsed.getTime())) return parsed.toISOString().split("T")[0]

  // Return sentinel so caller can detect failure instead of silently using today
  return "__invalid__"
}

export function isValidNormalisedDate(d: string): boolean {
  return d !== "__invalid__" && !isNaN(new Date(d).getTime())
}

// ─── Zoho Row Grouper ─────────────────────────────────────────────────────────
// Zoho exports one row per line item. Group them by invoice number.

export function groupZohoRows(
  rows: Record<string, string>[]
): InvoiceImportRecord[] {
  const dateOrder = sniffDateOrder(rows, ["Invoice Date", "Due Date"])
  const grouped = new Map<string, { header: Record<string, string>; lines: Record<string, string>[] }>()

  for (const row of rows) {
    const num = (row["Invoice Number"] ?? row["invoice number"] ?? "").trim()
    if (!num) continue

    if (!grouped.has(num)) {
      grouped.set(num, { header: row, lines: [] })
    }
    // Only add as a line if it has item data
    const desc = (row["Item Desc"] ?? row["Item Name"] ?? "").trim()
    const qty = row["Quantity"]?.trim()
    const price = row["Item Price"]?.trim()
    if (desc || (qty && price)) {
      grouped.get(num)!.lines.push(row)
    }
  }

  const records: InvoiceImportRecord[] = []

  for (const [invoiceNumber, { header, lines }] of Array.from(grouped.entries())) {
    const customerName = header["Customer Name"]?.trim() ?? ""
    const currency = header["Currency Code"]?.trim() || "NGN"
    const exchangeRate = parseFloat(header["Exchange Rate"] ?? "1") || 1
    const reference = header["PurchaseOrder"]?.trim() || undefined
    const subject = header["Subject"]?.trim() || ""
    const notes = header["Notes"]?.trim() || ""
    const combinedNotes = subject && notes
      ? `${subject}\n${notes}`
      : subject || notes || undefined

    // Discount: entity level — percent or absolute
    let discountAmount = 0
    const discAmt = parseFloat(header["Entity Discount Amount"] ?? "0")
    const discPct = parseFloat(header["Entity Discount Percent"] ?? "0")
    if (discAmt > 0) {
      discountAmount = discAmt
    } else if (discPct > 0) {
      const subtotal = lines.reduce((s: number, l: Record<string, string>) => {
        const q = parseFloat(l["Quantity"] ?? "1") || 1
        const p = parseFloat(l["Item Price"] ?? "0") || 0
        return s + q * p
      }, 0)
      discountAmount = subtotal * (discPct / 100)
    }

    const mappedLines: InvoiceLineImport[] = lines
      .map((l: Record<string, string>) => {
        const desc = (l["Item Desc"] ?? l["Item Name"] ?? "").trim()
        const qty = parseFloat(l["Quantity"] ?? "1") || 1
        const rate = parseFloat(l["Item Price"] ?? "0") || 0
        const taxRate = parseFloat(l["Item Tax %"] ?? "0") || 0
        if (!desc && rate === 0) return null
        return { description: desc || "Service", quantity: qty, rate, taxRate }
      })
      .filter((l): l is InvoiceLineImport => l !== null)

    if (mappedLines.length === 0) {
      mappedLines.push({ description: "Services Rendered", quantity: 1, rate: 0, taxRate: 0 })
    }

    const campaignId = header["Campaign ID"]?.trim() || undefined
    const externalTxnId = header["Transaction ID"]?.trim() || undefined

    records.push({
      invoiceNumber,
      invoiceDate: normaliseDate(header["Invoice Date"] ?? "", dateOrder),
      dueDate: normaliseDate(header["Due Date"] ?? header["Invoice Date"] ?? "", dateOrder),
      customerName,
      currency,
      exchangeRate,
      reference,
      notes: combinedNotes,
      discountAmount,
      campaignId,
      externalTxnId,
      lines: mappedLines,
    })
  }

  return records
}

// ─── FINOS Row Grouper ────────────────────────────────────────────────────────

export function groupFinosRows(
  rows: Record<string, string>[]
): InvoiceImportRecord[] {
  const dateOrder = sniffDateOrder(rows, ["Invoice Date", "Due Date"])
  const grouped = new Map<string, { header: Record<string, string>; lines: Record<string, string>[] }>()

  for (const row of rows) {
    const num = (row["Invoice Number"] ?? "").trim()
    if (!num) continue
    if (!grouped.has(num)) {
      grouped.set(num, { header: row, lines: [] })
    }
    const desc = (row["Line Description"] ?? "").trim()
    const qty = row["Quantity"]?.trim()
    const rate = row["Unit Rate"]?.trim()
    if (desc || qty || rate) {
      grouped.get(num)!.lines.push(row)
    }
  }

  const records: InvoiceImportRecord[] = []

  for (const [invoiceNumber, { header, lines }] of Array.from(grouped.entries())) {
    const mappedLines: InvoiceLineImport[] = lines
      .map((l: Record<string, string>) => ({
        description: (l["Line Description"] ?? "").trim() || "Service",
        quantity: parseFloat(l["Quantity"] ?? "1") || 1,
        rate: parseFloat(l["Unit Rate"] ?? "0") || 0,
        taxRate: parseFloat(l["Tax Rate %"] ?? "0") || 0,
      }))
      .filter((l: InvoiceLineImport) => l.description || l.rate > 0)

    if (mappedLines.length === 0) continue

    records.push({
      invoiceNumber,
      invoiceDate: normaliseDate(header["Invoice Date"] ?? "", dateOrder),
      dueDate: normaliseDate(header["Due Date"] ?? "", dateOrder),
      customerName: (header["Customer Name"] ?? "").trim(),
      currency: (header["Currency"] ?? "NGN").trim(),
      exchangeRate: parseFloat(header["Exchange Rate"] ?? "1") || 1,
      reference: header["PO Number"]?.trim() || undefined,
      notes: header["Notes"]?.trim() || undefined,
      discountAmount: parseFloat(header["Discount Amount"] ?? "0") || 0,
      campaignId: header["Campaign ID"]?.trim() || undefined,
      externalTxnId: header["Transaction ID"]?.trim() || undefined,
      lines: mappedLines,
    })
  }

  return records
}

// ─── FINOS Export Headers ─────────────────────────────────────────────────────

export const FINOS_INVOICE_HEADERS = [
  "Invoice Number",
  "Invoice Date",
  "Due Date",
  "Status",
  "Customer Name",
  "Currency",
  "Exchange Rate",
  "PO Number",
  "Campaign ID",
  "Transaction ID",
  "Notes",
  "Discount Amount",
  "Line Description",
  "Quantity",
  "Unit Rate",
  "Tax Rate %",
  "Line Amount",
  "Invoice Total",
  "Amount Paid",
  "Balance Due",
] as const

// ─── Zoho Export Headers (signal columns only — keeps the export practical) ──

export const ZOHO_INVOICE_HEADERS = [
  "Invoice ID",
  "Invoice Number",
  "Invoice Date",
  "Due Date",
  "Invoice Status",
  "Customer Name",
  "Currency Code",
  "Exchange Rate",
  "PurchaseOrder",
  "Subject",
  "Notes",
  "Entity Discount Amount",
  "Entity Discount Percent",
  "Is Discount Before Tax",
  "Payment Terms",
  "Payment Terms Label",
  "SubTotal",
  "Total",
  "Balance",
  "Adjustment",
  "Billing Address",
  "Billing City",
  "Billing State",
  "Billing Country",
  "Billing Code",
  "Item Name",
  "Item Desc",
  "Quantity",
  "Item Price",
  "Item Total",
  "Discount",
  "Discount Amount",
  "Item Tax",
  "Item Tax %",
  "Item Tax Amount",
  "Account",
] as const

// ─── DB Record → Export Row ───────────────────────────────────────────────────

type InvoiceExportRecord = {
  id: string
  invoiceNumber: string
  issueDate: Date
  dueDate: Date
  status: string
  currency: string
  exchangeRate: { toString(): string }
  reference?: string | null
  notes?: string | null
  campaignId?: string | null
  externalTxnId?: string | null
  subtotal: { toString(): string }
  discountAmount: { toString(): string }
  taxAmount: { toString(): string }
  totalAmount: { toString(): string }
  amountPaid: { toString(): string }
  balanceDue: { toString(): string }
  paymentTerms?: number
  customer: {
    companyName: string
    billingAddress?: string | null
    billingCity?: string | null
    billingState?: string | null
    billingCountry?: string | null
    billingPostalCode?: string | null
    paymentTerms: number
  }
  lines: Array<{
    description: string
    quantity: { toString(): string }
    rate: { toString(): string }
    amount: { toString(): string }
    taxRate: { toString(): string }
  }>
}

function reversePaymentTerms(days: number): string {
  if (days === 0) return "Due on Receipt"
  return `Net ${days}`
}

const ZOHO_STATUS_MAP: Record<string, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  PARTIAL: "Partial",
  PAID: "Paid",
  OVERDUE: "Overdue",
  WRITTEN_OFF: "Void",
}

export function invoiceToFinosRows(inv: InvoiceExportRecord): Record<string, string>[] {
  return inv.lines.map((line) => ({
    "Invoice Number": inv.invoiceNumber,
    "Invoice Date": inv.issueDate.toISOString().split("T")[0],
    "Due Date": inv.dueDate.toISOString().split("T")[0],
    "Status": inv.status,
    "Customer Name": inv.customer.companyName,
    "Currency": inv.currency,
    "Exchange Rate": inv.exchangeRate.toString(),
    "PO Number": inv.reference ?? "",
    "Campaign ID": inv.campaignId ?? "",
    "Transaction ID": inv.externalTxnId ?? "",
    "Notes": inv.notes ?? "",
    "Discount Amount": inv.discountAmount.toString(),
    "Line Description": line.description,
    "Quantity": line.quantity.toString(),
    "Unit Rate": line.rate.toString(),
    "Tax Rate %": line.taxRate.toString(),
    "Line Amount": line.amount.toString(),
    "Invoice Total": inv.totalAmount.toString(),
    "Amount Paid": inv.amountPaid.toString(),
    "Balance Due": inv.balanceDue.toString(),
  }))
}

export function invoiceToZohoRows(inv: InvoiceExportRecord): Record<string, string>[] {
  const terms = inv.customer.paymentTerms
  const subtotal = parseFloat(inv.subtotal.toString())

  return inv.lines.map((line, idx) => {
    const row: Record<string, string> = {}
    for (const h of ZOHO_INVOICE_HEADERS) row[h] = ""

    // Header fields — same on every line row
    row["Invoice ID"] = inv.id
    row["Invoice Number"] = inv.invoiceNumber
    row["Invoice Date"] = inv.issueDate.toISOString().split("T")[0]
    row["Due Date"] = inv.dueDate.toISOString().split("T")[0]
    row["Invoice Status"] = ZOHO_STATUS_MAP[inv.status] ?? inv.status
    row["Customer Name"] = inv.customer.companyName
    row["Currency Code"] = inv.currency
    row["Exchange Rate"] = inv.exchangeRate.toString()
    row["PurchaseOrder"] = inv.reference ?? ""
    row["Notes"] = inv.notes ?? ""
    row["Entity Discount Amount"] = idx === 0 ? inv.discountAmount.toString() : ""
    row["Is Discount Before Tax"] = "false"
    row["Payment Terms"] = String(terms)
    row["Payment Terms Label"] = reversePaymentTerms(terms)
    row["SubTotal"] = idx === 0 ? subtotal.toFixed(2) : ""
    row["Total"] = idx === 0 ? inv.totalAmount.toString() : ""
    row["Balance"] = idx === 0 ? inv.balanceDue.toString() : ""
    row["Adjustment"] = "0"
    row["Billing Address"] = inv.customer.billingAddress ?? ""
    row["Billing City"] = inv.customer.billingCity ?? ""
    row["Billing State"] = inv.customer.billingState ?? ""
    row["Billing Country"] = inv.customer.billingCountry ?? ""
    row["Billing Code"] = inv.customer.billingPostalCode ?? ""

    // Line fields
    row["Item Name"] = line.description
    row["Item Desc"] = line.description
    row["Quantity"] = line.quantity.toString()
    row["Item Price"] = line.rate.toString()
    row["Item Total"] = line.amount.toString()
    row["Discount"] = "0"
    row["Discount Amount"] = "0"
    row["Item Tax"] = parseFloat(line.taxRate.toString()) > 0 ? "VAT" : ""
    row["Item Tax %"] = line.taxRate.toString()
    const lineAmt = parseFloat(line.amount.toString())
    const taxAmt = lineAmt * (parseFloat(line.taxRate.toString()) / 100)
    row["Item Tax Amount"] = taxAmt.toFixed(2)
    row["Account"] = "Revenue"

    return row
  })
}

// ─── CSV Serialiser ───────────────────────────────────────────────────────────

export function toCsv(
  headers: readonly string[],
  rows: Record<string, string>[]
): string {
  const escape = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`
  const headerLine = headers.map(escape).join(",")
  const dataLines = rows.map((r) =>
    headers.map((h) => escape(r[h] ?? "")).join(",")
  )
  return [headerLine, ...dataLines].join("\r\n")
}
