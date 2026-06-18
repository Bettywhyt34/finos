/**
 * Reporting Tags service — server-only.
 * All functions are tenant-scoped.
 */
import "server-only";
import { prisma }                  from "@/lib/prisma";
import type { ReportingTagEntityScope } from "@prisma/client";

// Types and constants live in the shared (non-server-only) file.
// Import them for use within this file, and re-export so existing
// server-side imports continue to work unchanged.
import {
  SCOPE_LABELS,
  ALL_SCOPES,
  type ReportingTagOptionRow,
  type ReportingTagRow,
  type CreateReportingTagInput,
  type UpdateReportingTagInput,
  type CreateReportingTagOptionInput,
  type UpdateReportingTagOptionInput,
} from "./reporting-tags-types";

export type {
  ReportingTagOptionRow,
  ReportingTagRow,
  CreateReportingTagInput,
  UpdateReportingTagInput,
  CreateReportingTagOptionInput,
  UpdateReportingTagOptionInput,
} from "./reporting-tags-types";
export { SCOPE_LABELS, ALL_SCOPES } from "./reporting-tags-types";

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getReportingTags(
  tenantId:  string,
  activeOnly = false,
): Promise<ReportingTagRow[]> {
  const rows = await prisma.reportingTag.findMany({
    where: {
      tenantId,
      ...(activeOnly ? { isActive: true } : {}),
    },
    include: {
      options: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
    },
    orderBy: { name: "asc" },
  });
  return rows.map(tagToRow);
}

export async function getReportingTagById(
  tenantId: string,
  tagId:    string,
): Promise<ReportingTagRow | null> {
  const row = await prisma.reportingTag.findFirst({
    where:   { id: tagId, tenantId },
    include: { options: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } },
  });
  return row ? tagToRow(row) : null;
}

export function getReportingTagScopes(): ReportingTagEntityScope[] {
  return ALL_SCOPES;
}

// ─── Tag mutations ────────────────────────────────────────────────────────────

export async function createReportingTag(
  tenantId: string,
  data:     CreateReportingTagInput,
): Promise<ReportingTagRow> {
  const name = data.name.trim();
  if (!name) throw new Error("Tag name is required.");

  // Check duplicate
  const existing = await prisma.reportingTag.findFirst({
    where: { tenantId, name: { equals: name, mode: "insensitive" } },
  });
  if (existing) throw new Error(`A tag named "${name}" already exists.`);

  const row = await prisma.reportingTag.create({
    data: {
      tenantId,
      name,
      description: data.description?.trim() || null,
      color:       data.color?.trim()       || null,
      isActive:    data.isActive ?? true,
      appliesTo:   data.appliesTo           ?? [],
    },
    include: { options: true },
  });
  return tagToRow(row);
}

export async function updateReportingTag(
  tenantId: string,
  tagId:    string,
  data:     UpdateReportingTagInput,
): Promise<ReportingTagRow> {
  const existing = await prisma.reportingTag.findFirst({ where: { id: tagId, tenantId } });
  if (!existing) throw new Error("Tag not found.");

  if (data.name !== undefined) {
    const name = data.name.trim();
    if (!name) throw new Error("Tag name is required.");
    if (name.toLowerCase() !== existing.name.toLowerCase()) {
      const conflict = await prisma.reportingTag.findFirst({
        where: { tenantId, name: { equals: name, mode: "insensitive" }, NOT: { id: tagId } },
      });
      if (conflict) throw new Error(`A tag named "${name}" already exists.`);
    }
  }

  const row = await prisma.reportingTag.update({
    where: { id: tagId },
    data: {
      ...(data.name        !== undefined && { name:        data.name.trim()               }),
      ...(data.description !== undefined && { description: data.description?.trim() || null }),
      ...(data.color       !== undefined && { color:       data.color?.trim()       || null }),
      ...(data.isActive    !== undefined && { isActive:    data.isActive                  }),
      ...(data.appliesTo   !== undefined && { appliesTo:   data.appliesTo                 }),
    },
    include: { options: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } },
  });
  return tagToRow(row);
}

export async function deactivateReportingTag(
  tenantId: string,
  tagId:    string,
): Promise<ReportingTagRow> {
  const existing = await prisma.reportingTag.findFirst({ where: { id: tagId, tenantId } });
  if (!existing) throw new Error("Tag not found.");

  const row = await prisma.reportingTag.update({
    where: { id: tagId },
    data:  { isActive: false },
    include: { options: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } },
  });
  return tagToRow(row);
}

export async function deleteReportingTag(
  tenantId: string,
  tagId:    string,
): Promise<void> {
  const existing = await prisma.reportingTag.findFirst({
    where:   { id: tagId, tenantId },
    include: { options: { select: { id: true } } },
  });
  if (!existing) throw new Error("Tag not found.");

  // Prefer deactivation if tag has options (safer)
  if (existing.options.length > 0) {
    throw new Error(
      `Cannot delete tag "${existing.name}" — it has ${existing.options.length} option(s). ` +
      "Deactivate the tag instead, or delete all options first.",
    );
  }

  await prisma.reportingTag.delete({ where: { id: tagId } });
}

// ─── Option mutations ─────────────────────────────────────────────────────────

export async function createReportingTagOption(
  tenantId: string,
  tagId:    string,
  data:     CreateReportingTagOptionInput,
): Promise<ReportingTagOptionRow> {
  const tag = await prisma.reportingTag.findFirst({ where: { id: tagId, tenantId } });
  if (!tag) throw new Error("Tag not found.");

  const name = data.name.trim();
  if (!name) throw new Error("Option name is required.");

  const conflict = await prisma.reportingTagOption.findFirst({
    where: { tenantId, tagId, name: { equals: name, mode: "insensitive" } },
  });
  if (conflict) throw new Error(`An option named "${name}" already exists in this tag.`);

  // Compute next sortOrder
  const maxOrder = await prisma.reportingTagOption.aggregate({
    where: { tagId },
    _max:  { sortOrder: true },
  });

  const row = await prisma.reportingTagOption.create({
    data: {
      tagId,
      tenantId,
      name,
      description: data.description?.trim() || null,
      color:       data.color?.trim()       || null,
      sortOrder:   data.sortOrder ?? (maxOrder._max.sortOrder ?? 0) + 1,
      isActive:    data.isActive ?? true,
    },
  });
  return optionToRow(row);
}

export async function updateReportingTagOption(
  tenantId: string,
  tagId:    string,
  optionId: string,
  data:     UpdateReportingTagOptionInput,
): Promise<ReportingTagOptionRow> {
  const existing = await prisma.reportingTagOption.findFirst({
    where: { id: optionId, tagId, tenantId },
  });
  if (!existing) throw new Error("Option not found.");

  if (data.name !== undefined) {
    const name = data.name.trim();
    if (!name) throw new Error("Option name is required.");
    if (name.toLowerCase() !== existing.name.toLowerCase()) {
      const conflict = await prisma.reportingTagOption.findFirst({
        where: { tenantId, tagId, name: { equals: name, mode: "insensitive" }, NOT: { id: optionId } },
      });
      if (conflict) throw new Error(`An option named "${name}" already exists in this tag.`);
    }
  }

  const row = await prisma.reportingTagOption.update({
    where: { id: optionId },
    data: {
      ...(data.name        !== undefined && { name:        data.name.trim()               }),
      ...(data.description !== undefined && { description: data.description?.trim() || null }),
      ...(data.color       !== undefined && { color:       data.color?.trim()       || null }),
      ...(data.sortOrder   !== undefined && { sortOrder:   data.sortOrder                 }),
      ...(data.isActive    !== undefined && { isActive:    data.isActive                  }),
    },
  });
  return optionToRow(row);
}

export async function deactivateReportingTagOption(
  tenantId: string,
  tagId:    string,
  optionId: string,
): Promise<ReportingTagOptionRow> {
  const existing = await prisma.reportingTagOption.findFirst({
    where: { id: optionId, tagId, tenantId },
  });
  if (!existing) throw new Error("Option not found.");

  const row = await prisma.reportingTagOption.update({
    where: { id: optionId },
    data:  { isActive: false },
  });
  return optionToRow(row);
}

export async function deleteReportingTagOption(
  tenantId: string,
  tagId:    string,
  optionId: string,
): Promise<void> {
  const existing = await prisma.reportingTagOption.findFirst({
    where: { id: optionId, tagId, tenantId },
  });
  if (!existing) throw new Error("Option not found.");

  await prisma.reportingTagOption.delete({ where: { id: optionId } });
}

export async function reorderReportingTagOptions(
  tenantId:   string,
  tagId:      string,
  orderedIds: string[],
): Promise<void> {
  const tag = await prisma.reportingTag.findFirst({ where: { id: tagId, tenantId } });
  if (!tag) throw new Error("Tag not found.");

  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.reportingTagOption.updateMany({
        where: { id, tagId, tenantId },
        data:  { sortOrder: index },
      }),
    ),
  );
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

type PrismaTagWithOptions = {
  id:          string;
  tenantId:    string;
  name:        string;
  description: string | null;
  color:       string | null;
  isActive:    boolean;
  isSystem:    boolean;
  appliesTo:   ReportingTagEntityScope[];
  options:     PrismaOption[];
  createdAt:   Date;
  updatedAt:   Date;
};

type PrismaOption = {
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

function tagToRow(r: PrismaTagWithOptions): ReportingTagRow {
  return {
    id:          r.id,
    tenantId:    r.tenantId,
    name:        r.name,
    description: r.description,
    color:       r.color,
    isActive:    r.isActive,
    isSystem:    r.isSystem,
    appliesTo:   r.appliesTo,
    options:     r.options.map(optionToRow),
    createdAt:   r.createdAt,
    updatedAt:   r.updatedAt,
  };
}

function optionToRow(r: PrismaOption): ReportingTagOptionRow {
  return {
    id:          r.id,
    tagId:       r.tagId,
    tenantId:    r.tenantId,
    name:        r.name,
    description: r.description,
    color:       r.color,
    sortOrder:   r.sortOrder,
    isActive:    r.isActive,
    createdAt:   r.createdAt,
    updatedAt:   r.updatedAt,
  };
}
