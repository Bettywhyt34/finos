import type { AccountType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type SystemAccountRole =
  | "ACCOUNTS_RECEIVABLE"
  | "ACCOUNTS_PAYABLE"
  | "DEFAULT_BANK"
  | "OUTPUT_VAT"
  | "WHT_PAYABLE"
  | "RETAINED_EARNINGS"
  | "FX_GAIN"
  | "FX_LOSS"
  | "CONTRACT_ASSET"
  | "UNEARNED_REVENUE";

const EXPECTED_TYPES: Partial<Record<SystemAccountRole, AccountType[]>> = {
  ACCOUNTS_RECEIVABLE: ["ASSET"],
  ACCOUNTS_PAYABLE: ["LIABILITY"],
  DEFAULT_BANK: ["ASSET"],
  OUTPUT_VAT: ["LIABILITY"],
  WHT_PAYABLE: ["LIABILITY"],
  RETAINED_EARNINGS: ["EQUITY"],
  FX_GAIN: ["INCOME"],
  FX_LOSS: ["EXPENSE"],
  CONTRACT_ASSET: ["ASSET"],
  UNEARNED_REVENUE: ["LIABILITY"],
};

export interface ResolvedSystemAccount {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  mapped: boolean;
}

type DbClient = Prisma.TransactionClient | typeof prisma;

interface MappingRow {
  id: string;
  code: string;
  name: string;
  type: AccountType;
}

function assertExpectedType(role: SystemAccountRole, account: MappingRow) {
  const expected = EXPECTED_TYPES[role];
  if (expected && !expected.includes(account.type)) {
    throw new Error(
      `System account ${role} is mapped to ${account.code} — ${account.name}, ` +
      `but that account has type ${account.type}. Expected ${expected.join(" or ")}.`,
    );
  }
}

/**
 * Resolve a FINOS accounting role to an active account for one tenant.
 *
 * The role mapping is the permanent identity. `legacyCode` exists only so current
 * tenants can keep posting while their mappings are configured. New/reconstructed
 * flows should pass the fallback only during the migration period.
 */
export async function resolveSystemAccount(
  db: DbClient,
  tenantId: string,
  role: SystemAccountRole,
  legacyCode?: string,
): Promise<ResolvedSystemAccount> {
  const rows = await db.$queryRaw<MappingRow[]>`
    SELECT
      coa."id",
      coa."code",
      coa."name",
      coa."type"::text AS "type"
    FROM "system_account_mappings" sam
    INNER JOIN "chart_of_accounts" coa
      ON coa."id" = sam."account_id"
     AND coa."tenant_id" = sam."tenant_id"
    WHERE sam."tenant_id" = ${tenantId}::uuid
      AND sam."role" = ${role}
      AND coa."is_active" = true
    LIMIT 1
  `;

  if (rows[0]) {
    assertExpectedType(role, rows[0]);
    return { ...rows[0], mapped: true };
  }

  if (legacyCode) {
    const fallback = await db.chartOfAccounts.findFirst({
      where: { tenantId, code: legacyCode, isActive: true },
      select: { id: true, code: true, name: true, type: true },
    });
    if (fallback) {
      assertExpectedType(role, fallback);
      return { ...fallback, mapped: false };
    }
  }

  throw new Error(
    `FINOS system account ${role} is not configured for this organisation. ` +
    "Map the required Chart of Accounts account before posting this transaction.",
  );
}

/** Resolve through the default Prisma client for read-before-write workflows. */
export function getSystemAccount(
  tenantId: string,
  role: SystemAccountRole,
  legacyCode?: string,
) {
  return resolveSystemAccount(prisma, tenantId, role, legacyCode);
}
