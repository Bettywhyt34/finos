/**
 * Pure client-safe helpers for PDF templates.
 * No server-side imports — safe to use in "use client" components.
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

export type PdfTemplateRow = {
  id:              string;
  tenantId:        string;
  documentType:    string;
  name:            string;
  description:     string | null;
  layoutKey:       string;
  isSystem:        boolean;
  isDefault:       boolean;
  isActive:        boolean;
  config:          Record<string, unknown>;
  previewImageUrl: string | null;
  createdAt:       Date;
  updatedAt:       Date;
};

// ─── Document type display helpers ───────────────────────────────────────────

export const PDF_DOC_TYPE_LABELS: Record<string, string> = {
  ESTIMATE:               "Estimates",
  INVOICE:                "Invoices",
  SALES_RECEIPT:          "Sales Receipts",
  CREDIT_NOTE:            "Credit Notes",
  PAYMENT_RECEIPT:        "Payment Receipts",
  CUSTOMER_STATEMENT:     "Customer Statements",
  BILL:                   "Bills",
  VENDOR_CREDIT:          "Vendor Credits",
  VENDOR_PAYMENT:         "Vendor Payments",
  VENDOR_STATEMENT:       "Vendor Statements",
  JOURNAL:                "Journals",
  ADDITIONAL_INFORMATION: "Additional Information",
};

export const PDF_DOC_TYPE_SINGULAR: Record<string, string> = {
  ESTIMATE:               "Estimate",
  INVOICE:                "Invoice",
  SALES_RECEIPT:          "Sales Receipt",
  CREDIT_NOTE:            "Credit Note",
  PAYMENT_RECEIPT:        "Payment Receipt",
  CUSTOMER_STATEMENT:     "Customer Statement",
  BILL:                   "Bill",
  VENDOR_CREDIT:          "Vendor Credit",
  VENDOR_PAYMENT:         "Vendor Payment",
  VENDOR_STATEMENT:       "Vendor Statement",
  JOURNAL:                "Journal",
  ADDITIONAL_INFORMATION: "Additional Information",
};

export type PdfTemplateDocumentTypeValue =
  | "ESTIMATE" | "INVOICE" | "SALES_RECEIPT" | "CREDIT_NOTE"
  | "PAYMENT_RECEIPT" | "CUSTOMER_STATEMENT" | "BILL" | "VENDOR_CREDIT"
  | "VENDOR_PAYMENT" | "VENDOR_STATEMENT" | "JOURNAL" | "ADDITIONAL_INFORMATION";

export const PDF_DOC_TYPE_ORDER: PdfTemplateDocumentTypeValue[] = [
  "ESTIMATE",
  "INVOICE",
  "SALES_RECEIPT",
  "CREDIT_NOTE",
  "PAYMENT_RECEIPT",
  "CUSTOMER_STATEMENT",
  "BILL",
  "VENDOR_CREDIT",
  "VENDOR_PAYMENT",
  "VENDOR_STATEMENT",
  "JOURNAL",
  "ADDITIONAL_INFORMATION",
];

export const LAYOUT_KEYS: { value: string; label: string }[] = [
  { value: "standard", label: "Standard" },
  { value: "compact",  label: "Compact"  },
  { value: "modern",   label: "Modern"   },
  { value: "classic",  label: "Classic"  },
];
