/**
 * Reporting Tags — shared types and constants.
 * Safe to import in both Server and Client Components.
 */
import type { ReportingTagEntityScope } from "@prisma/client";

// ─── Public row types ─────────────────────────────────────────────────────────

export type ReportingTagOptionRow = {
  id:          string;
  tagId:       string;
  tenantId:    string;
  name:        string;
  description: string | null;
  color:       string | null;
  sortOrder:   number;
  isActive:    boolean;
  createdAt:   Date;
  updatedAt:   Date;
};

export type ReportingTagRow = {
  id:          string;
  tenantId:    string;
  name:        string;
  description: string | null;
  color:       string | null;
  isActive:    boolean;
  isSystem:    boolean;
  appliesTo:   ReportingTagEntityScope[];
  options:     ReportingTagOptionRow[];
  createdAt:   Date;
  updatedAt:   Date;
};

// ─── Input types ──────────────────────────────────────────────────────────────

export type CreateReportingTagInput = {
  name:        string;
  description?: string;
  color?:       string;
  isActive?:    boolean;
  appliesTo?:   ReportingTagEntityScope[];
};

export type UpdateReportingTagInput = {
  name?:        string;
  description?: string;
  color?:       string;
  isActive?:    boolean;
  appliesTo?:   ReportingTagEntityScope[];
};

export type CreateReportingTagOptionInput = {
  name:         string;
  description?: string;
  color?:       string;
  sortOrder?:   number;
  isActive?:    boolean;
};

export type UpdateReportingTagOptionInput = {
  name?:        string;
  description?: string;
  color?:       string;
  sortOrder?:   number;
  isActive?:    boolean;
};

// ─── Scope labels ─────────────────────────────────────────────────────────────

export const SCOPE_LABELS: Record<ReportingTagEntityScope, string> = {
  SALES:       "Sales",
  PURCHASES:   "Purchases",
  BANKING:     "Banking",
  ACCOUNTING:  "Accounting",
  INVENTORY:   "Inventory",
  CONTACTS:    "Contacts",
  EXPENSES:    "Expenses",
};

export const ALL_SCOPES: ReportingTagEntityScope[] = [
  "SALES", "PURCHASES", "BANKING", "ACCOUNTING", "INVENTORY", "CONTACTS", "EXPENSES",
];
