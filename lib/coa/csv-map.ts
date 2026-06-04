// lib/coa/csv-map.ts
// Bidirectional FINOS ↔ Zoho column mapping for Chart of Accounts import/export

import type { AccountType, FinancialCategory } from "@prisma/client"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CoaImportRow {
  accountCode: string
  accountName: string
  accountType: AccountType
  financialCategory: FinancialCategory | null
  subtype: string | null
  parentAccountName: string | null   // resolved to ID server-side
  isActive: boolean
  currency: string | null
  description: string | null
  /** Original Zoho type string — kept for preview/warning display */
  rawZohoType?: string
  /** True if the Zoho type had no mapping */
  typeUnmapped?: boolean
}

// ─── Zoho → FINOS Type Map ────────────────────────────────────────────────────
// Keys are lowercased for case-insensitive matching

const ZOHO_TYPE_MAP: Record<string, { type: AccountType; category: FinancialCategory }> = {
  "income":                    { type: "INCOME",    category: "INCOME" },
  "other income":              { type: "INCOME",    category: "OTHER_INCOME" },
  "expense":                   { type: "EXPENSE",   category: "EXPENSES" },
  "other expense":             { type: "EXPENSE",   category: "OTHER_EXPENSES" },
  "cost of goods sold":        { type: "EXPENSE",   category: "COST_OF_SALES" },
  "cash":                      { type: "ASSET",     category: "CURRENT_ASSET" },
  "bank":                      { type: "ASSET",     category: "CURRENT_ASSET" },
  "accounts receivable":       { type: "ASSET",     category: "CURRENT_ASSET" },
  "other current asset":       { type: "ASSET",     category: "CURRENT_ASSET" },
  "fixed asset":               { type: "ASSET",     category: "NON_CURRENT_ASSET" },
  "other asset":               { type: "ASSET",     category: "NON_CURRENT_ASSET" },
  "stock":                     { type: "ASSET",     category: "CURRENT_ASSET" },
  "accounts payable":          { type: "LIABILITY", category: "CURRENT_LIABILITY" },
  "other current liability":   { type: "LIABILITY", category: "CURRENT_LIABILITY" },
  "other liability":           { type: "LIABILITY", category: "CURRENT_LIABILITY" },
  "non current liability":     { type: "LIABILITY", category: "NON_CURRENT_LIABILITY" },
  "equity":                    { type: "EQUITY",    category: "EQUITY" },
  "input tax":                 { type: "ASSET",     category: "CURRENT_ASSET" },
  "output tax":                { type: "LIABILITY", category: "CURRENT_LIABILITY" },
}

// ─── FINOS → Zoho Type Reverse Map ───────────────────────────────────────────
// Used for export. financialCategory takes priority, falls back to type.

const FINOS_TO_ZOHO_TYPE: Record<FinancialCategory | string, string> = {
  INCOME:                "Income",
  OTHER_INCOME:          "Other Income",
  COST_OF_SALES:         "Cost Of Goods Sold",
  DIRECT_EXPENSES:       "Expense",
  EXPENSES:              "Expense",
  OTHER_EXPENSES:        "Other Expense",
  CURRENT_ASSET:         "Other Current Asset",
  NON_CURRENT_ASSET:     "Fixed Asset",
  CURRENT_LIABILITY:     "Other Current Liability",
  NON_CURRENT_LIABILITY: "Non Current Liability",
  EQUITY:                "Equity",
  // Fallbacks by AccountType (when financialCategory is null)
  ASSET:                 "Other Current Asset",
  LIABILITY:             "Other Current Liability",
  EXPENSE:               "Expense",
}

export function zohoTypeToFinos(zohoType: string): {
  type: AccountType
  category: FinancialCategory | null
  unmapped: boolean
} {
  const mapped = ZOHO_TYPE_MAP[zohoType.toLowerCase().trim()]
  if (mapped) return { type: mapped.type, category: mapped.category, unmapped: false }
  // Unknown type — default to ASSET, no category, flag as unmapped
  return { type: "ASSET", category: null, unmapped: true }
}

export function finosToZohoType(
  type: AccountType,
  category: FinancialCategory | null
): string {
  if (category && category in FINOS_TO_ZOHO_TYPE) {
    return FINOS_TO_ZOHO_TYPE[category]
  }
  return FINOS_TO_ZOHO_TYPE[type] ?? "Other Current Asset"
}

// ─── Format Detection ─────────────────────────────────────────────────────────

export function detectCoaFormat(headers: string[]): "zoho" | "finos" {
  const set = new Set(headers.map((h) => h.toLowerCase().trim()))
  // Use only columns that are exclusive to Zoho exports.
  // "account type" and "parent account" appear in both formats — do NOT use them here.
  if (
    set.has("account id") ||          // Zoho internal ID column
    set.has("ismileage") ||            // Zoho mileage flag
    set.has("account status") ||       // Zoho uses "Account Status"; FINOS uses "Status"
    set.has("is system account")       // Zoho system account flag
  ) {
    return "zoho"
  }
  return "finos"
}

// ─── Zoho Row → CoaImportRow ──────────────────────────────────────────────────

export function mapZohoCoaRow(row: Record<string, string>): CoaImportRow {
  const zohoType = row["Account Type"]?.trim() ?? ""
  const { type, category, unmapped } = zohoTypeToFinos(zohoType)
  const status = (row["Account Status"] ?? row["Status"] ?? "active").toLowerCase().trim()

  return {
    accountCode: (row["Account Code"] ?? "").trim(),
    accountName: (row["Account Name"] ?? "").trim(),
    accountType: type,
    financialCategory: category,
    subtype: zohoType || null,          // store original Zoho type as subtype for reference
    parentAccountName: (row["Parent Account"] ?? "").trim() || null,
    isActive: status !== "inactive",
    currency: (row["Currency"] ?? "").trim() || null,
    description: (row["Description"] ?? "").trim() || null,
    rawZohoType: zohoType,
    typeUnmapped: unmapped,
  }
}

// ─── FINOS Row → CoaImportRow ─────────────────────────────────────────────────

const FINOS_TYPE_VALUES = new Set(["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"])
const FINOS_CATEGORY_VALUES = new Set<string>([
  "OTHER_INCOME", "INCOME", "COST_OF_SALES", "DIRECT_EXPENSES",
  "EXPENSES", "OTHER_EXPENSES", "CURRENT_ASSET", "NON_CURRENT_ASSET",
  "CURRENT_LIABILITY", "NON_CURRENT_LIABILITY", "EQUITY",
])

export function mapFinosCoaRow(row: Record<string, string>): CoaImportRow {
  const rawType = (row["Account Type"] ?? "").trim().toUpperCase()
  const type: AccountType = FINOS_TYPE_VALUES.has(rawType)
    ? (rawType as AccountType)
    : "ASSET"

  const rawCat = (row["Financial Category"] ?? "").trim().toUpperCase()
  const category: FinancialCategory | null = FINOS_CATEGORY_VALUES.has(rawCat)
    ? (rawCat as FinancialCategory)
    : null

  const status = (row["Status"] ?? "active").toLowerCase().trim()

  return {
    accountCode: (row["Account Code"] ?? "").trim(),
    accountName: (row["Account Name"] ?? "").trim(),
    accountType: type,
    financialCategory: category,
    subtype: (row["Subtype"] ?? "").trim() || null,
    parentAccountName: (row["Parent Account"] ?? "").trim() || null,
    isActive: status !== "inactive",
    currency: (row["Currency"] ?? "").trim() || null,
    description: (row["Description"] ?? "").trim() || null,
    typeUnmapped: !FINOS_TYPE_VALUES.has(rawType),
  }
}

// ─── Topological Sort (parents before children) ───────────────────────────────

export function topologicalSort(rows: CoaImportRow[]): CoaImportRow[] {
  const byName = new Map(
    rows.map((r) => [r.accountName.toLowerCase().trim(), r])
  )
  const visited = new Set<string>()
  const result: CoaImportRow[] = []

  function visit(row: CoaImportRow) {
    const key = row.accountName.toLowerCase().trim()
    if (visited.has(key)) return
    visited.add(key)          // mark early to break any cycles
    if (row.parentAccountName) {
      const parent = byName.get(row.parentAccountName.toLowerCase().trim())
      if (parent) visit(parent)
    }
    result.push(row)
  }

  for (const row of rows) {
    visit(row)
  }

  return result
}

// ─── FINOS Export Headers ─────────────────────────────────────────────────────

export const FINOS_COA_HEADERS = [
  "Account Code",
  "Account Name",
  "Account Type",
  "Financial Category",
  "Subtype",
  "Parent Account",
  "Status",
  "Currency",
  "Description",
] as const

// ─── Zoho Export Headers ──────────────────────────────────────────────────────

export const ZOHO_COA_HEADERS = [
  "Account Name",
  "Account Code",
  "Account Type",
  "Parent Account",
  "Account Status",
  "Currency",
  "Description",
] as const

// ─── DB Record → Export Row ───────────────────────────────────────────────────

type CoaExportRecord = {
  code: string
  name: string
  type: AccountType
  financialCategory: FinancialCategory | null
  subtype: string | null
  isActive: boolean
  parent: { name: string } | null
}

export function coaToFinosRow(a: CoaExportRecord): Record<string, string> {
  return {
    "Account Code":       a.code,
    "Account Name":       a.name,
    "Account Type":       a.type,
    "Financial Category": a.financialCategory ?? "",
    "Subtype":            a.subtype ?? "",
    "Parent Account":     a.parent?.name ?? "",
    "Status":             a.isActive ? "Active" : "Inactive",
    "Currency":           "",
    "Description":        "",
  }
}

export function coaToZohoRow(a: CoaExportRecord): Record<string, string> {
  return {
    "Account Name":   a.name,
    "Account Code":   a.code,
    "Account Type":   finosToZohoType(a.type, a.financialCategory),
    "Parent Account": a.parent?.name ?? "",
    "Account Status": a.isActive ? "Active" : "Inactive",
    "Currency":       "NGN",
    "Description":    a.subtype ?? "",
  }
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
