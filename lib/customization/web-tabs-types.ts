/**
 * Web Tabs — shared types, constants, and pure validation.
 * Safe to import in both Server and Client Components.
 */
import type { WebTabType, WebTabPlacement } from "@prisma/client";

// ─── Public row types ─────────────────────────────────────────────────────────

export type WebTabRow = {
  id:             string;
  tenantId:       string;
  name:           string;
  description:    string | null;
  type:           WebTabType;
  url:            string;
  placement:      WebTabPlacement;
  icon:           string | null;
  sortOrder:      number;
  visibleToRoles: string[];
  isActive:       boolean;
  isSystem:       boolean;
  isConnected:    boolean;
  createdAt:      Date;
  updatedAt:      Date;
};

// ─── Input types ──────────────────────────────────────────────────────────────

export type CreateWebTabInput = {
  name:            string;
  description?:    string;
  type:            WebTabType;
  url:             string;
  placement?:      WebTabPlacement;
  icon?:           string;
  sortOrder?:      number;
  visibleToRoles?: string[];
  isActive?:       boolean;
};

export type UpdateWebTabInput = {
  name?:           string;
  description?:    string;
  type?:           WebTabType;
  url?:            string;
  placement?:      WebTabPlacement;
  icon?:           string;
  sortOrder?:      number;
  visibleToRoles?: string[];
  isActive?:       boolean;
};

// ─── Constants ────────────────────────────────────────────────────────────────

export const ALL_TAB_TYPES: WebTabType[] = ["INTERNAL_ROUTE", "EXTERNAL_URL"];

export const TAB_TYPE_LABELS: Record<WebTabType, string> = {
  INTERNAL_ROUTE: "Internal Route",
  EXTERNAL_URL:   "External URL",
};

export const ALL_PLACEMENTS: WebTabPlacement[] = ["MAIN_NAV", "SETTINGS", "QUICK_LINKS"];

export const PLACEMENT_LABELS: Record<WebTabPlacement, string> = {
  MAIN_NAV:    "Main Navigation",
  SETTINGS:    "Settings",
  QUICK_LINKS: "Quick Links",
};

export const ALL_ROLES = ["OWNER", "ADMIN", "ACCOUNTANT", "MEMBER"] as const;

// ─── URL Validation ───────────────────────────────────────────────────────────

export function validateWebTabUrl(
  url:  string,
  type: WebTabType,
): string | null {
  const trimmed = url.trim();
  if (!trimmed) return "URL or route is required.";

  if (type === "EXTERNAL_URL") {
    const lower = trimmed.toLowerCase();
    if (lower.startsWith("javascript:")) return "javascript: URLs are not allowed.";
    if (lower.startsWith("data:"))       return "data: URLs are not allowed.";
    if (lower.startsWith("file:"))       return "file: URLs are not allowed.";
    if (lower.startsWith("http://"))     return "Only https:// URLs are allowed.";
    if (!lower.startsWith("https://"))   return "External URLs must start with https://.";

    try {
      new URL(trimmed);
    } catch {
      return "Must be a valid URL (e.g. https://example.com).";
    }
    return null;
  }

  // INTERNAL_ROUTE
  if (!trimmed.startsWith("/"))  return "Internal routes must start with /.";
  if (trimmed.startsWith("//")) return "Internal routes must not start with //.";
  if (trimmed.toLowerCase().includes("javascript:")) return "javascript: is not allowed in routes.";
  return null;
}
