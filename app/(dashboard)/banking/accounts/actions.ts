"use server";

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

export async function syncBankAccountsFromCoa(): Promise<{
  created: number
  skipped: number
  names: string[]
}> {
  const tenantId = await getOrgId()

  const coaAccounts = await prisma.chartOfAccounts.findMany({
    where: {
      tenantId,
      type: "ASSET",
      OR: [
        { subtype: { equals: "Bank", mode: "insensitive" } },
        { subtype: { equals: "Cash", mode: "insensitive" } },
      ],
    },
    select: { name: true },
  })

  if (!coaAccounts.length) return { created: 0, skipped: 0, names: [] }

  const existing = await prisma.bankAccount.findMany({
    where: { tenantId },
    select: { accountName: true },
  })
  const existingNames = new Set(existing.map((a) => a.accountName.toLowerCase().trim()))

  let created = 0
  let skipped = 0
  const names: string[] = []

  for (const coa of coaAccounts) {
    const key = coa.name.toLowerCase().trim()
    if (existingNames.has(key)) { skipped++; continue }

    await prisma.bankAccount.create({
      data: {
        tenantId,
        accountName: coa.name,
        accountNumber: "TBD",
        bankName: extractBankName(coa.name),
        currency: "NGN",
        openingBalance: 0,
        currentBalance: 0,
      },
    })
    existingNames.add(key)
    names.push(coa.name)
    created++
  }

  revalidatePath("/banking/accounts")
  return { created, skipped, names }
}

export async function updateBankAccount(id: string, formData: FormData) {
  try {
    const tenantId = await getOrgId();
    const accountName = (formData.get("accountName") as string).trim();
    const accountNumber = (formData.get("accountNumber") as string).trim();
    const bankName = (formData.get("bankName") as string).trim();
    const currency = (formData.get("currency") as string) || "NGN";
    const openingBalance = parseFloat(formData.get("openingBalance") as string) || 0;

    if (!accountName || !accountNumber || !bankName) {
      return { error: "Account name, number, and bank name are required" };
    }

    await prisma.bankAccount.updateMany({
      where: { id, tenantId },
      data: { accountName, accountNumber, bankName, currency, openingBalance },
    });

    revalidatePath("/banking/accounts");
    return { success: true };
  } catch {
    return { error: "Failed to update bank account" };
  }
}

export async function createBankAccount(formData: FormData) {
  try {
    const tenantId = await getOrgId();
    const accountName = (formData.get("accountName") as string).trim();
    const accountNumber = (formData.get("accountNumber") as string).trim();
    const bankName = (formData.get("bankName") as string).trim();
    const currency = (formData.get("currency") as string) || "NGN";
    const openingBalance = parseFloat(formData.get("openingBalance") as string) || 0;

    if (!accountName || !accountNumber || !bankName) {
      return { error: "Account name, number, and bank name are required" };
    }

    await prisma.bankAccount.create({
      data: {
        tenantId,
        accountName,
        accountNumber,
        bankName,
        currency,
        openingBalance,
        currentBalance: openingBalance,
      },
    });

    revalidatePath("/banking/accounts");
    return { success: true };
  } catch {
    return { error: "Failed to create bank account" };
  }
}
