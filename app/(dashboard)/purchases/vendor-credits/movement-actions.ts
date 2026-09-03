"use server";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertPeriodOpenInTransaction, postJournalEntryInTransaction, type JournalPostingLine } from "@/lib/journal";
import { resolveSystemAccount } from "@/lib/accounting/system-accounts";
import {
  consumeFxAdjustment,
  getActiveApFxAdjustment,
  getActiveVendorCreditFxAdjustment,
} from "@/lib/accounting/open-item-fx";
import { getRecognitionPeriod } from "@/lib/utils";

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundRate(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

async function actor() {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  const userId = session?.user?.id;
  const role = session?.user?.role;
  if (!tenantId || !userId) throw new Error("Your session has expired. Please sign in again.");
  if (!role || !["OWNER", "ADMIN", "ACCOUNTANT"].includes(role)) {
    throw new Error("You do not have permission to manage vendor credits.");
  }
  return { tenantId, userId };
}

interface VendorCreditRow {
  id: string;
  vendorId: string;
  creditNumber: string;
  creditDate: Date;
  currency: string;
  exchangeRate: unknown;
  totalAmount: unknown;
  appliedAmount: unknown;
  refundedAmount: unknown;
  remainingAmount: unknown;
  status: string;
}

async function lockCredit(tx: Prisma.TransactionClient, tenantId: string, creditId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:vendor-credit:${tenantId}:${creditId}`}))`;
}

async function getCredit(tx: Prisma.TransactionClient, tenantId: string, creditId: string) {
  const rows = await tx.$queryRaw<VendorCreditRow[]>`
    SELECT "id","vendor_id" AS "vendorId","credit_number" AS "creditNumber","credit_date" AS "creditDate",
           upper("currency") AS "currency","exchange_rate" AS "exchangeRate","total_amount" AS "totalAmount",
           "applied_amount" AS "appliedAmount","refunded_amount" AS "refundedAmount",
           "remaining_amount" AS "remainingAmount","status"
    FROM "vendor_credits"
    WHERE "id"=${creditId} AND "tenant_id"=${tenantId}::uuid
    LIMIT 1
  `;
  const credit = rows[0];
  if (!credit) throw new Error("Vendor credit not found.");
  if (credit.status !== "OPEN") throw new Error("This vendor credit is not available for use.");
  return credit;
}

async function getBaseCurrency(tx: Prisma.TransactionClient, tenantId: string) {
  const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } });
  if (!tenant) throw new Error("Organisation not found.");
  return tenant.currency.trim().toUpperCase();
}

export async function applyVendorCredit(input: {
  vendorCreditId: string;
  billId: string;
  amount: number;
  applicationDate: string;
}): Promise<{ success: true; applicationId: string } | { error: string }> {
  try {
    const { tenantId, userId } = await actor();
    const amount = roundMoney(Number(input.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Credit application amount must be greater than zero.");
    const applicationDate = new Date(`${input.applicationDate}T00:00:00`);
    if (Number.isNaN(applicationDate.getTime()) || applicationDate > new Date()) throw new Error("Enter a valid application date.");

    const applicationId = randomUUID();
    await prisma.$transaction(async (tx) => {
      await lockCredit(tx, tenantId, input.vendorCreditId);
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:bill:${tenantId}:${input.billId}`}))`;

      const credit = await getCredit(tx, tenantId, input.vendorCreditId);
      if (applicationDate < new Date(credit.creditDate)) throw new Error("Application date cannot be before the vendor credit date.");
      const preCreditBalance = roundMoney(Number(credit.remainingAmount));
      if (amount - preCreditBalance > 0.01) throw new Error("Application exceeds the remaining vendor credit.");

      const bill = await tx.bill.findFirst({
        where: { id: input.billId, tenantId },
        select: {
          id: true,
          vendorId: true,
          billNumber: true,
          billDate: true,
          dueDate: true,
          currency: true,
          exchangeRate: true,
          totalAmount: true,
          amountPaid: true,
          amountCredited: true,
          status: true,
        },
      });
      if (!bill) throw new Error("Bill not found.");
      if (bill.vendorId !== credit.vendorId) throw new Error("Vendor credit can only be applied to a Bill for the same vendor.");
      if (bill.currency.trim().toUpperCase() !== credit.currency) throw new Error("Vendor credit and Bill must use the same transaction currency.");
      if (!["RECORDED", "PARTIAL", "OVERDUE"].includes(bill.status)) throw new Error(`Bill ${bill.billNumber} is not open for settlement.`);
      if (applicationDate < new Date(bill.billDate)) throw new Error("Application date cannot be before the target Bill date.");

      const preApBalance = roundMoney(Number(bill.totalAmount) - Number(bill.amountPaid) - Number(bill.amountCredited));
      if (preApBalance <= 0.005) throw new Error(`Bill ${bill.billNumber} has no outstanding balance.`);
      if (amount - preApBalance > 0.01) throw new Error(`Application exceeds ${bill.billNumber}'s outstanding balance.`);

      const baseCurrency = await getBaseCurrency(tx, tenantId);
      const creditRate = Number(credit.exchangeRate);
      const billRate = Number(bill.exchangeRate);
      if (!Number.isFinite(creditRate) || creditRate <= 0 || !Number.isFinite(billRate) || billRate <= 0) {
        throw new Error("Foreign-currency carrying-rate evidence is invalid.");
      }
      if (credit.currency === baseCurrency && (Math.abs(creditRate - 1) > 0.000001 || Math.abs(billRate - 1) > 0.000001)) {
        throw new Error(`${baseCurrency} balances must carry an exchange rate of 1.`);
      }

      const activeCreditAdjustment = credit.currency === baseCurrency
        ? 0
        : await getActiveVendorCreditFxAdjustment(tx, tenantId, credit.id);
      const creditFxConsumed = consumeFxAdjustment(activeCreditAdjustment, amount, preCreditBalance);
      const activeApAdjustment = credit.currency === baseCurrency
        ? 0
        : await getActiveApFxAdjustment(tx, tenantId, bill.id);
      const apFxConsumed = consumeFxAdjustment(activeApAdjustment, amount, preApBalance);

      const baseHistoricalCredit = roundMoney(amount * creditRate);
      const baseCreditAmount = roundMoney(baseHistoricalCredit + creditFxConsumed);
      const baseHistoricalAp = roundMoney(amount * billRate);
      const baseApAmount = roundMoney(baseHistoricalAp + apFxConsumed);
      const fxDifference = roundMoney(baseApAmount - baseCreditAmount);

      const [vendorCreditAccount, apAccount] = await Promise.all([
        resolveSystemAccount(tx, tenantId, "VENDOR_CREDIT"),
        resolveSystemAccount(tx, tenantId, "ACCOUNTS_PAYABLE", "CL-001"),
      ]);
      const lines: JournalPostingLine[] = [
        { accountId: apAccount.id, description: `AP cleared by vendor credit - ${bill.billNumber}`, debit: baseApAmount, credit: 0 },
        { accountId: vendorCreditAccount.id, description: `Vendor credit applied - ${credit.creditNumber}`, debit: 0, credit: baseCreditAmount },
      ];
      if (fxDifference > 0.01) {
        const fxGain = await resolveSystemAccount(tx, tenantId, "FX_GAIN");
        lines.push({ accountId: fxGain.id, description: `Realised FX gain - ${credit.creditNumber}`, debit: 0, credit: fxDifference });
      } else if (fxDifference < -0.01) {
        const fxLoss = await resolveSystemAccount(tx, tenantId, "FX_LOSS");
        lines.push({ accountId: fxLoss.id, description: `Realised FX loss - ${credit.creditNumber}`, debit: Math.abs(fxDifference), credit: 0 });
      }

      const period = getRecognitionPeriod(applicationDate);
      await assertPeriodOpenInTransaction(tx, tenantId, period);
      const journalEntryId = await postJournalEntryInTransaction(tx, {
        tenantId,
        createdBy: userId,
        entryDate: applicationDate,
        reference: `VC-APP-${applicationId.slice(0, 8).toUpperCase()}`,
        description: `Apply vendor credit ${credit.creditNumber} to ${bill.billNumber}`,
        recognitionPeriod: period,
        source: "vendor_credit_application",
        sourceId: applicationId,
        lines,
      });

      await tx.$executeRaw`
        INSERT INTO "vendor_credit_applications" (
          "id","tenant_id","vendor_credit_id","bill_id","application_date","application_type","amount",
          "base_historical_ap_amount","fx_unrealized_consumed","base_ap_amount",
          "base_historical_credit_amount","credit_fx_unrealized_consumed","base_credit_amount","fx_gain_loss",
          "journal_entry_id","status"
        ) VALUES (
          ${applicationId},${tenantId}::uuid,${credit.id},${bill.id},${applicationDate},'LATER',${amount},
          ${baseHistoricalAp},${apFxConsumed},${baseApAmount},
          ${baseHistoricalCredit},${creditFxConsumed},${baseCreditAmount},${fxDifference},
          ${journalEntryId},'POSTED'
        )
      `;

      const newApplied = roundMoney(Number(credit.appliedAmount) + amount);
      const newRemaining = Math.max(0, roundMoney(preCreditBalance - amount));
      await tx.$executeRaw`
        UPDATE "vendor_credits"
        SET "applied_amount"=${newApplied}, "remaining_amount"=${newRemaining},
            "status"=${newRemaining <= 0.01 ? "CLOSED" : "OPEN"}
        WHERE "id"=${credit.id} AND "tenant_id"=${tenantId}::uuid
      `;

      const newCredited = roundMoney(Number(bill.amountCredited) + amount);
      const newOutstanding = Math.max(0, roundMoney(Number(bill.totalAmount) - Number(bill.amountPaid) - newCredited));
      const newStatus = newOutstanding <= 0.01
        ? "SETTLED"
        : new Date(bill.dueDate) < applicationDate
          ? "OVERDUE"
          : "PARTIAL";
      await tx.bill.update({ where: { id: bill.id }, data: { amountCredited: newCredited, status: newStatus } });
    });

    revalidatePath("/purchases/vendor-credits");
    revalidatePath("/purchases/bills");
    revalidatePath(`/purchases/bills/${input.billId}`);
    revalidatePath("/accounting/balance-sheet");
    revalidatePath("/accounting/fx-revaluation");
    return { success: true, applicationId };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Vendor credit could not be applied." };
  }
}

export async function refundVendorCredit(input: {
  vendorCreditId: string;
  bankAccountId: string;
  amount: number;
  refundDate: string;
  exchangeRate: number;
  exchangeRateSource?: "MANUAL" | "SYSTEM" | "INTEGRATION";
  reference?: string;
  notes?: string;
}): Promise<{ success: true; refundId: string } | { error: string }> {
  try {
    const { tenantId, userId } = await actor();
    const amount = roundMoney(Number(input.amount));
    const refundRate = roundRate(Number(input.exchangeRate));
    const rateSource = input.exchangeRateSource ?? "MANUAL";
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Refund amount must be greater than zero.");
    if (!Number.isFinite(refundRate) || refundRate <= 0) throw new Error("Enter a valid refund exchange rate.");
    const refundDate = new Date(`${input.refundDate}T00:00:00`);
    if (Number.isNaN(refundDate.getTime()) || refundDate > new Date()) throw new Error("Enter a valid refund date.");

    const refundId = randomUUID();
    await prisma.$transaction(async (tx) => {
      await lockCredit(tx, tenantId, input.vendorCreditId);
      const credit = await getCredit(tx, tenantId, input.vendorCreditId);
      if (refundDate < new Date(credit.creditDate)) throw new Error("Refund date cannot be before the vendor credit date.");
      const preCreditBalance = roundMoney(Number(credit.remainingAmount));
      if (amount - preCreditBalance > 0.01) throw new Error("Refund exceeds the remaining vendor credit.");

      const baseCurrency = await getBaseCurrency(tx, tenantId);
      if (credit.currency === baseCurrency && Math.abs(refundRate - 1) > 0.000001) {
        throw new Error(`${baseCurrency} refunds must use an exchange rate of 1.`);
      }

      const banks = await tx.$queryRaw<Array<{
        ledgerAccountId: string | null;
        currency: string;
        ledgerType: string | null;
        active: boolean | null;
      }>>`
        SELECT ba."ledger_account_id" AS "ledgerAccountId", upper(ba."currency") AS "currency",
               coa."type"::text AS "ledgerType", coa."is_active" AS "active"
        FROM "bank_accounts" ba
        LEFT JOIN "chart_of_accounts" coa ON coa."id"=ba."ledger_account_id" AND coa."tenant_id"=ba."tenant_id"
        WHERE ba."id"=${input.bankAccountId} AND ba."tenant_id"=${tenantId}::uuid AND ba."is_active"=true
        LIMIT 1
      `;
      const bank = banks[0];
      if (!bank || !bank.ledgerAccountId || bank.ledgerType !== "ASSET" || bank.active !== true) {
        throw new Error("Select an active receiving bank account mapped to an Asset ledger account.");
      }
      if (bank.currency !== credit.currency) throw new Error("Supplier refund bank account must use the same currency as the vendor credit.");

      const creditRate = Number(credit.exchangeRate);
      if (!Number.isFinite(creditRate) || creditRate <= 0) throw new Error("Vendor-credit exchange-rate evidence is invalid.");
      const activeCreditAdjustment = credit.currency === baseCurrency
        ? 0
        : await getActiveVendorCreditFxAdjustment(tx, tenantId, credit.id);
      const creditFxConsumed = consumeFxAdjustment(activeCreditAdjustment, amount, preCreditBalance);
      const baseHistoricalCredit = roundMoney(amount * creditRate);
      const baseCreditAmount = roundMoney(baseHistoricalCredit + creditFxConsumed);
      const baseSettlementAmount = roundMoney(amount * refundRate);
      const fxDifference = roundMoney(baseSettlementAmount - baseCreditAmount);

      const vendorCreditAccount = await resolveSystemAccount(tx, tenantId, "VENDOR_CREDIT");
      const lines: JournalPostingLine[] = [
        { accountId: bank.ledgerAccountId, description: `Supplier refund - ${credit.creditNumber}`, debit: baseSettlementAmount, credit: 0 },
        { accountId: vendorCreditAccount.id, description: `Vendor credit refunded - ${credit.creditNumber}`, debit: 0, credit: baseCreditAmount },
      ];
      if (fxDifference > 0.01) {
        const fxGain = await resolveSystemAccount(tx, tenantId, "FX_GAIN");
        lines.push({ accountId: fxGain.id, description: `Realised FX gain - ${credit.creditNumber}`, debit: 0, credit: fxDifference });
      } else if (fxDifference < -0.01) {
        const fxLoss = await resolveSystemAccount(tx, tenantId, "FX_LOSS");
        lines.push({ accountId: fxLoss.id, description: `Realised FX loss - ${credit.creditNumber}`, debit: Math.abs(fxDifference), credit: 0 });
      }

      const period = getRecognitionPeriod(refundDate);
      await assertPeriodOpenInTransaction(tx, tenantId, period);
      const journalEntryId = await postJournalEntryInTransaction(tx, {
        tenantId,
        createdBy: userId,
        entryDate: refundDate,
        reference: input.reference?.trim() || `VC-REF-${refundId.slice(0, 8).toUpperCase()}`,
        description: `Supplier refund of vendor credit ${credit.creditNumber}`,
        recognitionPeriod: period,
        source: "vendor_credit_refund",
        sourceId: refundId,
        lines,
      });

      await tx.$executeRaw`
        INSERT INTO "vendor_credit_refunds" (
          "id","tenant_id","vendor_credit_id","bank_account_id","amount","currency","exchange_rate",
          "base_historical_credit_amount","credit_fx_unrealized_consumed","base_credit_amount","base_settlement_amount","fx_gain_loss",
          "journal_entry_id","status","refunded_at","reference","notes","created_by",
          "exchange_rate_source","exchange_rate_entered_by","exchange_rate_entered_at"
        ) VALUES (
          ${refundId},${tenantId}::uuid,${credit.id},${input.bankAccountId},${amount},${credit.currency},${refundRate},
          ${baseHistoricalCredit},${creditFxConsumed},${baseCreditAmount},${baseSettlementAmount},${fxDifference},
          ${journalEntryId},'POSTED',${refundDate},${input.reference?.trim() || null},${input.notes?.trim() || null},${userId},
          ${rateSource},${userId},now()
        )
      `;

      const newRefunded = roundMoney(Number(credit.refundedAmount) + amount);
      const newRemaining = Math.max(0, roundMoney(preCreditBalance - amount));
      await tx.$executeRaw`
        UPDATE "vendor_credits"
        SET "refunded_amount"=${newRefunded}, "remaining_amount"=${newRemaining},
            "status"=${newRemaining <= 0.01 ? "CLOSED" : "OPEN"}
        WHERE "id"=${credit.id} AND "tenant_id"=${tenantId}::uuid
      `;
    });

    revalidatePath("/purchases/vendor-credits");
    revalidatePath("/banking");
    revalidatePath("/accounting/balance-sheet");
    revalidatePath("/accounting/fx-revaluation");
    return { success: true, refundId };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Vendor credit could not be refunded." };
  }
}
