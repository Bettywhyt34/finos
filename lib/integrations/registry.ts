/**
 * lib/integrations/registry.ts
 * Phase 2.5 Week 4 — Integration Registry service.
 *
 * Single source of truth for available integrations and per-tenant
 * integration state. Reads from integration_registry (system-wide)
 * and tenant_integrations (per-tenant) via Prisma.
 */

import { prisma } from "@/lib/prisma";
import type { IntegrationRegistry, TenantIntegration } from "@prisma/client";

// ── Types ──────────────────────────────────────────────────────────────────────

export type IntegrationWithStatus = IntegrationRegistry & {
  tenantIntegration: TenantIntegration | null;
};

export type GLMapping = {
  defaultRevenueAccount?: string;
  defaultExpenseAccount?: string;
  defaultBankAccount?: string;
  [key: string]: string | undefined;
};

// ── Registry queries ───────────────────────────────────────────────────────────

/**
 * Returns all active integrations from the registry (system-wide).
 * No tenant context needed — integration_registry has no RLS.
 */
export async function getAvailableIntegrations(): Promise<IntegrationRegistry[]> {
  return prisma.integrationRegistry.findMany({
    where: { isActive: true },
    orderBy: [{ category: "asc" }, { displayName: "asc" }],
  });
}

/**
 * Returns all active registry integrations enriched with this tenant's
 * connection status from tenant_integrations (null if not yet set up).
 */
export async function getTenantIntegrations(
  tenantId: string,
): Promise<IntegrationWithStatus[]> {
  const [registryRows, tenantRows] = await Promise.all([
    prisma.integrationRegistry.findMany({
      where: { isActive: true },
      orderBy: [{ category: "asc" }, { displayName: "asc" }],
    }),
    prisma.tenantIntegration.findMany({
      where: { tenantId },
    }),
  ]);

  const byApp = new Map(tenantRows.map((r) => [r.sourceApp, r]));

  return registryRows.map((reg) => ({
    ...reg,
    tenantIntegration: byApp.get(reg.sourceApp) ?? null,
  }));
}

/**
 * Upsert a tenant_integrations row (creates on first connect, updates on re-connect).
 * Pass status: "connected" and connectedAt: new Date() when OAuth completes.
 */
export async function upsertTenantIntegration(
  tenantId: string,
  sourceApp: string,
  data: Partial<{
    status: string;
    connectedAt: Date | null;
    config: object;
    glMapping: GLMapping;
    features: object;
  }>,
): Promise<TenantIntegration> {
  return prisma.tenantIntegration.upsert({
    where: { uq_tenant_source: { tenantId, sourceApp } },
    create: {
      tenantId,
      sourceApp,
      status: data.status ?? "disconnected",
      connectedAt: data.connectedAt ?? null,
      config: data.config ?? {},
      glMapping: data.glMapping ?? {},
      features: data.features ?? {},
    },
    update: {
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.connectedAt !== undefined ? { connectedAt: data.connectedAt } : {}),
      ...(data.config !== undefined ? { config: data.config } : {}),
      ...(data.glMapping !== undefined ? { glMapping: data.glMapping } : {}),
      ...(data.features !== undefined ? { features: data.features } : {}),
    },
  });
}

// ── GL mapping helpers ─────────────────────────────────────────────────────────

/**
 * Reads the gl_mapping JSONB for a tenant+sourceApp.
 * Returns null if the integration row doesn't exist.
 */
export async function getGLMapping(
  tenantId: string,
  sourceApp: string,
): Promise<GLMapping | null> {
  const row = await prisma.tenantIntegration.findUnique({
    where: { uq_tenant_source: { tenantId, sourceApp } },
    select: { glMapping: true },
  });
  if (!row) return null;
  return row.glMapping as GLMapping;
}

/**
 * Resolve the default GL account code for a given side (debit/credit) of
 * a sync transaction. Falls back to explicit sourceApp-level defaults.
 *
 * Lookup chain:
 *   gl_mapping.default_revenue_account (side=debit, category=revenue)
 *   gl_mapping.default_expense_account (side=debit, category=expense/payroll)
 *   gl_mapping.default_bank_account    (side=credit, banking transactions)
 *   gl_mapping[`${sourceApp}_${side}`] (per-app override)
 */
export async function resolveGLAccount(
  tenantId: string,
  sourceApp: string,
  side: "debit" | "credit",
): Promise<string | null> {
  const [mapping, registry] = await Promise.all([
    getGLMapping(tenantId, sourceApp),
    prisma.integrationRegistry.findUnique({
      where: { sourceApp },
      select: { category: true },
    }),
  ]);

  if (!mapping || !registry) return null;

  const { category } = registry;

  // Per-app override wins
  const perAppKey = `${sourceApp}_${side}`;
  if (mapping[perAppKey]) return mapping[perAppKey] ?? null;

  if (side === "debit") {
    if (category === "revenue") return mapping.defaultRevenueAccount ?? null;
    if (category === "expense" || category === "payroll")
      return mapping.defaultExpenseAccount ?? null;
  }

  if (side === "credit") {
    return mapping.defaultBankAccount ?? null;
  }

  return null;
}
