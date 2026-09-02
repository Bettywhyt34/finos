"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { postJournalEntryInTransaction, type JournalPostingLine } from "@/lib/journal";
import { resolveSystemAccount } from "@/lib/accounting/system-accounts";
import { consumeFxAdjustment, getActiveArFxAdjustment } from "@/lib/accounting/open-item-fx";
import { getRecognitionPeriod } from "@/lib/utils";

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundRate(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

async function getActor() {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  const userId = session?.user?.id;
  const role = session?.user?.role;
  if (!tenantId || !userId) throw new Error("Your session has expired. Please sign in again.");
  if (!role || !["OWNER", "ADMIN", "ACCOUNTANT"].includes(role)) {
    throw new Error("You do not have permission to manage customer credits.");
  }
  return { tenantId, userId };
}

export async function applyCustomerCredit(input: {
  customerCreditId: string;
  invoiceId: string;
  amount: number;
  applicationDate: string;
}): Promise<{ success: true; applicationId: string } | { error: string }> {
  try {
    const { tenantId, userId } = await getActor();
    const amount = roundMoney(Number(input.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Credit application amount must be greater than zero.");
    const applicationDate = new Date(`${input.applicationDate}T00:00:00`);
    if (Number.isNaN(applicationDate.getTime()) || applicationDate > new Date()) throw new Error("Enter a valid application date.");

    const applicationId = crypto.randomUUID();
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:customer-credit:${tenantId}:${input.customerCreditId}`}))`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:invoice:${tenantId}:${input.invoiceId}`}))`;

      const credits = await tx.$queryRaw<Array<{
        id: string; customerId: string; currency: string; exchangeRate: unknown;
        remainingAmount: unknown; remainingBaseAmount: unknown; status: string;
      }>>`
        SELECT "id", "customer_id" AS "customerId", "currency", "exchange_rate" AS "exchangeRate",
               "remaining_amount" AS "remainingAmount", "remaining_base_amount" AS "remainingBaseAmount", "status"
        FROM "customer_credits"
        WHERE "id"=${input.customerCreditId} AND "tenant_id"=${tenantId}::uuid
        LIMIT 1
      `;
      const credit = credits[0];
      if (!credit) throw new Error("Customer credit not found.");
      if (credit.status !== "OPEN") throw new Error("This customer credit is not available for use.");
      if (amount - Number(credit.remainingAmount) > 0.01) throw new Error("Application exceeds the remaining customer credit.");

      const invoice = await tx.invoice.findFirst({
        where: { id: input.invoiceId, tenantId },
        select: { id: true, customerId: true, invoiceNumber: true, currency: true, exchangeRate: true, balanceDue: true, amountPaid: true, status: true },
      });
      if (!invoice) throw new Error("Invoice not found.");
      if (invoice.customerId !== credit.customerId) throw new Error("Customer credit can only be applied to another invoice for the same customer.");
      if (invoice.currency.toUpperCase() !== credit.currency.toUpperCase()) throw new Error("Customer credit and invoice must use the same transaction currency.");
      if (!["SENT", "PARTIAL", "OVERDUE"].includes(invoice.status)) throw new Error(`Invoice ${invoice.invoiceNumber} is not open for settlement.`);
      const preBalance = roundMoney(Number(invoice.balanceDue));
      if (amount - preBalance > 0.01) throw new Error(`Application exceeds invoice ${invoice.invoiceNumber}'s outstanding balance.`);

      const creditRate = Number(credit.exchangeRate);
      const invoiceRate = Number(invoice.exchangeRate);
      if (!Number.isFinite(creditRate) || creditRate <= 0 || !Number.isFinite(invoiceRate) || invoiceRate <= 0) throw new Error("Foreign-currency carrying-rate evidence is invalid.");

      const activeArAdjustment = await getActiveArFxAdjustment(tx, tenantId, invoice.id);
      const fxUnrealizedConsumed = consumeFxAdjustment(activeArAdjustment, amount, preBalance);
      const baseCreditAmount = roundMoney(amount * creditRate);
      const baseArAmount = roundMoney(amount * invoiceRate + fxUnrealizedConsumed);
      const fxDifference = roundMoney(baseCreditAmount - baseArAmount);

      const [creditLiability, arAccount] = await Promise.all([
        resolveSystemAccount(tx, tenantId, "CUSTOMER_CREDIT"),
        resolveSystemAccount(tx, tenantId, "ACCOUNTS_RECEIVABLE", "CA-001"),
      ]);
      const lines: JournalPostingLine[] = [
        { accountId: creditLiability.id, description: `Customer credit applied - ${invoice.invoiceNumber}`, debit: baseCreditAmount, credit: 0 },
        { accountId: arAccount.id, description: `AR cleared by customer credit - ${invoice.invoiceNumber}`, debit: 0, credit: baseArAmount },
      ];
      if (fxDifference > 0.01) {
        const fxGain = await resolveSystemAccount(tx, tenantId, "FX_GAIN");
        lines.push({ accountId: fxGain.id, description: `Realised FX gain on customer credit - ${invoice.invoiceNumber}`, debit: 0, credit: fxDifference });
      } else if (fxDifference < -0.01) {
        const fxLoss = await resolveSystemAccount(tx, tenantId, "FX_LOSS");
        lines.push({ accountId: fxLoss.id, description: `Realised FX loss on customer credit - ${invoice.invoiceNumber}`, debit: Math.abs(fxDifference), credit: 0 });
      }

      const journalEntryId = await postJournalEntryInTransaction(tx, {
        tenantId,
        createdBy: userId,
        entryDate: applicationDate,
        reference: `CC-APP-${applicationId.slice(0, 8).toUpperCase()}`,
        description: `Apply customer credit to ${invoice.invoiceNumber}`,
        recognitionPeriod: getRecognitionPeriod(applicationDate),
        source: "customer_credit_application",
        sourceId: applicationId,
        lines,
      });

      await tx.$executeRaw`
        INSERT INTO "customer_credit_applications" (
          "id","tenant_id","customer_credit_id","invoice_id","amount","base_credit_amount","base_ar_amount",
          "fx_unrealized_consumed","journal_entry_id","status","applied_at","created_by"
        ) VALUES (
          ${applicationId},${tenantId}::uuid,${credit.id},${invoice.id},${amount},${baseCreditAmount},${baseArAmount},
          ${fxUnrealizedConsumed},${journalEntryId},'POSTED',${applicationDate},${userId}
        )
      `;

      const newRemaining = Math.max(0, roundMoney(Number(credit.remainingAmount) - amount));
      const newRemainingBase = Math.max(0, roundMoney(newRemaining * creditRate));
      await tx.$executeRaw`
        UPDATE "customer_credits"
        SET "remaining_amount"=${newRemaining}, "remaining_base_amount"=${newRemainingBase},
            "status"=${newRemaining <= 0.01 ? "CLOSED" : "OPEN"}, "updated_at"=now()
        WHERE "id"=${credit.id} AND "tenant_id"=${tenantId}::uuid
      `;

      const newBalance = Math.max(0, roundMoney(preBalance - amount));
      const status = newBalance <= 0.01 ? (Number(invoice.amountPaid) > 0.01 ? "PARTIAL" : "SENT") : (Number(invoice.amountPaid) > 0.01 ? "PARTIAL" : invoice.status);
      await tx.invoice.update({ where: { id: invoice.id }, data: { balanceDue: newBalance, status, paidAt: null } });
    });

    revalidatePath("/sales/customer-credits");
    revalidatePath("/sales/invoices");
    revalidatePath(`/sales/invoices/${input.invoiceId}`);
    revalidatePath("/accounting/balance-sheet");
    return { success: true, applicationId };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Customer credit could not be applied." };
  }
}

export async function refundCustomerCredit(input: {
  customerCreditId: string;
  bankAccountId: string;
  amount: number;
  refundDate: string;
  exchangeRate: number;
  reference?: string;
  notes?: string;
}): Promise<{ success: true; refundId: string } | { error: string }> {
  try {
    const { tenantId, userId } = await getActor();
    const amount = roundMoney(Number(input.amount));
    const refundRate = roundRate(Number(input.exchangeRate));
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Refund amount must be greater than zero.");
    if (!Number.isFinite(refundRate) || refundRate <= 0) throw new Error("Enter a valid refund exchange rate.");
    const refundDate = new Date(`${input.refundDate}T00:00:00`);
    if (Number.isNaN(refundDate.getTime()) || refundDate > new Date()) throw new Error("Enter a valid refund date.");

    const refundId = crypto.randomUUID();
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:customer-credit:${tenantId}:${input.customerCreditId}`}))`;
      const credits = await tx.$queryRaw<Array<{
        id: string; currency: string; exchangeRate: unknown; remainingAmount: unknown; status: string;
      }>>`
        SELECT "id","currency","exchange_rate" AS "exchangeRate","remaining_amount" AS "remainingAmount","status"
        FROM "customer_credits" WHERE "id"=${input.customerCreditId} AND "tenant_id"=${tenantId}::uuid LIMIT 1
      `;
      const credit = credits[0];
      if (!credit) throw new Error("Customer credit not found.");
      if (credit.status !== "OPEN") throw new Error("This customer credit is not available for refund.");
      if (amount - Number(credit.remainingAmount) > 0.01) throw new Error("Refund exceeds the remaining customer credit.");
      if (credit.currency === "NGN" && Math.abs(refundRate - 1) > 0.000001) throw new Error("NGN refunds must use an exchange rate of 1.");

      const banks = await tx.$queryRaw<Array<{ ledgerAccountId: string | null; currency: string; type: string | null; active: boolean | null }>>`
        SELECT ba."ledger_account_id" AS "ledgerAccountId", ba."currency", coa."type"::text AS "type", coa."is_active" AS "active"
        FROM "bank_accounts" ba
        LEFT JOIN "chart_of_accounts" coa ON coa."id"=ba."ledger_account_id" AND coa."tenant_id"=ba."tenant_id"
        WHERE ba."id"=${input.bankAccountId} AND ba."tenant_id"=${tenantId}::uuid AND ba."is_active"=true LIMIT 1
      `;
      const bank = banks[0];
      if (!bank || !bank.ledgerAccountId || bank.type !== "ASSET" || bank.active !== true) throw new Error("Select an active refund bank account mapped to an Asset ledger account.");
      if (bank.currency.toUpperCase() !== credit.currency.toUpperCase()) throw new Error("Refund bank account must use the same currency as the customer credit.");

      const creditRate = Number(credit.exchangeRate);
      const baseCreditAmount = roundMoney(amount * creditRate);
      const baseSettlementAmount = roundMoney(amount * refundRate);
      const fxDifference = roundMoney(baseCreditAmount - baseSettlementAmount);
      const creditLiability = await resolveSystemAccount(tx, tenantId, "CUSTOMER_CREDIT");
      const lines: JournalPostingLine[] = [
        { accountId: creditLiability.id, description: "Customer credit refund", debit: baseCreditAmount, credit: 0 },
        { accountId: bank.ledgerAccountId, description: "Customer credit refund paid", debit: 0, credit: baseSettlementAmount },
      ];
      if (fxDifference > 0.01) {
        const fxGain = await resolveSystemAccount(tx, tenantId, "FX_GAIN");
        lines.push({ accountId: fxGain.id, description: "Realised FX gain on customer credit refund", debit: 0, credit: fxDifference });
      } else if (fxDifference < -0.01) {
        const fxLoss = await resolveSystemAccount(tx, tenantId, "FX_LOSS");
        lines.push({ accountId: fxLoss.id, description: "Realised FX loss on customer credit refund", debit: Math.abs(fxDifference), credit: 0 });
      }

      const journalEntryId = await postJournalEntryInTransaction(tx, {
        tenantId,
        createdBy: userId,
        entryDate: refundDate,
        reference: input.reference?.trim() || `CC-REF-${refundId.slice(0, 8).toUpperCase()}`,
        description: "Refund customer credit",
        recognitionPeriod: getRecognitionPeriod(refundDate),
        source: "customer_credit_refund",
        sourceId: refundId,
        lines,
      });

      await tx.$executeRaw`
        INSERT INTO "customer_credit_refunds" (
          "id","tenant_id","customer_credit_id","bank_account_id","amount","currency","exchange_rate",
          "base_credit_amount","base_settlement_amount","journal_entry_id","status","refunded_at","reference","notes","created_by"
        ) VALUES (
          ${refundId},${tenantId}::uuid,${credit.id},${input.bankAccountId},${amount},${credit.currency},${refundRate},
          ${baseCreditAmount},${baseSettlementAmount},${journalEntryId},'POSTED',${refundDate},${input.reference?.trim() || null},${input.notes?.trim() || null},${userId}
        )
      `;

      const newRemaining = Math.max(0, roundMoney(Number(credit.remainingAmount) - amount));
      const newRemainingBase = Math.max(0, roundMoney(newRemaining * creditRate));
      await tx.$executeRaw`
        UPDATE "customer_credits"
        SET "remaining_amount"=${newRemaining}, "remaining_base_amount"=${newRemainingBase},
            "status"=${newRemaining <= 0.01 ? "CLOSED" : "OPEN"}, "updated_at"=now()
        WHERE "id"=${credit.id} AND "tenant_id"=${tenantId}::uuid
      `;
    });

    revalidatePath("/sales/customer-credits");
    revalidatePath("/accounting/balance-sheet");
    return { success: true, refundId };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Customer credit could not be refunded." };
  }
}
