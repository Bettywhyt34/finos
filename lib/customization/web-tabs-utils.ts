/**
 * Web Tabs utilities — future navigation integration helpers.
 *
 * TODO integration points:
 *   - Main dashboard sidebar: call getActiveWebTabsForPlacement(tenantId, "MAIN_NAV", role)
 *     to append custom tabs below the standard nav items
 *   - Settings sidebar quick links: call getActiveWebTabsForPlacement(tenantId, "SETTINGS", role)
 *   - Topbar quick actions: call getActiveWebTabsForPlacement(tenantId, "QUICK_LINKS", role)
 *   - Role-based filtering: call filterWebTabsForRole(tabs, role) before rendering
 *   - All external links must use target="_blank" rel="noopener noreferrer"
 */
import "server-only";
import { prisma } from "@/lib/prisma";
import type { WebTabPlacement } from "@prisma/client";
import type { WebTabRow }       from "./web-tabs-service";

// ─── Active tabs for a given placement ───────────────────────────────────────

/**
 * Returns active tabs for the given placement, filtered by role if provided.
 * Used by navigation surfaces to render custom tabs.
 *
 * TODO: wire into dashboard sidebar, settings sidebar, topbar quick actions.
 */
export async function getActiveWebTabsForPlacement(
  tenantId:  string,
  placement: WebTabPlacement,
  role?:     string,
) {
  const tabs = await prisma.webTab.findMany({
    where:   { tenantId, placement, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  if (!role) return tabs;
  return tabs.filter(
    (t) => t.visibleToRoles.length === 0 || t.visibleToRoles.includes(role),
  );
}

// ─── Role filter ──────────────────────────────────────────────────────────────

/**
 * Filters a list of tabs to those visible for the given role.
 * An empty visibleToRoles array means "no visibility configured" (hide from all).
 *
 * TODO: call before rendering any navigation surface.
 */
export function filterWebTabsForRole(tabs: WebTabRow[], role: string): WebTabRow[] {
  return tabs.filter(
    (t) => t.visibleToRoles.length === 0 || t.visibleToRoles.includes(role),
  );
}

// ─── URL normalisation ────────────────────────────────────────────────────────

/**
 * Normalises a URL or internal route for storage.
 * - External: trims whitespace, preserves as-is after validation
 * - Internal: trims whitespace, ensures single leading slash
 */
export function normaliseWebTabUrl(input: string, type: "EXTERNAL_URL" | "INTERNAL_ROUTE"): string {
  const trimmed = input.trim();
  if (type === "INTERNAL_ROUTE") {
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  }
  return trimmed;
}

// ─── Seed default web tabs (no-op) ────────────────────────────────────────────

/**
 * Web tabs are organisation-created navigation links; no defaults are seeded.
 * This function intentionally does nothing.
 */
export async function seedDefaultWebTabsForTenant(
  _tenantId: string,
): Promise<void> {
  // No-op: Web tabs are organisation-created navigation links; no defaults are seeded.
}
