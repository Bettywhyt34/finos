/**
 * Email Notification Templates service — server-only.
 * All functions are tenant-scoped.
 */

import "server-only";
import { prisma } from "@/lib/prisma";
import {
  SYSTEM_EMAIL_DEFAULTS,
  SAMPLE_CONTEXT,
  renderEmailSubject,
  renderEmailBody,
} from "@/lib/email-notifications/template-renderer";
import type {
  EmailNotificationTemplateRow,
  EmailNotificationCategory,
  EmailNotificationEvent,
} from "@/lib/email-notifications/template-renderer";

// Re-export pure helpers so server-side callers have one import point.
export {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  EVENT_LABELS,
  VARIABLES_BY_EVENT,
  listVariablesForEvent,
  validateTemplateVariables,
  type EmailNotificationTemplateRow,
  type EmailNotificationCategory,
  type EmailNotificationEvent,
} from "@/lib/email-notifications/template-renderer";

// ─── Types ────────────────────────────────────────────────────────────────────

export type UpdateEmailNotificationInput = {
  subject?:  string;
  bodyHtml?: string;
  bodyText?: string;
  isEnabled?: boolean;
};

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getEmailNotificationTemplates(
  tenantId:  string,
  category?: string,
): Promise<EmailNotificationTemplateRow[]> {
  const rows = await prisma.emailNotificationTemplate.findMany({
    where: {
      tenantId,
      ...(category ? { category: category as EmailNotificationCategory } : {}),
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  return rows.map(rowToPublic);
}

export async function getEmailNotificationTemplateById(
  tenantId:   string,
  templateId: string,
): Promise<EmailNotificationTemplateRow | null> {
  const row = await prisma.emailNotificationTemplate.findFirst({
    where: { id: templateId, tenantId },
  });
  return row ? rowToPublic(row) : null;
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function updateEmailNotificationTemplate(
  tenantId:   string,
  templateId: string,
  data:       UpdateEmailNotificationInput,
): Promise<EmailNotificationTemplateRow> {
  const existing = await prisma.emailNotificationTemplate.findFirst({
    where: { id: templateId, tenantId },
  });
  if (!existing) throw new Error("Template not found.");

  const isContentChanged =
    data.subject  !== undefined ||
    data.bodyHtml !== undefined ||
    data.bodyText !== undefined;

  const row = await prisma.emailNotificationTemplate.update({
    where: { id: templateId },
    data: {
      ...(data.subject   !== undefined ? { subject:  data.subject.trim()           } : {}),
      ...(data.bodyHtml  !== undefined ? { bodyHtml: data.bodyHtml.trim()          } : {}),
      ...(data.bodyText  !== undefined ? { bodyText: data.bodyText?.trim() ?? null } : {}),
      ...(data.isEnabled !== undefined ? { isEnabled: data.isEnabled               } : {}),
      ...(isContentChanged             ? { isCustomised: true                      } : {}),
    },
  });
  return rowToPublic(row);
}

export async function toggleEmailNotificationTemplate(
  tenantId:   string,
  templateId: string,
): Promise<EmailNotificationTemplateRow> {
  const existing = await prisma.emailNotificationTemplate.findFirst({
    where: { id: templateId, tenantId },
  });
  if (!existing) throw new Error("Template not found.");

  const row = await prisma.emailNotificationTemplate.update({
    where: { id: templateId },
    data:  { isEnabled: !existing.isEnabled },
  });
  return rowToPublic(row);
}

export async function restoreEmailNotificationTemplateDefault(
  tenantId:   string,
  templateId: string,
): Promise<EmailNotificationTemplateRow> {
  const existing = await prisma.emailNotificationTemplate.findFirst({
    where: { id: templateId, tenantId },
  });
  if (!existing) throw new Error("Template not found.");
  if (!existing.isCustomised) throw new Error("Template has not been customised.");

  const defaults = SYSTEM_EMAIL_DEFAULTS[existing.event as EmailNotificationEvent];
  if (!defaults) throw new Error("System defaults not found for this event.");

  const row = await prisma.emailNotificationTemplate.update({
    where: { id: templateId },
    data: {
      subject:     defaults.subject,
      bodyHtml:    defaults.bodyHtml,
      bodyText:    null,
      isCustomised: false,
    },
  });
  return rowToPublic(row);
}

export async function previewEmailNotificationTemplate(
  tenantId:   string,
  templateId: string,
): Promise<{ subject: string; bodyHtml: string }> {
  const row = await prisma.emailNotificationTemplate.findFirst({
    where: { id: templateId, tenantId },
  });
  if (!row) throw new Error("Template not found.");

  return {
    subject:  renderEmailSubject(row.subject,  SAMPLE_CONTEXT),
    bodyHtml: renderEmailBody(row.bodyHtml, SAMPLE_CONTEXT),
  };
}

// ─── Internal helper ──────────────────────────────────────────────────────────

function rowToPublic(r: {
  id: string; tenantId: string; category: string; event: string; name: string;
  subject: string; bodyHtml: string; bodyText: string | null;
  isEnabled: boolean; isSystem: boolean; isCustomised: boolean; isConnected: boolean;
  availableVariables: unknown; config: unknown;
  createdAt: Date; updatedAt: Date;
}): EmailNotificationTemplateRow {
  return {
    id:                 r.id,
    tenantId:           r.tenantId,
    category:           r.category    as EmailNotificationCategory,
    event:              r.event       as EmailNotificationEvent,
    name:               r.name,
    subject:            r.subject,
    bodyHtml:           r.bodyHtml,
    bodyText:           r.bodyText,
    isEnabled:          r.isEnabled,
    isSystem:           r.isSystem,
    isCustomised:       r.isCustomised,
    isConnected:        r.isConnected,
    availableVariables: (r.availableVariables as string[]) ?? [],
    config:             (r.config as Record<string, unknown>) ?? {},
    createdAt:          r.createdAt,
    updatedAt:          r.updatedAt,
  };
}
