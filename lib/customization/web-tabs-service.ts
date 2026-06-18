/**
 * Web Tabs service — server-only.
 * All functions are tenant-scoped.
 */
import "server-only";
import { prisma }                 from "@/lib/prisma";
import type { WebTabType, WebTabPlacement } from "@prisma/client";

// Types, constants, and pure validation live in the shared (non-server-only)
// file. Import for use within this file, and re-export so existing
// server-side imports continue to work unchanged.
import {
  ALL_TAB_TYPES,
  TAB_TYPE_LABELS,
  ALL_PLACEMENTS,
  PLACEMENT_LABELS,
  ALL_ROLES,
  validateWebTabUrl,
  type WebTabRow,
  type CreateWebTabInput,
  type UpdateWebTabInput,
} from "./web-tabs-types";

export type {
  WebTabRow,
  CreateWebTabInput,
  UpdateWebTabInput,
} from "./web-tabs-types";
export {
  ALL_TAB_TYPES,
  TAB_TYPE_LABELS,
  ALL_PLACEMENTS,
  PLACEMENT_LABELS,
  ALL_ROLES,
  validateWebTabUrl,
} from "./web-tabs-types";

// ─── Queries ─────────────────────────────────────────────────────────────────

export async function getWebTabs(
  tenantId:  string,
  activeOnly = false,
): Promise<WebTabRow[]> {
  const rows = await prisma.webTab.findMany({
    where: {
      tenantId,
      ...(activeOnly ? { isActive: true } : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return rows.map(tabToRow);
}

export async function getWebTabById(
  tenantId: string,
  tabId:    string,
): Promise<WebTabRow | null> {
  const row = await prisma.webTab.findFirst({
    where: { id: tabId, tenantId },
  });
  return row ? tabToRow(row) : null;
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function createWebTab(
  tenantId: string,
  data:     CreateWebTabInput,
): Promise<WebTabRow> {
  const name = data.name.trim();
  if (!name) throw new Error("Tab name is required.");

  const urlError = validateWebTabUrl(data.url, data.type);
  if (urlError) throw new Error(urlError);

  const existing = await prisma.webTab.findFirst({
    where: { tenantId, name: { equals: name, mode: "insensitive" } },
  });
  if (existing) throw new Error(`A tab named "${name}" already exists.`);

  const row = await prisma.webTab.create({
    data: {
      tenantId,
      name,
      description:    data.description?.trim() || null,
      type:           data.type,
      url:            data.url.trim(),
      placement:      data.placement      ?? "QUICK_LINKS",
      icon:           data.icon?.trim()   || null,
      sortOrder:      data.sortOrder      ?? 0,
      visibleToRoles: data.visibleToRoles ?? [],
      isActive:       data.isActive       ?? true,
    },
  });
  return tabToRow(row);
}

export async function updateWebTab(
  tenantId: string,
  tabId:    string,
  data:     UpdateWebTabInput,
): Promise<WebTabRow> {
  const existing = await prisma.webTab.findFirst({ where: { id: tabId, tenantId } });
  if (!existing) throw new Error("Tab not found.");

  if (data.name !== undefined) {
    const name = data.name.trim();
    if (!name) throw new Error("Tab name is required.");
    if (name.toLowerCase() !== existing.name.toLowerCase()) {
      const conflict = await prisma.webTab.findFirst({
        where: { tenantId, name: { equals: name, mode: "insensitive" }, NOT: { id: tabId } },
      });
      if (conflict) throw new Error(`A tab named "${name}" already exists.`);
    }
  }

  const resolvedType = data.type ?? existing.type;
  const resolvedUrl  = data.url  ?? existing.url;

  if (data.url !== undefined || data.type !== undefined) {
    const urlError = validateWebTabUrl(resolvedUrl, resolvedType);
    if (urlError) throw new Error(urlError);
  }

  const row = await prisma.webTab.update({
    where: { id: tabId },
    data: {
      ...(data.name           !== undefined && { name:           data.name.trim()                    }),
      ...(data.description    !== undefined && { description:    data.description?.trim() || null    }),
      ...(data.type           !== undefined && { type:           data.type                           }),
      ...(data.url            !== undefined && { url:            data.url.trim()                     }),
      ...(data.placement      !== undefined && { placement:      data.placement                      }),
      ...(data.icon           !== undefined && { icon:           data.icon?.trim() || null           }),
      ...(data.sortOrder      !== undefined && { sortOrder:      data.sortOrder                      }),
      ...(data.visibleToRoles !== undefined && { visibleToRoles: data.visibleToRoles                 }),
      ...(data.isActive       !== undefined && { isActive:       data.isActive                       }),
    },
  });
  return tabToRow(row);
}

export async function deactivateWebTab(
  tenantId: string,
  tabId:    string,
): Promise<WebTabRow> {
  const existing = await prisma.webTab.findFirst({ where: { id: tabId, tenantId } });
  if (!existing) throw new Error("Tab not found.");

  const row = await prisma.webTab.update({
    where: { id: tabId },
    data:  { isActive: false },
  });
  return tabToRow(row);
}

export async function deleteWebTab(
  tenantId: string,
  tabId:    string,
): Promise<void> {
  const existing = await prisma.webTab.findFirst({ where: { id: tabId, tenantId } });
  if (!existing) throw new Error("Tab not found.");

  await prisma.webTab.delete({ where: { id: tabId } });
}

export async function reorderWebTabs(
  tenantId:   string,
  orderedIds: string[],
): Promise<void> {
  // Verify all ids belong to this tenant
  const count = await prisma.webTab.count({
    where: { id: { in: orderedIds }, tenantId },
  });
  if (count !== orderedIds.length) throw new Error("One or more tab IDs not found.");

  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.webTab.updateMany({
        where: { id, tenantId },
        data:  { sortOrder: index },
      }),
    ),
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type PrismaWebTab = {
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

function tabToRow(r: PrismaWebTab): WebTabRow {
  return {
    id:             r.id,
    tenantId:       r.tenantId,
    name:           r.name,
    description:    r.description,
    type:           r.type,
    url:            r.url,
    placement:      r.placement,
    icon:           r.icon,
    sortOrder:      r.sortOrder,
    visibleToRoles: r.visibleToRoles,
    isActive:       r.isActive,
    isSystem:       r.isSystem,
    isConnected:    r.isConnected,
    createdAt:      r.createdAt,
    updatedAt:      r.updatedAt,
  };
}

// ─── Seed default tabs (no-op) ────────────────────────────────────────────────

/**
 * Web tabs are organisation-created navigation links; no defaults are seeded.
 * This function intentionally does nothing.
 */
export async function seedDefaultWebTabsForTenant(
  _tenantId: string,
): Promise<void> {
  // No-op: Web tabs are organisation-created navigation links; no defaults are seeded.
}
