"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { postJournalEntryInTransaction, type JournalPostingLine } from "@/lib/journal";
import { resolveSystemAccount } from "@/lib/accounting/system-accounts";
import { consumeFxAdjustment, getActiveApFxAdjustment } from "@/lib/accounting/open-item-fx";
import { getRecognitionPeriod } from "@/lib/utils";

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundRate(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

async function lockBills(tx: Prisma.TransactionClient, tenantId: string, billIds: string[]) {
  for (const billId of [...new Set(billIds)].sort()) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:bill:${tenantId}:${billId}`}))`;
  }
}

export async function recordBillPayment(data: {
  vendorId: string;
  paymentDate: string;
  amount: number;
  method: string;
  reference?: string;
  whtAmount: number;
  bankAccountId?: string;
  currency: string;
  exchangeRate: number;
  exchangeRateSource?: "MANUAL" | "SYSTEM" | "INTEGRATION";
  billAllocations: { billId: string; amount: number }[];
}) {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  const userId = session?.user?.id;
  const role = session?.user?.role;
  if (!tenantId || !userId) return { error: "Unauthorized" };
  if (!role || !["OWNER", "ADMIN", "ACCOUNTANT"].includes(role)) {
    return { error: "You do not have permission to record vendor payments." };
  }

  const grossSettled = roundMoney(Number(data.amount));
  const whtAmount = roundMoney(Number(data.whtAmount ?? 0));
  const cashAmount = roundMoney(grossSettled - whtAmount);
  const currency = String(data.currency || "").trim().toUpperCase();
  const exchangeRate = roundRate(Number(data.exchangeRate));
  const exchangeRateSource = data.exchangeRateSource ?? "MANUAL";

  if (!/^[A-Z]{3}$/.test(currency)) return { error: "A valid 3-letter payment currency is required." };
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) return { error: "A valid payment exchange rate is required." };
  if (!["MANUAL", "SYSTEM", "INTEGRATION"].includes(exchangeRateSource)) return { error: "Invalid exchange-rate source." };
  if (!Number.isFinite(grossSettled) || grossSettled <= 0) return { error: "Gross amount settled must be greater than zero." };
  if (!Number.isFinite(whtAmount) || whtAmount < 0 || whtAmount - grossSettled > 0.01) return { error: "WHT amount must be between zero and the gross amount settled." };
  if (cashAmount > 0.005 && !data.bankAccountId) return { error: "Select the account the vendor payment was made from." };
  if (!data.billAllocations.length) return { error: "Allocate the payment to at least one bill." };

  const totalAllocated = roundMoney(data.billAllocations.reduce((sum, allocation) => sum + Number(allocation.amount), 0));
  if (Math.abs(totalAllocated - grossSettled) > 0.01) {
    return { error: `Allocated amount must equal gross AP settled (${grossSettled.toFixed(2)} ${currency}).` };
  }

  const paymentDate = new Date(`${data.paymentDate}T00:00:00`);
  if (Number.isNaN(paymentDate.getTime())) return { error: "A valid payment date is required." };
  if (paymentDate > new Date()) return { error: "Payment date cannot be in the future." };

  try {
    const paymentId = await prisma.$transaction(async (tx) => {
      const [vendor, tenant] = await Promise.all([
        tx.vendor.findFirst({ where: { id: data.vendorId, tenantId }, select: { id: true } }),
        tx.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } }),
      ]);
      if (!vendor) throw new Error("Vendor not found in this organisation.");
      if (!tenant) throw new Error("Organisation not found.");
      const baseCurrency = tenant.currency.trim().toUpperCase();
      if (currency === baseCurrency && Math.abs(exchangeRate - 1) > 0.000001) {
        throw new Error(`${baseCurrency} is this entity's base currency and must use an exchange rate of 1.`);
      }

      const billIds = Array.from(new Set(data.billAllocations.map((allocation) => allocation.billId)));
      if (billIds.length !== data.billAllocations.length) throw new Error("Duplicate bill allocation detected.");
      await lockBills(tx, tenantId, billIds);

      const bills = await tx.bill.findMany({
        where: { tenantId, vendorId: data.vendorId, id: { in: billIds } },
        select: {
          id: true,
          billNumber: true,
          totalAmount: true,
          amountPaid: true,
          status: true,
          currency: true,
          exchangeRate: true,
        },
      });
      if (bills.length !== billIds.length) {
        throw new Error("One or more allocated bills are invalid or belong to another organisation/vendor.");
      }
      const billMap = new Map(bills.map((bill) => [bill.id, bill]));

      for (const allocation of data.billAllocations) {
        const amount = roundMoney(Number(allocation.amount));
        if (!Number.isFinite(amount) || amount <= 0) throw new Error("Bill allocation must be greater than zero.");
        const bill = billMap.get(allocation.billId)!;
        if (bill.currency.trim().toUpperCase() !== currency) {
          throw new Error(`Bill ${bill.billNumber} is denominated in ${bill.currency}. One vendor payment can only settle bills in the same currency as the payment.`);
        }
        if (["DRAFT", "PAID"].includes(bill.status)) {
          throw new Error(`Bill ${bill.billNumber} cannot receive a payment while ${bill.status}.`);
        }
        const outstanding = roundMoney(Number(bill.totalAmount) - Number(bill.amountPaid));
        if (amount - outstanding > 0.01) throw new Error(`Allocation to ${bill.billNumber} exceeds its outstanding balance.`);
      }

      let payingLedgerAccountId: string | null = null;
      if (cashAmount > 0.005) {
        const bankRows = await tx.$queryRaw<Array<{
          id: string;
          currency: string;
          ledgerAccountId: string | null;
          ledgerType: string | null;
          ledgerActive: boolean | null;
        }>>`
          SELECT ba."id", ba."currency", ba."ledger_account_id" AS "ledgerAccountId",
                 coa."type"::text AS "ledgerType", coa."is_active" AS "ledgerActive"
          FROM "bank_accounts" ba
          LEFT JOIN "chart_of_accounts" coa
            ON coa."id" = ba."ledger_account_id" AND coa."tenant_id" = ba."tenant_id"
          WHERE ba."id" = ${data.bankAccountId}
            AND ba."tenant_id" = ${tenantId}::uuid
            AND ba."is_active" = true
          LIMIT 1
        `;
        const bank = bankRows[0];
        if (!bank) throw new Error("Select an active payment account that belongs to this entity.");
        if (bank.currency.trim().toUpperCase() !== currency) {
          throw new Error(`This bill is denominated in ${currency}. Select a ${currency} account to record this payment.`);
        }
        if (!bank.ledgerAccountId || bank.ledgerType !== "ASSET" || bank.ledgerActive !== true) {
          throw new Error("The selected payment account is not mapped to an active Asset ledger account. Map it in Banking before recording this payment.");
        }
        payingLedgerAccountId = bank.ledgerAccountId;
      }

      const allocationEvidence: Array<{
        billId: string;
        amount: number;
        baseHistoricalApAmount: number;
        fxUnrealizedConsumed: number;
        baseApAmount: number;
        baseSettlementAmount: number;
      }> = [];

      for (const allocation of data.billAllocations) {
        const bill = billMap.get(allocation.billId)!;
        const amount = roundMoney(Number(allocation.amount));
        const billRate = Number(bill.exchangeRate);
        if (!Number.isFinite(billRate) || billRate <= 0) throw new Error(`Bill ${bill.billNumber} has an invalid exchange rate.`);
        const outstanding = roundMoney(Number(bill.totalAmount) - Number(bill.amountPaid));
        const activeAdjustment = currency === baseCurrency ? 0 : await getActiveApFxAdjustment(tx, tenantId, bill.id);
        const consumed = consumeFxAdjustment(activeAdjustment, amount, outstanding);
        const historical = roundMoney(amount * billRate);
        allocationEvidence.push({
          billId: bill.id,
          amount,
          baseHistoricalApAmount: historical,
          fxUnrealizedConsumed: consumed,
          baseApAmount: roundMoney(historical + consumed),
          baseSettlementAmount: roundMoney(amount * exchangeRate),
        });
      }

      const baseApCleared = roundMoney(allocationEvidence.reduce((sum, allocation) => sum + allocation.baseApAmount, 0));
      const baseSettlementAmount = roundMoney(allocationEvidence.reduce((sum, allocation) => sum + allocation.baseSettlementAmount, 0));
      const baseCashAmount = roundMoney(cashAmount * exchangeRate);
      const baseWhtAmount = roundMoney(whtAmount * exchangeRate);
      const fxDifference = roundMoney(baseSettlementAmount - baseApCleared);

      const [apAccount, whtAccount, fxGainAccount, fxLossAccount] = await Promise.all([
        resolveSystemAccount(tx, tenantId, "ACCOUNTS_PAYABLE", "CL-001"),
        whtAmount > 0.005 ? resolveSystemAccount(tx, tenantId, "WHT_PAYABLE", "CL-002") : Promise.resolve(null),
        fxDifference < -0.01 ? resolveSystemAccount(tx, tenantId, "FX_GAIN") : Promise.resolve(null),
        fxDifference > 0.01 ? resolveSystemAccount(tx, tenantId, "FX_LOSS") : Promise.resolve(null),
      ]);

      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:vendor-payment:${tenantId}`}))`;
      const count = await tx.vendorPayment.count({ where: { tenantId } });
      const paymentNumber = `VPY-${String(count + 1).padStart(5, "0")}`;
      const payment = await tx.vendorPayment.create({
        data: {
          tenantId,
          vendorId: data.vendorId,
          paymentNumber,
          paymentDate,
          amount: grossSettled,
          method: data.method as "BANK_TRANSFER" | "CHECK" | "CASH" | "CARD",
          reference: data.reference?.trim() || null,
          whtAmount,
        },
        select: { id: true },
      });

      await tx.$executeRaw`
        UPDATE "vendor_payments"
        SET "bank_account_id" = ${cashAmount > 0.005 ? data.bankAccountId! : null},
            "currency" = ${currency},
            "exchange_rate" = ${exchangeRate},
            "base_settlement_amount" = ${baseSettlementAmount},
            "base_ap_amount" = ${baseApCleared},
            "fx_gain_loss" = ${roundMoney(-fxDifference)},
            "exchange_rate_source" = ${exchangeRateSource},
            "exchange_rate_entered_by" = ${userId},
            "exchange_rate_entered_at" = now()
        WHERE "id" = ${payment.id} AND "tenant_id" = ${tenantId}::uuid
      `;

      for (const evidence of allocationEvidence) {
        await tx.$executeRaw`
          INSERT INTO "vendor_payment_allocations" (
            "tenant_id", "payment_id", "bill_id", "amount",
            "base_historical_ap_amount", "fx_unrealized_consumed",
            "base_ap_amount", "base_settlement_amount"
          ) VALUES (
            ${tenantId}::uuid, ${payment.id}, ${evidence.billId}, ${evidence.amount},
            ${evidence.baseHistoricalApAmount}, ${evidence.fxUnrealizedConsumed},
            ${evidence.baseApAmount}, ${evidence.baseSettlementAmount}
          )
        `;

        const bill = billMap.get(evidence.billId)!;
        const newPaid = roundMoney(Number(bill.amountPaid) + evidence.amount);
        const newBalance = Math.max(0, roundMoney(Number(bill.totalAmount) - newPaid));
        const newStatus = newBalance <= 0.01 ? "PAID" : "PARTIAL";
        await tx.bill.update({ where: { id: evidence.billId }, data: { amountPaid: newPaid, status: newStatus } });
      }

      const lines: JournalPostingLine[] = [
        { accountId: apAccount.id, description: `AP carrying value cleared - ${paymentNumber}`, debit: baseApCleared, credit: 0 },
      ];
      if (fxLossAccount && fxDifference > 0.01) {
        lines.push({ accountId: fxLossAccount.id, description: `Realised FX loss - ${paymentNumber}`, debit: fxDifference, credit: 0 });
      }
      if (payingLedgerAccountId && baseCashAmount > 0.005) {
        lines.push({ accountId: payingLedgerAccountId, description: `Vendor payment - ${paymentNumber}`, debit: 0, credit: baseCashAmount });
      }
      if (whtAccount && baseWhtAmount > 0.005) {
        lines.push({ accountId: whtAccount.id, description: `WHT payable - ${paymentNumber}`, debit: 0, credit: baseWhtAmount });
      }
      if (fxGainAccount && fxDifference < -0.01) {
        lines.push({ accountId: fxGainAccount.id, description: `Realised FX gain - ${paymentNumber}`, debit: 0, credit: Math.abs(fxDifference) });
      }

      await postJournalEntryInTransaction(tx, {
        tenantId,
        createdBy: userId,
        entryDate: paymentDate,
        reference: paymentNumber,
        description: `Vendor payment ${paymentNumber}${currency !== baseCurrency ? ` (${currency} @ ${exchangeRate})` : ""}`,
        recognitionPeriod: getRecognitionPeriod(paymentDate),
        source: "vendor_payment",
        sourceId: payment.id,
        lines,
      });

      return payment.id;
    });

    revalidatePath("/purchases/bills");
    revalidatePath("/purchases/payments");
    return { success: true, id: paymentId };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
