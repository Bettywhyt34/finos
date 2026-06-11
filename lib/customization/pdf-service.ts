/**
 * PDF Templates service — server-only.
 *
 * All functions are tenant-scoped.
 * PDF rendering (actual PDF export) is not yet connected —
 * templates are stored and managed here; rendering integration is pending.
 */

import { prisma } from "@/lib/prisma";

// Re-export pure helpers so server-side callers can import from one place.
export {
  PDF_DOC_TYPE_LABELS,
  PDF_DOC_TYPE_SINGULAR,
  PDF_DOC_TYPE_ORDER,
  LAYOUT_KEYS,
  type PdfTemplateRow,
  type PdfTemplateDocumentTypeValue,
} from "./pdf-utils";

import type { PdfTemplateRow, PdfTemplateDocumentTypeValue } from "./pdf-utils";
import { PDF_DOC_TYPE_ORDER } from "./pdf-utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CreatePdfTemplateInput = {
  documentType: string;
  name:         string;
  description?: string;
  layoutKey?:   string;
};

export type UpdatePdfTemplateInput = {
  name?:        string;
  description?: string;
  layoutKey?:   string;
  isActive?:    boolean;
};

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getPdfTemplates(
  tenantId:     string,
  documentType?: string,
): Promise<PdfTemplateRow[]> {
  const rows = await prisma.pdfTemplate.findMany({
    where: {
      tenantId,
      isActive: true,
      ...(documentType ? { documentType: documentType as PdfTemplateDocumentTypeValue } : {}),
    },
    orderBy: [{ isDefault: "desc" }, { isSystem: "desc" }, { createdAt: "asc" }],
  });
  return rows.map(rowToPublic);
}

export async function getPdfTemplateById(
  tenantId:   string,
  templateId: string,
): Promise<PdfTemplateRow | null> {
  const row = await prisma.pdfTemplate.findFirst({
    where: { id: templateId, tenantId },
  });
  return row ? rowToPublic(row) : null;
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function createPdfTemplate(
  tenantId: string,
  data:     CreatePdfTemplateInput,
): Promise<PdfTemplateRow> {
  // Check unique name within document type
  const existing = await prisma.pdfTemplate.findFirst({
    where: { tenantId, documentType: data.documentType as PdfTemplateDocumentTypeValue, name: data.name.trim() },
  });
  if (existing) {
    throw new Error(`A template named "${data.name.trim()}" already exists for this document type.`);
  }

  const row = await prisma.pdfTemplate.create({
    data: {
      tenantId,
      documentType: data.documentType as PdfTemplateDocumentTypeValue,
      name:         data.name.trim(),
      description:  data.description?.trim() ?? null,
      layoutKey:    data.layoutKey ?? "standard",
      isSystem:     false,
      isDefault:    false,
      isActive:     true,
    },
  });
  return rowToPublic(row);
}

export async function updatePdfTemplate(
  tenantId:   string,
  templateId: string,
  data:       UpdatePdfTemplateInput,
): Promise<PdfTemplateRow> {
  const existing = await prisma.pdfTemplate.findFirst({
    where: { id: templateId, tenantId },
  });
  if (!existing) throw new Error("Template not found.");
  if (existing.isSystem) {
    const isDestructive =
      data.name      !== undefined ||
      data.layoutKey !== undefined ||
      data.isActive  === false;
    if (isDestructive) {
      throw new Error("System templates cannot be deactivated or destructively edited.");
    }
  }

  const row = await prisma.pdfTemplate.update({
    where: { id: templateId },
    data: {
      ...(data.name        !== undefined ? { name:        data.name.trim()          } : {}),
      ...(data.description !== undefined ? { description: data.description?.trim() ?? null } : {}),
      ...(data.layoutKey   !== undefined ? { layoutKey:   data.layoutKey            } : {}),
      ...(data.isActive    !== undefined ? { isActive:    data.isActive             } : {}),
    },
  });
  return rowToPublic(row);
}

export async function setDefaultPdfTemplate(
  tenantId:   string,
  templateId: string,
): Promise<PdfTemplateRow> {
  const target = await prisma.pdfTemplate.findFirst({
    where: { id: templateId, tenantId, isActive: true },
  });
  if (!target) throw new Error("Template not found.");

  // Atomic: unset old default + set new default in one transaction
  await prisma.$transaction([
    prisma.pdfTemplate.updateMany({
      where:  { tenantId, documentType: target.documentType, isDefault: true },
      data:   { isDefault: false },
    }),
    prisma.pdfTemplate.update({
      where: { id: templateId },
      data:  { isDefault: true },
    }),
  ]);

  const updated = await prisma.pdfTemplate.findFirstOrThrow({ where: { id: templateId } });
  return rowToPublic(updated);
}

export async function deactivatePdfTemplate(
  tenantId:   string,
  templateId: string,
): Promise<PdfTemplateRow> {
  const existing = await prisma.pdfTemplate.findFirst({
    where: { id: templateId, tenantId },
  });
  if (!existing) throw new Error("Template not found.");
  if (existing.isSystem)  throw new Error("System templates cannot be deactivated.");
  if (existing.isDefault) throw new Error("Cannot deactivate the default template. Set another template as default first.");

  const row = await prisma.pdfTemplate.update({
    where: { id: templateId },
    data:  { isActive: false },
  });
  return rowToPublic(row);
}

export async function duplicatePdfTemplate(
  tenantId:   string,
  templateId: string,
): Promise<PdfTemplateRow> {
  const source = await prisma.pdfTemplate.findFirst({
    where: { id: templateId, tenantId },
  });
  if (!source) throw new Error("Template not found.");

  // Generate a unique name
  const baseName = `${source.name} Copy`;
  let name = baseName;
  let attempt = 1;
  while (true) {
    const conflict = await prisma.pdfTemplate.findFirst({
      where: { tenantId, documentType: source.documentType, name },
    });
    if (!conflict) break;
    attempt++;
    name = `${baseName} ${attempt}`;
  }

  const row = await prisma.pdfTemplate.create({
    data: {
      tenantId,
      documentType: source.documentType,
      name,
      description:  source.description,
      layoutKey:    source.layoutKey,
      isSystem:     false,
      isDefault:    false,
      isActive:     true,
      config:       source.config as never,
    },
  });
  return rowToPublic(row);
}

export async function deletePdfTemplate(
  tenantId:   string,
  templateId: string,
): Promise<void> {
  const existing = await prisma.pdfTemplate.findFirst({
    where: { id: templateId, tenantId },
  });
  if (!existing) throw new Error("Template not found.");
  if (existing.isSystem)  throw new Error("System templates cannot be deleted.");
  if (existing.isDefault) throw new Error("Cannot delete the default template. Set another template as default first.");

  await prisma.pdfTemplate.delete({ where: { id: templateId } });
}

// ─── Internal helper ──────────────────────────────────────────────────────────

function rowToPublic(r: {
  id: string; tenantId: string; documentType: string; name: string;
  description: string | null; layoutKey: string; isSystem: boolean;
  isDefault: boolean; isActive: boolean; config: unknown;
  previewImageUrl: string | null; createdAt: Date; updatedAt: Date;
}): PdfTemplateRow {
  return {
    id:              r.id,
    tenantId:        r.tenantId,
    documentType:    r.documentType,
    name:            r.name,
    description:     r.description,
    layoutKey:       r.layoutKey,
    isSystem:        r.isSystem,
    isDefault:       r.isDefault,
    isActive:        r.isActive,
    config:          (r.config as Record<string, unknown>) ?? {},
    previewImageUrl: r.previewImageUrl,
    createdAt:       r.createdAt,
    updatedAt:       r.updatedAt,
  };
}
