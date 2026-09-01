"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

async function getOrgId() {
  const session = await auth();
  const orgId = session?.user?.tenantId;
  if (!orgId) throw new Error("Unauthorized");
  return orgId;
}

const KNOWN_BANKS = [
  "GTBank", "Guaranty Trust", "Access Bank", "UBA", "United Bank",
  "Zenith Bank", "First Bank", "Fidelity Bank", "Stanbic IBTC",
  "Sterling Bank", "Wema Bank", "Union Bank", "Polaris Bank", "Keystone Bank",
  "Ecobank", "FCMB", "Heritage Bank", "Jaiz Bank", "Providus Bank",
  "Titan Bank", "Standard Chartered",
]

function extractBankName(accountName: string): string {
  const lower = accountName.toLowerCase()
  for (const bank of KNOWN_BANKS) {
    if (lower.includes(bank.toLowerCase())) return bank
  }
  if (lower.includes("cash") || lower.includes("petty")) return "Cash Account"
  return accountName.trim().split(/\s+/).slice(0, 2).join(" ")
}

async function validateLedgerAccount(
  tx: Prisma.TransactionClient,
  tenantId: string,
  ledgerAccountId: string,
  bankAccountId?: string,
) {
  const ledgerAccount = await tx.chartOfAccounts.findFirst({
    where: {
      id: ledgerAccountId,
      tenantId,
      isActive: true,
      type: "ASSET",
      OR: [
        { subtype: { contains: "bank", mode: "insensitive" } },
        { subtype: { contains: "cash", mode: "insensitive" } },
      ],
    },
    select: { id: true, code: true, name: true },
  });
  if (!ledgerAccount) {
    throw new Error("Select an active Bank/Cash account from the Chart of Accounts.");
  }

  const conflict = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "bank_accounts"
    WHERE "tenant_id" = ${tenantId}::uuid
      AND "ledger_account_id" = ${ledgerAccountId}
      AND (${bankAccountId ?? ""} = '' OR "id" <> ${bankAccountId ?? ""})
    LIMIT 1
  `;
  if (conflict.length) {
    throw new Error("That ledger account is already linked to another bank account.");
  }

  return ledgerAccount;
}

export async function syncBankAccountsFromCoa(): Promise<{
  created: number
  skipped: number
  names: string[]
}> {
  const tenantId = await getOrgId()

  const coaAccounts = await prisma.chartOfAccounts.findMany({
    where: {
      tenantId,
      isActive: true,
      type: "ASSET",
      OR: [
        { subtype: { contains: "bank", mode: "insensitive" } },
        { subtype: { contains: "cash", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true },
  })

  if (!coaAccounts.length) return { created: 0, skipped: 0, names: [] }

  const existing = await prisma.bankAccount.findMany({
    where: { tenantId },
    select: { id: true, accountName: true },
  })
  const byName = new Map(existing.map((a) => [a.accountName.toLowerCase().trim(), a]))
  const mappings = await prisma.$queryRaw<Array<{ bankAccountId: string; ledgerAccountId: string | null }>>`
    SELECT "id" AS "bankAccountId", "ledger_account_id" AS "ledgerAccountId"
    FROM "bank_accounts"
    WHERE "tenant_id" = ${tenantId}::uuid
  `
  const mappingByBank = new Map(mappings.map((row) => [row.bankAccountId, row.ledgerAccountId]))
  const mappedLedgerIds = new Set(mappings.map((row) => row.ledgerAccountId).filter(Boolean))

  let created = 0
  let skipped = 0
  const names: string[] = []

  for (const coa of coaAccounts) {
    const existingByName = byName.get(coa.name.toLowerCase().trim())
    if (mappedLedgerIds.has(coa.id)) {
      skipped++
      continue
    }

    if (existingByName) {
      const currentMapping = mappingByBank.get(existingByName.id)
      if (!currentMapping) {
        await prisma.$executeRaw`
          UPDATE "bank_accounts"
          SET "ledger_account_id" = ${coa.id}
          WHERE "id" = ${existingByName.id}
            AND "tenant_id" = ${tenantId}::uuid
            AND "ledger_account_id" IS NULL
        `
        mappedLedgerIds.add(coa.id)
      }
      skipped++
      continue
    }

    const bank = await prisma.bankAccount.create({
      data: {
        tenantId,
        accountName: coa.name,
        accountNumber: "TBD",
        bankName: extractBankName(coa.name),
        currency: "NGN",
        openingBalance: 0,
        currentBalance: 0,
      },
      select: { id: true },
    })
    await prisma.$executeRaw`
      UPDATE "bank_accounts"
      SET "ledger_account_id" = ${coa.id}
      WHERE "id" = ${bank.id} AND "tenant_id" = ${tenantId}::uuid
    `
    byName.set(coa.name.toLowerCase().trim(), { id: bank.id, accountName: coa.name })
    mappedLedgerIds.add(coa.id)
    names.push(coa.name)
    created++
  }

  revalidatePath("/banking/accounts")
  revalidatePath("/banking/reconciliation")
  return { created, skipped, names }
}

export async function updateBankAccount(id: string, formData: FormData) {
  try {
    const tenantId = await getOrgId();
    const accountName = String(formData.get("accountName") ?? "").trim();
    const accountNumber = String(formData.get("accountNumber") ?? "").trim();
    const bankName = String(formData.get("bankName") ?? "").trim();
    const currency = String(formData.get("currency") ?? "NGN") || "NGN";
    const openingBalance = parseFloat(String(formData.get("openingBalance") ?? "0")) || 0;
    const ledgerAccountId = String(formData.get("ledgerAccountId") ?? "").trim();

    if (!accountName || !accountNumber || !bankName || !ledgerAccountId) {
      return { error: "Account name, number, bank name, and ledger account are required" };
    }

    await prisma.$transaction(async (tx) => {
      const bankAccount = await tx.bankAccount.findFirst({
        where: { id, tenantId },
        select: { id: true },
      });
      if (!bankAccount) throw new Error("Bank account not found");

      await validateLedgerAccount(tx, tenantId, ledgerAccountId, id);
      await tx.bankAccount.update({
        where: { id },
        data: { accountName, accountNumber, bankName, currency, openingBalance },
      });
      await tx.$executeRaw`
        UPDATE "bank_accounts"
        SET "ledger_account_id" = ${ledgerAccountId}
        WHERE "id" = ${id} AND "tenant_id" = ${tenantId}::uuid
      `;
    });

    revalidatePath("/banking/accounts");
    revalidatePath("/banking/reconciliation");
    return { success: true };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Failed to update bank account" };
  }
}

export async function createBankAccount(formData: FormData) {
  try {
    const tenantId = await getOrgId();
    const accountName = String(formData.get("accountName") ?? "").trim();
    const accountNumber = String(formData.get("accountNumber") ?? "").trim();
    const bankName = String(formData.get("bankName") ?? "").trim();
    const currency = String(formData.get("currency") ?? "NGN") || "NGN";
    const openingBalance = parseFloat(String(formData.get("openingBalance") ?? "0")) || 0;
    const ledgerAccountId = String(formData.get("ledgerAccountId") ?? "").trim();

    if (!accountName || !accountNumber || !bankName || !ledgerAccountId) {
      return { error: "Account name, number, bank name, and ledger account are required" };
    }

    await prisma.$transaction(async (tx) => {
      await validateLedgerAccount(tx, tenantId, ledgerAccountId);
      const bankAccount = await tx.bankAccount.create({
        data: {
          tenantId,
          accountName,
          accountNumber,
          bankName,
          currency,
          openingBalance,
          currentBalance: openingBalance,
        },
        select: { id: true },
      });
      await tx.$executeRaw`
        UPDATE "bank_accounts"
        SET "ledger_account_id" = ${ledgerAccountId}
        WHERE "id" = ${bankAccount.id} AND "tenant_id" = ${tenantId}::uuid
      `;
    });

    revalidatePath("/banking/accounts");
    revalidatePath("/banking/reconciliation");
    return { success: true };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Failed to create bank account" };
  }
}
