"use server";

import type { AccountType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { SystemAccountRole } from "@/lib/accounting/system-accounts";

const EXPECTED_TYPES: Record<SystemAccountRole, AccountType[]> = {
  ACCOUNTS_RECEIVABLE: ["ASSET"],
  ACCOUNTS_PAYABLE: ["LIABILITY"],
  CUSTOMER_CREDIT: ["LIABILITY"],
  VENDOR_CREDIT: ["ASSET"],
  PREPAID_EXPENSE: ["ASSET"],
  EXPENSE_REIMBURSEMENT_PAYABLE: ["LIABILITY"],
  DEFAULT_BANK: ["ASSET"],
  INPUT_VAT: ["ASSET"],
  OUTPUT_VAT: ["LIABILITY"],
  WHT_PAYABLE: ["LIABILITY"],
  WHT_RECEIVABLE: ["ASSET"],
  RETAINED_EARNINGS: ["EQUITY"],
  FX_GAIN: ["INCOME"],
  FX_LOSS: ["EXPENSE"],
  CONTRACT_ASSET: ["ASSET"],
  UNEARNED_REVENUE: ["LIABILITY"],
};

function isRole(value: string): value is SystemAccountRole {
  return Object.prototype.hasOwnProperty.call(EXPECTED_TYPES, value);
}

export async function saveSystemAccountMapping(formData: FormData) {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  if (!tenantId) throw new Error("Unauthorized");

  const roleValue = String(formData.get("role") ?? "");
  const accountId = String(formData.get("accountId") ?? "");
  if (!isRole(roleValue)) throw new Error("Invalid system account role");

  if (!accountId) {
    await prisma.$executeRaw`
      DELETE FROM "system_account_mappings"
      WHERE "tenant_id" = ${tenantId}::uuid AND "role" = ${roleValue}
    `;
    revalidatePath("/settings/accounting/system-accounts");
    return;
  }

  const account = await prisma.chartOfAccounts.findFirst({
    where: { id: accountId, tenantId, isActive: true },
    select: { id: true, type: true, code: true, name: true },
  });
  if (!account) throw new Error("Account not found in this organisation");

  const expected = EXPECTED_TYPES[roleValue];
  if (!expected.includes(account.type)) {
    throw new Error(`${roleValue} requires ${expected.join(" or ")} account, but ${account.code} — ${account.name} is ${account.type}.`);
  }

  await prisma.$executeRaw`
    INSERT INTO "system_account_mappings" ("tenant_id", "role", "account_id", "updated_at")
    VALUES (${tenantId}::uuid, ${roleValue}, ${account.id}, CURRENT_TIMESTAMP)
    ON CONFLICT ("tenant_id", "role")
    DO UPDATE SET "account_id" = EXCLUDED."account_id", "updated_at" = CURRENT_TIMESTAMP
  `;

  revalidatePath("/settings/accounting/system-accounts");
}
