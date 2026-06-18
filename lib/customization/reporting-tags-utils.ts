/**
 * Reporting Tags utilities — future transaction-form integration helpers.
 * These functions are pure and safe to import in server actions and API routes.
 *
 * TODO integration points:
 *   - Invoice form: call getActiveReportingTagsForScope(tenantId, "SALES") to populate tag pickers
 *   - Bill form: call getActiveReportingTagsForScope(tenantId, "PURCHASES")
 *   - Journal form: call getActiveReportingTagsForScope(tenantId, "ACCOUNTING")
 *   - Expense form: call getActiveReportingTagsForScope(tenantId, "EXPENSES")
 *   - Customer/Vendor forms: call getActiveReportingTagsForScope(tenantId, "CONTACTS")
 *   - Report filters: call getActiveReportingTagsForScope(tenantId, scope) to build filter UI
 */
import "server-only";
import { prisma } from "@/lib/prisma";
import type { ReportingTagEntityScope } from "@prisma/client";

// ─── Public types ─────────────────────────────────────────────────────────────

export type TagOptionRef = {
  tagId:      string;
  tagName:    string;
  optionId:   string;
  optionName: string;
};

export type TagSelectionEntry = {
  tagId:    string;
  optionId: string;
};

// ─── Active tags for a given scope ───────────────────────────────────────────

/**
 * Returns all active tags (with active options) for the given entity scope.
 * Used by transaction forms to populate tag pickers.
 *
 * TODO: wire into invoice/bill/journal/expense/customer/vendor forms.
 */
export async function getActiveReportingTagsForScope(
  tenantId: string,
  scope:    ReportingTagEntityScope,
) {
  const tags = await prisma.reportingTag.findMany({
    where: {
      tenantId,
      isActive:  true,
      appliesTo: { has: scope },
    },
    include: {
      options: {
        where:   { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      },
    },
    orderBy: { name: "asc" },
  });
  return tags;
}

// ─── Validate selections ──────────────────────────────────────────────────────

/**
 * Validates that all tag/option selections are active and belong to the tenant.
 * Returns an array of error messages (empty = valid).
 *
 * TODO: call from invoice/bill/expense server actions before persisting.
 */
export async function validateReportingTagSelections(
  tenantId:   string,
  selections: TagSelectionEntry[],
  scope:      ReportingTagEntityScope,
): Promise<string[]> {
  if (selections.length === 0) return [];

  const errors: string[] = [];

  for (const sel of selections) {
    const option = await prisma.reportingTagOption.findFirst({
      where: {
        id:       sel.optionId,
        tagId:    sel.tagId,
        tenantId,
        isActive: true,
        tag: {
          isActive:  true,
          appliesTo: { has: scope },
        },
      },
    });
    if (!option) {
      errors.push(`Tag option "${sel.optionId}" is not valid for this transaction.`);
    }
  }

  return errors;
}

// ─── Normalise selections ─────────────────────────────────────────────────────

/**
 * Normalises an array of tag selections to ensure uniqueness per tag.
 * If a tag appears multiple times, only the last selection is kept.
 *
 * TODO: call before saving tag selections to transaction records.
 */
export function normaliseReportingTagSelections(
  selections: TagSelectionEntry[],
): TagSelectionEntry[] {
  const seen = new Map<string, TagSelectionEntry>();
  for (const sel of selections) {
    seen.set(sel.tagId, sel);
  }
  return Array.from(seen.values());
}

// ─── Seed default tags (no-op) ────────────────────────────────────────────────

/**
 * Reporting tags are user-created dimensions; no defaults are seeded.
 * This function intentionally does nothing.
 */
export async function seedDefaultReportingTagsForTenant(
  _tenantId: string,
): Promise<void> {
  // No-op: Reporting tags are user-created dimensions; no defaults are seeded.
}
