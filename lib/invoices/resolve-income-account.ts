import { prisma } from "@/lib/prisma";

type IncomeAccountResult = { id: string; code: string; name: string } | null;

/**
 * Resolve the income account for an invoice line using a fallback chain:
 *   1. opts.incomeAccountId  — verify tenant + INCOME + active
 *   2. opts.itemIncomeAccountId — verify same
 *   3. Tenant's IN-001 account (INCOME + active)
 *   4. First active INCOME account (order by code)
 *   5. null
 *
 * NOT called for posting yet — prepared for future journal use.
 */
export async function resolveInvoiceLineIncomeAccount(opts: {
  tenantId:            string;
  incomeAccountId?:    string | null;
  itemIncomeAccountId?: string | null;
}): Promise<IncomeAccountResult> {
  const { tenantId } = opts;

  // Helper: verify a candidate id belongs to tenant, type INCOME, isActive
  async function verify(id: string): Promise<IncomeAccountResult> {
    const row = await prisma.chartOfAccounts.findFirst({
      where: { id, tenantId, type: "INCOME", isActive: true },
      select: { id: true, code: true, name: true },
    });
    return row ?? null;
  }

  // 1. Explicit line-level account
  if (opts.incomeAccountId) {
    const r = await verify(opts.incomeAccountId);
    if (r) return r;
  }

  // 2. Item's income account
  if (opts.itemIncomeAccountId) {
    const r = await verify(opts.itemIncomeAccountId);
    if (r) return r;
  }

  // 3. Tenant's IN-001
  const inDefault = await prisma.chartOfAccounts.findFirst({
    where: { tenantId, code: "IN-001", type: "INCOME", isActive: true },
    select: { id: true, code: true, name: true },
  });
  if (inDefault) return inDefault;

  // 4. First active INCOME account
  const first = await prisma.chartOfAccounts.findFirst({
    where:   { tenantId, type: "INCOME", isActive: true },
    orderBy: { code: "asc" },
    select:  { id: true, code: true, name: true },
  });
  return first ?? null;
}
