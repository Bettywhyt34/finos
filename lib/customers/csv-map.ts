// lib/customers/csv-map.ts
// Bidirectional FINOS ↔ Zoho column mapping for customer CSV import/export

export interface CustomerImportRow {
  customerCode: string
  companyName: string
  salutation?: string
  firstName?: string
  lastName?: string
  contactName?: string
  email?: string
  phone?: string
  mobile?: string
  website?: string
  currency?: string
  paymentTerms?: string
  creditLimit?: string
  openingBalance?: string
  customerSubType?: string
  isActive?: string
  billingAddress?: string
  billingCity?: string
  billingState?: string
  billingCountry?: string
  billingPostalCode?: string
}

// ─── Payment Terms ────────────────────────────────────────────────────────────

const PAYMENT_TERMS_LABEL_MAP: Record<string, number> = {
  "due on receipt": 0,
  "net 7": 7,
  "net 10": 10,
  "net 14": 14,
  "net 15": 15,
  "net 20": 20,
  "net 21": 21,
  "net 30": 30,
  "net 45": 45,
  "net 60": 60,
  "net 90": 90,
  "net 120": 120,
}

export function parsePaymentTerms(value: string): number {
  if (!value?.trim()) return 30
  const lower = value.trim().toLowerCase()
  if (lower in PAYMENT_TERMS_LABEL_MAP) return PAYMENT_TERMS_LABEL_MAP[lower]
  const n = parseInt(value, 10)
  return isNaN(n) ? 30 : n
}

export function reversePaymentTerms(days: number): string {
  if (days === 0) return "Due on Receipt"
  return `Net ${days}`
}

// ─── Format Detection ─────────────────────────────────────────────────────────

export function detectFormat(headers: string[]): "zoho" | "finos" {
  const set = new Set(headers.map((h) => h.toLowerCase().trim()))
  if (
    set.has("display name") ||
    set.has("billing attention") ||
    set.has("contact type") ||
    set.has("emailid")
  ) {
    return "zoho"
  }
  return "finos"
}

// ─── Customer Code Generator ──────────────────────────────────────────────────

export function generateCustomerCode(
  companyName: string,
  existing: Set<string>
): string {
  const words = companyName
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
  const base =
    words
      .slice(0, 3)
      .map((w) => w.slice(0, 3).toUpperCase())
      .join("") || "CUST"

  if (!existing.has(base)) {
    existing.add(base)
    return base
  }
  let i = 2
  while (existing.has(`${base}${i}`)) i++
  const code = `${base}${i}`
  existing.add(code)
  return code
}

// ─── Zoho Row → CustomerImportRow ─────────────────────────────────────────────

export function mapZohoRow(
  row: Record<string, string>,
  codeSet: Set<string>
): CustomerImportRow {
  const displayName = row["Display Name"]?.trim() || ""
  const companyName = row["Company Name"]?.trim() || displayName

  const code = generateCustomerCode(companyName || displayName, codeSet)

  return {
    customerCode: code,
    companyName: companyName || displayName,
    salutation: row["Salutation"]?.trim() || undefined,
    firstName: row["First Name"]?.trim() || undefined,
    lastName: row["Last Name"]?.trim() || undefined,
    contactName: row["Contact Name"]?.trim() || undefined,
    email: row["EmailID"]?.trim() || undefined,
    phone: row["Phone"]?.trim() || undefined,
    mobile: row["MobilePhone"]?.trim() || undefined,
    website: row["Website"]?.trim() || undefined,
    currency: row["Currency Code"]?.trim() || "NGN",
    paymentTerms: row["Payment Terms Label"]?.trim() || row["Payment Terms"]?.trim() || "30",
    creditLimit: row["Credit Limit"]?.trim() || undefined,
    openingBalance: row["Opening Balance"]?.trim() || undefined,
    customerSubType: row["Customer Sub Type"]?.trim() || "business",
    isActive: row["Status"]?.trim().toLowerCase() === "inactive" ? "false" : "true",
    billingAddress: row["Billing Address"]?.trim() || undefined,
    billingCity: row["Billing City"]?.trim() || undefined,
    billingState: row["Billing State"]?.trim() || undefined,
    billingCountry: row["Billing Country"]?.trim() || undefined,
    billingPostalCode: row["Billing Code"]?.trim() || undefined,
  }
}

// ─── FINOS Row → CustomerImportRow ───────────────────────────────────────────

export function mapFinosRow(row: Record<string, string>): CustomerImportRow {
  return {
    customerCode: row["Customer Code"]?.trim() || "",
    companyName: row["Company Name"]?.trim() || "",
    salutation: row["Salutation"]?.trim() || undefined,
    firstName: row["First Name"]?.trim() || undefined,
    lastName: row["Last Name"]?.trim() || undefined,
    contactName: row["Contact Name"]?.trim() || undefined,
    email: row["Email"]?.trim() || undefined,
    phone: row["Phone"]?.trim() || undefined,
    mobile: row["Mobile"]?.trim() || undefined,
    website: row["Website"]?.trim() || undefined,
    currency: row["Currency"]?.trim() || "NGN",
    paymentTerms: row["Payment Terms (days)"]?.trim() || "30",
    creditLimit: row["Credit Limit"]?.trim() || undefined,
    openingBalance: row["Opening Balance"]?.trim() || undefined,
    customerSubType: row["Customer Sub Type"]?.trim() || "business",
    isActive: row["Status"]?.trim().toLowerCase() === "inactive" ? "false" : "true",
    billingAddress: row["Billing Address"]?.trim() || undefined,
    billingCity: row["Billing City"]?.trim() || undefined,
    billingState: row["Billing State"]?.trim() || undefined,
    billingCountry: row["Billing Country"]?.trim() || undefined,
    billingPostalCode: row["Billing Postal Code"]?.trim() || undefined,
  }
}

// ─── FINOS Export Headers ─────────────────────────────────────────────────────

export const FINOS_CSV_HEADERS = [
  "Customer Code",
  "Company Name",
  "Salutation",
  "First Name",
  "Last Name",
  "Contact Name",
  "Email",
  "Phone",
  "Mobile",
  "Website",
  "Currency",
  "Payment Terms (days)",
  "Credit Limit",
  "Opening Balance",
  "Customer Sub Type",
  "Status",
  "Billing Address",
  "Billing City",
  "Billing State",
  "Billing Country",
  "Billing Postal Code",
] as const

// ─── Zoho Export Headers (all 70, in canonical order) ────────────────────────

export const ZOHO_CSV_HEADERS = [
  "Created Time",
  "Last Modified Time",
  "Display Name",
  "Company Name",
  "Salutation",
  "First Name",
  "Last Name",
  "Phone",
  "Currency Code",
  "Notes",
  "Website",
  "Status",
  "Created By",
  "Accounts Receivable",
  "Opening Balance",
  "Opening Balance Exchange Rate",
  "Bank Account Payment",
  "Portal Enabled",
  "Credit Limit",
  "Customer Sub Type",
  "Billing Attention",
  "Billing Address",
  "Billing Street2",
  "Billing City",
  "Billing State",
  "Billing Country",
  "Billing County",
  "Billing Code",
  "Billing Phone",
  "Billing Fax",
  "Billing Latitude",
  "Billing Longitude",
  "Shipping Attention",
  "Shipping Address",
  "Shipping Street2",
  "Shipping City",
  "Shipping State",
  "Shipping Country",
  "Shipping County",
  "Shipping Code",
  "Shipping Phone",
  "Shipping Fax",
  "Shipping Latitude",
  "Shipping Longitude",
  "Skype Identity",
  "Facebook",
  "Twitter",
  "Department",
  "Designation",
  "Price List",
  "Payment Terms",
  "Payment Terms Label",
  "Tax Type",
  "Last Sync Time",
  "Owner Name",
  "Primary Contact ID",
  "EmailID",
  "MobilePhone",
  "Contact ID",
  "Contact Name",
  "Contact Type",
  "Taxable",
  "Tax Name",
  "Tax Percentage",
  "Contact Address ID",
  "Source",
  "Campaign Outlet",
  "Campaigns",
  "SIRET",
  "Company ID",
] as const

// ─── DB Record → Export Row ───────────────────────────────────────────────────

type CustomerExportRecord = {
  id: string
  customerCode: string
  companyName: string
  salutation?: string | null
  firstName?: string | null
  lastName?: string | null
  contactName?: string | null
  email?: string | null
  phone?: string | null
  mobile?: string | null
  website?: string | null
  currency: string
  paymentTerms: number
  creditLimit?: { toString(): string } | null
  openingBalance?: { toString(): string } | null
  customerSubType?: string | null
  isActive: boolean
  billingAddress?: string | null
  billingCity?: string | null
  billingState?: string | null
  billingCountry?: string | null
  billingPostalCode?: string | null
  createdAt: Date
}

export function customerToFinosRow(c: CustomerExportRecord): Record<string, string> {
  return {
    "Customer Code": c.customerCode,
    "Company Name": c.companyName,
    "Salutation": c.salutation ?? "",
    "First Name": c.firstName ?? "",
    "Last Name": c.lastName ?? "",
    "Contact Name": c.contactName ?? "",
    "Email": c.email ?? "",
    "Phone": c.phone ?? "",
    "Mobile": c.mobile ?? "",
    "Website": c.website ?? "",
    "Currency": c.currency || "NGN",
    "Payment Terms (days)": String(c.paymentTerms),
    "Credit Limit": c.creditLimit ? c.creditLimit.toString() : "",
    "Opening Balance": c.openingBalance ? c.openingBalance.toString() : "",
    "Customer Sub Type": c.customerSubType ?? "business",
    "Status": c.isActive ? "Active" : "Inactive",
    "Billing Address": c.billingAddress ?? "",
    "Billing City": c.billingCity ?? "",
    "Billing State": c.billingState ?? "",
    "Billing Country": c.billingCountry ?? "",
    "Billing Postal Code": c.billingPostalCode ?? "",
  }
}

export function customerToZohoRow(c: CustomerExportRecord): Record<string, string> {
  const row: Record<string, string> = {}
  for (const h of ZOHO_CSV_HEADERS) row[h] = ""

  row["Created Time"] = c.createdAt.toISOString()
  row["Last Modified Time"] = c.createdAt.toISOString()
  row["Display Name"] = c.companyName
  row["Company Name"] = c.companyName
  row["Salutation"] = c.salutation ?? ""
  row["First Name"] = c.firstName ?? ""
  row["Last Name"] = c.lastName ?? ""
  row["Phone"] = c.phone ?? ""
  row["Currency Code"] = c.currency || "NGN"
  row["Website"] = c.website ?? ""
  row["Status"] = c.isActive ? "Active" : "Inactive"
  row["Opening Balance"] = c.openingBalance ? c.openingBalance.toString() : "0"
  row["Opening Balance Exchange Rate"] = "1"
  row["Credit Limit"] = c.creditLimit ? c.creditLimit.toString() : "0"
  row["Customer Sub Type"] = c.customerSubType ?? "business"
  row["Billing Address"] = c.billingAddress ?? ""
  row["Billing City"] = c.billingCity ?? ""
  row["Billing State"] = c.billingState ?? ""
  row["Billing Country"] = c.billingCountry ?? ""
  row["Billing Code"] = c.billingPostalCode ?? ""
  row["Payment Terms"] = String(c.paymentTerms)
  row["Payment Terms Label"] = reversePaymentTerms(c.paymentTerms)
  row["EmailID"] = c.email ?? ""
  row["MobilePhone"] = c.mobile ?? ""
  row["Contact ID"] = c.id
  row["Contact Name"] = c.contactName ?? c.companyName
  row["Contact Type"] = "customer"
  row["Taxable"] = "TRUE"

  return row
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
