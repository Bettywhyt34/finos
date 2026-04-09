/**
 * XpenxFlow Common Data Model (CDM)
 *
 * These types mirror the exact table + column names that exist in the XpenxFlow
 * Supabase project.  Field names are derived from the XpenxFlow build document
 * and follow Supabase/PostgreSQL snake_case conventions.
 *
 * Rules:
 *   - All IDs are UUIDs stored as strings.
 *   - All monetary amounts are plain numbers (no rounding at this layer).
 *   - All dates are ISO 8601 strings; convert to Date objects in the processor.
 *   - Nullable fields are typed `T | null`.
 *   - Enums are typed as string unions — the processor must validate them.
 */

// ─── Vendors ──────────────────────────────────────────────────────────────────

export type XFVendorStatus = "active" | "inactive" | "suspended";

export interface XFVendor {
  id: string;
  vendor_code: string;            // e.g. "VND-001"
  name: string;
  email: string | null;
  phone: string | null;
  billing_address: string | null;
  currency: string;               // ISO 4217, e.g. "NGN"
  tax_identification_number: string | null;
  withholding_tax_applicable: boolean;
  withholding_tax_rate: number | null; // percentage, e.g. 5 = 5%
  payment_terms_days: number;     // default due date offset
  bank_name: string | null;
  bank_account_number: string | null;
  status: XFVendorStatus;
  created_at: string;
  updated_at: string;
}

// ─── Expense Categories ───────────────────────────────────────────────────────

export interface XFExpenseCategory {
  id: string;
  code: string;                   // e.g. "TRAVEL", "UTILITIES", "OFFICE_SUPPLIES"
  name: string;
  account_code: string;           // Maps to FINOS ChartOfAccounts.code
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Bills (vendor invoices / purchase invoices) ──────────────────────────────

export type XFBillStatus = "draft" | "approved" | "paid" | "partial" | "overdue" | "cancelled";

export interface XFBillLine {
  id: string;
  bill_id: string;
  line_number: number;
  description: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;        // line-level discount
  tax_amount: number;             // line-level tax (VAT / WHT excluded at header level)
  net_amount: number;             // (quantity * unit_price) - discount + tax
  account_code: string;           // expense account code — maps to ChartOfAccounts
  category_id: string | null;     // FK to xf_expense_categories
  item_code: string | null;       // internal item reference
}

export interface XFBill {
  id: string;
  bill_number: string;            // e.g. "BILL-2024-0042"
  vendor_id: string;              // FK to xf_vendors
  bill_date: string;              // ISO date, e.g. "2024-03-15"
  due_date: string;               // ISO date
  currency: string;
  exchange_rate: number;          // to NGN
  subtotal: number;               // sum of line net_amounts
  discount_amount: number;        // header-level discount
  tax_amount: number;             // VAT
  total_amount: number;           // subtotal - discount + tax
  status: XFBillStatus;
  notes: string | null;
  purchase_order_number: string | null;
  recognition_period: string | null; // YYYY-MM (IFRS 15, populated by XpenxFlow)
  lines: XFBillLine[];
  created_at: string;
  updated_at: string;
}

// ─── Expense Claims (employee-submitted expenses) ─────────────────────────────

export type XFExpenseStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "reimbursed"
  | "cancelled";

export interface XFExpense {
  id: string;
  expense_number: string;         // e.g. "EXP-2024-0099"
  employee_id: string;            // Internal employee ID in XpenxFlow
  employee_name: string;          // Denormalised for display
  category_id: string;            // FK to xf_expense_categories
  expense_date: string;           // ISO date
  description: string;
  amount: number;                 // pre-tax amount
  tax_amount: number;
  total_amount: number;           // amount + tax_amount
  currency: string;
  exchange_rate: number;          // to NGN
  receipt_url: string | null;
  status: XFExpenseStatus;
  approved_by: string | null;     // Approver name / ID
  approved_at: string | null;     // ISO datetime
  reimbursed_at: string | null;   // ISO datetime
  created_at: string;
  updated_at: string;
}

// ─── Vendor Payments ──────────────────────────────────────────────────────────

export type XFPaymentMethod =
  | "bank_transfer"
  | "cheque"
  | "cash"
  | "card"
  | "online";

export interface XFVendorPaymentAllocation {
  bill_id: string;
  bill_number: string;
  amount_allocated: number;       // portion of this payment against this bill
}

export interface XFVendorPayment {
  id: string;
  payment_number: string;         // e.g. "PAY-2024-0031"
  vendor_id: string;              // FK to xf_vendors
  payment_date: string;           // ISO date
  currency: string;
  exchange_rate: number;
  gross_amount: number;           // total before WHT
  withholding_tax_amount: number; // WHT deducted at source
  net_paid: number;               // gross_amount - withholding_tax_amount
  payment_method: XFPaymentMethod;
  bank_account_code: string;      // Maps to FINOS BankAccount (by account number or code)
  reference: string | null;       // cheque number / transfer reference
  allocations: XFVendorPaymentAllocation[];
  created_at: string;
  updated_at: string;
}

// ─── Journal Entries (from XpenxFlow GL) ─────────────────────────────────────

export interface XFJournalLine {
  id:           string;
  account_code: string;
  description?: string;
  debit:        number;
  credit:       number;
}

export interface XFJournal {
  id:                  string;
  journal_number:      string;
  date:                string;              // ISO date
  description:         string;
  recognition_period?: string | null;       // YYYY-MM
  reference?:          string | null;
  lines:               XFJournalLine[];
  created_at:          string;
  updated_at:          string;
}

// ─── Assets ───────────────────────────────────────────────────────────────────

export type XFDepreciationMethod = "straight_line" | "declining_balance" | "units_of_production";
export type XFAssetStatus = "active" | "disposed" | "fully_depreciated";

export interface XFAsset {
  id:                        string;
  asset_code:                string;
  name:                      string;
  category:                  string;
  acquisition_date:          string;        // ISO date
  acquisition_cost:          number;
  currency:                  string;
  exchange_rate:             number;
  useful_life_years:         number;
  depreciation_method:       XFDepreciationMethod;
  accumulated_depreciation:  number;
  book_value:                number;
  account_code:              string;        // Maps to FINOS ChartOfAccounts.code
  status:                    XFAssetStatus;
  notes?:                    string | null;
  created_at:                string;
  updated_at:                string;
}

// ─── Budgets ──────────────────────────────────────────────────────────────────

export interface XFBudgetLine {
  account_code:    string;
  month:           string;                  // YYYY-MM
  budgeted_amount: number;
  currency?:       string;
}

export interface XFBudget {
  id:          string;
  budget_name: string;
  fiscal_year: number;
  currency:    string;
  lines:       XFBudgetLine[];
  created_at:  string;
  updated_at:  string;
}

// ─── Incremental sync cursor ──────────────────────────────────────────────────

/**
 * The sync cursor for XpenxFlow uses a single ISO timestamp (updated_at).
 * All tables are queried with `updated_at > cursor`.
 */
export interface XFSyncCursor {
  since: string; // ISO datetime, e.g. "2024-01-01T00:00:00.000Z"
}

/**
 * Parse a raw cursor string (stored in IntegrationConnection.lastSyncCursor)
 * into a typed XFSyncCursor. Returns epoch start for full syncs.
 */
export function parseCursor(raw: string | undefined | null): XFSyncCursor {
  if (!raw) return { since: "1970-01-01T00:00:00.000Z" };
  try {
    return JSON.parse(raw) as XFSyncCursor;
  } catch {
    // Backwards compat: raw value may be a plain ISO string
    return { since: raw };
  }
}

/**
 * Serialises a cursor for storage in IntegrationConnection.lastSyncCursor.
 */
export function stringifyCursor(cursor: XFSyncCursor): string {
  return JSON.stringify(cursor);
}
