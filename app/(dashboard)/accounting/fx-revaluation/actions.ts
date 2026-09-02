"use server";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { assertPeriodOpenInTransaction, postJournalEntryInTransaction, type JournalPostingLine } from "@/lib/journal";
import { resolveSystemAccount } from "@/lib/accounting/system-accounts";
import { getRecognitionPeriod } from "@/lib/utils";
import {
  getActiveApFxAdjustment,
  getActiveArFxAdjustment,
  getActiveCustomerCreditFxAdjustment,
} from "@/lib/accounting/open-item-fx";

type DbClient = Prisma.TransactionClient | typeof prisma;

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

async function getOrgAndUser() {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Unauthorized");
  return { orgId: session.user.tenantId, userId: (session.user as { id?: string }).id ?? "system" };
}

async function getBaseCurrency(db: DbClient, orgId: string) {
  const tenant = await db.tenant.findUnique({ where: { id: orgId }, select: { currency: true } });
  if (!tenant) throw new Error("Organisation not found.");
  return tenant.currency.trim().toUpperCase();
}

interface MonetaryItemBase {
  id: string;
  foreignBalance: number;
  originalRate: number;
  historicalNGN: number;
  priorAdjustment: number;
  bookedNGN: number;
  currentNGN: number;
  adjustment: number;
}

export interface ARItem extends MonetaryItemBase {
  invoiceNumber: string;
  customerName: string;
}

export interface APItem extends MonetaryItemBase {
  billNumber: string;
  vendorName: string;
}

export interface CustomerCreditItem extends MonetaryItemBase {
  creditNumber: string;
  customerName: string;
}

export interface FXExposureResult {
  baseCurrency: string;
  currency: string;
  closingRate: number;
  arExposure: number;
  apExposure: number;
  customerCreditExposure: number;
  arBookedNGN: number;
  apBookedNGN: number;
  customerCreditBookedNGN: number;
  arCurrentNGN: number;
  apCurrentNGN: number;
  customerCreditCurrentNGN: number;
  arGainLoss: number;
  apGainLoss: number;
  customerCreditGainLoss: number;
  unrealizedGainLoss: number;
  arItems: ARItem[];
  apItems: APItem[];
  customerCreditItems: CustomerCreditItem[];
}

async function calculateFXExposureWithDb(
  db: DbClient,
  orgId: string,
  currency: string,
  closingRate: number,
): Promise<FXExposureResult> {
  const normalCurrency = currency.trim().toUpperCase();
  const baseCurrency = await getBaseCurrency(db, orgId);
  if (!/^[A-Z]{3}$/.test(normalCurrency) || normalCurrency === baseCurrency) {
    throw new Error(`Select a valid foreign currency. ${baseCurrency} is this entity's base currency.`);
  }
  if (!Number.isFinite(closingRate) || closingRate <= 0) throw new Error("Closing FX rate must be greater than zero.");

  const [invoices, bills, customerCredits] = await Promise.all([
    db.invoice.findMany({
      where: { tenantId: orgId, currency: normalCurrency, status: { in: ["SENT", "PARTIAL", "OVERDUE"] }, balanceDue: { gt: 0 } },
      select: { id: true, invoiceNumber: true, balanceDue: true, exchangeRate: true, customer: { select: { companyName: true } } },
      orderBy: [{ issueDate: "asc" }, { id: "asc" }],
    }),
    db.bill.findMany({
      where: { tenantId: orgId, currency: normalCurrency, status: { in: ["RECORDED", "PARTIAL", "OVERDUE"] } },
      select: { id: true, billNumber: true, totalAmount: true, amountPaid: true, exchangeRate: true, vendor: { select: { companyName: true } } },
      orderBy: [{ billDate: "asc" }, { id: "asc" }],
    }),
    db.$queryRaw<Array<{
      id: string;
      creditNumber: string;
      customerName: string;
      remainingAmount: unknown;
      exchangeRate: unknown;
    }>>`
      SELECT cc."id", cn."credit_number" AS "creditNumber", c."company_name" AS "customerName",
             cc."remaining_amount" AS "remainingAmount", cc."exchange_rate" AS "exchangeRate"
      FROM "customer_credits" cc
      INNER JOIN "credit_notes" cn ON cn."id"=cc."credit_note_id" AND cn."tenant_id"=cc."tenant_id"
      INNER JOIN "customers" c ON c."id"=cc."customer_id" AND c."tenant_id"=cc."tenant_id"
      WHERE cc."tenant_id"=${orgId}::uuid
        AND upper(cc."currency")=${normalCurrency}
        AND cc."status"='OPEN'
        AND cc."remaining_amount">0
      ORDER BY cc."created_at", cc."id"
    `,
  ]);

  const arItems: ARItem[] = [];
  for (const invoice of invoices) {
    const foreignBalance = roundMoney(Number(invoice.balanceDue));
    if (foreignBalance <= 0.005) continue;
    const originalRate = Number(invoice.exchangeRate);
    if (!Number.isFinite(originalRate) || originalRate <= 0) throw new Error(`Invoice ${invoice.invoiceNumber} has an invalid exchange rate.`);
    const historicalNGN = roundMoney(foreignBalance * originalRate);
    const priorAdjustment = await getActiveArFxAdjustment(db, orgId, invoice.id);
    const bookedNGN = roundMoney(historicalNGN + priorAdjustment);
    const currentNGN = roundMoney(foreignBalance * closingRate);
    arItems.push({ id: invoice.id, invoiceNumber: invoice.invoiceNumber, customerName: invoice.customer.companyName,
      foreignBalance, originalRate, historicalNGN, priorAdjustment, bookedNGN, currentNGN,
      adjustment: roundMoney(currentNGN - bookedNGN) });
  }

  const apItems: APItem[] = [];
  for (const bill of bills) {
    const foreignBalance = roundMoney(Number(bill.totalAmount) - Number(bill.amountPaid));
    if (foreignBalance <= 0.005) continue;
    const originalRate = Number(bill.exchangeRate);
    if (!Number.isFinite(originalRate) || originalRate <= 0) throw new Error(`Bill ${bill.billNumber} has an invalid exchange rate.`);
    const historicalNGN = roundMoney(foreignBalance * originalRate);
    const priorAdjustment = await getActiveApFxAdjustment(db, orgId, bill.id);
    const bookedNGN = roundMoney(historicalNGN + priorAdjustment);
    const currentNGN = roundMoney(foreignBalance * closingRate);
    apItems.push({ id: bill.id, billNumber: bill.billNumber, vendorName: bill.vendor.companyName,
      foreignBalance, originalRate, historicalNGN, priorAdjustment, bookedNGN, currentNGN,
      adjustment: roundMoney(currentNGN - bookedNGN) });
  }

  const customerCreditItems: CustomerCreditItem[] = [];
  for (const credit of customerCredits) {
    const foreignBalance = roundMoney(Number(credit.remainingAmount));
    if (foreignBalance <= 0.005) continue;
    const originalRate = Number(credit.exchangeRate);
    if (!Number.isFinite(originalRate) || originalRate <= 0) throw new Error(`Customer credit ${credit.creditNumber} has an invalid exchange rate.`);
    const historicalNGN = roundMoney(foreignBalance * originalRate);
    const priorAdjustment = await getActiveCustomerCreditFxAdjustment(db, orgId, credit.id);
    const bookedNGN = roundMoney(historicalNGN + priorAdjustment);
    const currentNGN = roundMoney(foreignBalance * closingRate);
    customerCreditItems.push({ id: credit.id, creditNumber: credit.creditNumber, customerName: credit.customerName,
      foreignBalance, originalRate, historicalNGN, priorAdjustment, bookedNGN, currentNGN,
      adjustment: roundMoney(currentNGN - bookedNGN) });
  }

  const arExposure = roundMoney(arItems.reduce((sum, item) => sum + item.foreignBalance, 0));
  const apExposure = roundMoney(apItems.reduce((sum, item) => sum + item.foreignBalance, 0));
  const customerCreditExposure = roundMoney(customerCreditItems.reduce((sum, item) => sum + item.foreignBalance, 0));
  const arBookedNGN = roundMoney(arItems.reduce((sum, item) => sum + item.bookedNGN, 0));
  const apBookedNGN = roundMoney(apItems.reduce((sum, item) => sum + item.bookedNGN, 0));
  const customerCreditBookedNGN = roundMoney(customerCreditItems.reduce((sum, item) => sum + item.bookedNGN, 0));
  const arCurrentNGN = roundMoney(arItems.reduce((sum, item) => sum + item.currentNGN, 0));
  const apCurrentNGN = roundMoney(apItems.reduce((sum, item) => sum + item.currentNGN, 0));
  const customerCreditCurrentNGN = roundMoney(customerCreditItems.reduce((sum, item) => sum + item.currentNGN, 0));
  const arGainLoss = roundMoney(arItems.reduce((sum, item) => sum + item.adjustment, 0));
  const apGainLoss = roundMoney(apItems.reduce((sum, item) => sum - item.adjustment, 0));
  const customerCreditGainLoss = roundMoney(customerCreditItems.reduce((sum, item) => sum - item.adjustment, 0));

  return {
    baseCurrency,
    currency: normalCurrency,
    closingRate,
    arExposure,
    apExposure,
    customerCreditExposure,
    arBookedNGN,
    apBookedNGN,
    customerCreditBookedNGN,
    arCurrentNGN,
    apCurrentNGN,
    customerCreditCurrentNGN,
    arGainLoss,
    apGainLoss,
    customerCreditGainLoss,
    unrealizedGainLoss: roundMoney(arGainLoss + apGainLoss + customerCreditGainLoss),
    arItems,
    apItems,
    customerCreditItems,
  };
}

export async function calculateFXExposure(orgId: string, currency: string, closingRate: number): Promise<FXExposureResult> {
  const { orgId: sessionOrg } = await getOrgAndUser();
  if (orgId !== sessionOrg) throw new Error("Organisation mismatch.");
  return calculateFXExposureWithDb(prisma, sessionOrg, currency, closingRate);
}

export async function postFXRevaluation(data: {
  period: string;
  currency: string;
  revaluationDate: string;
  openingRate: number;
  closingRate: number;
  arExposure: number;
  apExposure: number;
  arBookedNGN: number;
  apBookedNGN: number;
  arCurrentNGN: number;
  apCurrentNGN: number;
  arGainLoss: number;
  apGainLoss: number;
  unrealizedGainLoss: number;
  fxGainAccountCode: string;
  fxLossAccountCode: string;
  notes?: string;
}) {
  try {
    const { orgId, userId } = await getOrgAndUser();
    const currency = data.currency.trim().toUpperCase();
    const baseCurrency = await getBaseCurrency(prisma, orgId);
    if (!/^\d{4}-\d{2}$/.test(data.period)) throw new Error("Invalid revaluation period.");
    if (!/^[A-Z]{3}$/.test(currency) || currency === baseCurrency) throw new Error(`Select a valid foreign currency. ${baseCurrency} is the base currency.`);
    if (!Number.isFinite(data.closingRate) || data.closingRate <= 0) throw new Error("Closing FX rate must be greater than zero.");
    if (!Number.isFinite(data.openingRate) || data.openingRate <= 0) throw new Error("Opening FX rate must be greater than zero.");
    const revaluationDate = new Date(`${data.revaluationDate}T00:00:00`);
    if (Number.isNaN(revaluationDate.getTime())) throw new Error("Invalid revaluation date.");
    if (getRecognitionPeriod(revaluationDate) !== data.period) throw new Error("Revaluation date must fall inside the selected accounting period.");

    const id = await prisma.$transaction(async (tx) => {
      await assertPeriodOpenInTransaction(tx, orgId, data.period);
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:fx-revaluation:${orgId}:${currency}`}))`;
      const existing = await tx.fxRevaluation.findUnique({
        where: { tenantId_period_currency: { tenantId: orgId, period: data.period, currency } },
        select: { id: true },
      });
      if (existing) throw new Error(`A revaluation for ${data.period} / ${currency} already exists. Reverse it before creating a corrected period revaluation.`);

      const exposure = await calculateFXExposureWithDb(tx, orgId, currency, data.closingRate);
      const hasItems = exposure.arItems.length + exposure.apItems.length + exposure.customerCreditItems.length > 0;
      if (!hasItems) throw new Error(`No open ${currency} monetary AR, AP, or customer-credit balances require revaluation.`);
      if (Math.abs(exposure.unrealizedGainLoss) <= 0.005
        && Math.abs(exposure.arGainLoss) <= 0.005
        && Math.abs(exposure.apGainLoss) <= 0.005
        && Math.abs(exposure.customerCreditGainLoss) <= 0.005) {
        throw new Error("Open-item carrying values already equal the selected closing rate; no revaluation journal is required.");
      }

      const [arAccount, apAccount, customerCreditAccount, gainAccount, lossAccount] = await Promise.all([
        exposure.arItems.length ? resolveSystemAccount(tx, orgId, "ACCOUNTS_RECEIVABLE", "CA-001") : Promise.resolve(null),
        exposure.apItems.length ? resolveSystemAccount(tx, orgId, "ACCOUNTS_PAYABLE", "CL-001") : Promise.resolve(null),
        exposure.customerCreditItems.length ? resolveSystemAccount(tx, orgId, "CUSTOMER_CREDIT") : Promise.resolve(null),
        resolveSystemAccount(tx, orgId, "FX_GAIN", data.fxGainAccountCode),
        resolveSystemAccount(tx, orgId, "FX_LOSS", data.fxLossAccountCode),
      ]);

      const revaluation = await tx.fxRevaluation.create({
        data: {
          tenantId: orgId,
          period: data.period,
          currency,
          revaluationDate,
          openingRate: data.openingRate,
          closingRate: data.closingRate,
          arExposure: exposure.arExposure,
          apExposure: exposure.apExposure,
          arBookedNGN: exposure.arBookedNGN,
          apBookedNGN: exposure.apBookedNGN,
          arCurrentNGN: exposure.arCurrentNGN,
          apCurrentNGN: exposure.apCurrentNGN,
          arGainLoss: exposure.arGainLoss,
          apGainLoss: exposure.apGainLoss,
          unrealizedGainLoss: exposure.unrealizedGainLoss,
          fxGainAccountCode: gainAccount.code,
          fxLossAccountCode: lossAccount.code,
          status: "DRAFT",
          notes: data.notes?.trim() || null,
        },
        select: { id: true },
      });

      for (const item of exposure.arItems) {
        await tx.$executeRaw`
          INSERT INTO "fx_revaluation_items" (
            "tenant_id","fx_revaluation_id","item_type","invoice_id","currency","foreign_balance","original_rate","closing_rate",
            "historical_base_amount","prior_carrying_adjustment","carrying_base_amount","target_base_amount","adjustment_base_amount"
          ) VALUES (
            ${orgId}::uuid, ${revaluation.id}, 'AR', ${item.id}, ${currency}, ${item.foreignBalance}, ${item.originalRate}, ${data.closingRate},
            ${item.historicalNGN}, ${item.priorAdjustment}, ${item.bookedNGN}, ${item.currentNGN}, ${item.adjustment}
          )
        `;
      }
      for (const item of exposure.apItems) {
        await tx.$executeRaw`
          INSERT INTO "fx_revaluation_items" (
            "tenant_id","fx_revaluation_id","item_type","bill_id","currency","foreign_balance","original_rate","closing_rate",
            "historical_base_amount","prior_carrying_adjustment","carrying_base_amount","target_base_amount","adjustment_base_amount"
          ) VALUES (
            ${orgId}::uuid, ${revaluation.id}, 'AP', ${item.id}, ${currency}, ${item.foreignBalance}, ${item.originalRate}, ${data.closingRate},
            ${item.historicalNGN}, ${item.priorAdjustment}, ${item.bookedNGN}, ${item.currentNGN}, ${item.adjustment}
          )
        `;
      }
      for (const item of exposure.customerCreditItems) {
        await tx.$executeRaw`
          INSERT INTO "fx_revaluation_items" (
            "tenant_id","fx_revaluation_id","item_type","customer_credit_id","currency","foreign_balance","original_rate","closing_rate",
            "historical_base_amount","prior_carrying_adjustment","carrying_base_amount","target_base_amount","adjustment_base_amount"
          ) VALUES (
            ${orgId}::uuid, ${revaluation.id}, 'CUSTOMER_CREDIT', ${item.id}, ${currency}, ${item.foreignBalance}, ${item.originalRate}, ${data.closingRate},
            ${item.historicalNGN}, ${item.priorAdjustment}, ${item.bookedNGN}, ${item.currentNGN}, ${item.adjustment}
          )
        `;
      }

      const lines: JournalPostingLine[] = [];
      if (arAccount && Math.abs(exposure.arGainLoss) > 0.005) {
        if (exposure.arGainLoss > 0) lines.push({ accountId: arAccount.id, description: `FX revaluation AR (${currency})`, debit: exposure.arGainLoss, credit: 0 });
        else lines.push({ accountId: arAccount.id, description: `FX revaluation AR (${currency})`, debit: 0, credit: Math.abs(exposure.arGainLoss) });
      }
      if (apAccount && Math.abs(exposure.apGainLoss) > 0.005) {
        if (exposure.apGainLoss > 0) lines.push({ accountId: apAccount.id, description: `FX revaluation AP (${currency})`, debit: exposure.apGainLoss, credit: 0 });
        else lines.push({ accountId: apAccount.id, description: `FX revaluation AP (${currency})`, debit: 0, credit: Math.abs(exposure.apGainLoss) });
      }
      if (customerCreditAccount && Math.abs(exposure.customerCreditGainLoss) > 0.005) {
        if (exposure.customerCreditGainLoss > 0) {
          lines.push({ accountId: customerCreditAccount.id, description: `FX revaluation customer credits (${currency})`, debit: exposure.customerCreditGainLoss, credit: 0 });
        } else {
          lines.push({ accountId: customerCreditAccount.id, description: `FX revaluation customer credits (${currency})`, debit: 0, credit: Math.abs(exposure.customerCreditGainLoss) });
        }
      }

      const grossGain = roundMoney(
        Math.max(exposure.arGainLoss, 0)
        + Math.max(exposure.apGainLoss, 0)
        + Math.max(exposure.customerCreditGainLoss, 0),
      );
      const grossLoss = roundMoney(
        Math.max(-exposure.arGainLoss, 0)
        + Math.max(-exposure.apGainLoss, 0)
        + Math.max(-exposure.customerCreditGainLoss, 0),
      );
      if (grossLoss > 0.005) lines.push({ accountId: lossAccount.id, description: `Unrealised FX loss (${currency})`, debit: grossLoss, credit: 0 });
      if (grossGain > 0.005) lines.push({ accountId: gainAccount.id, description: `Unrealised FX gain (${currency})`, debit: 0, credit: grossGain });

      const journalEntryId = await postJournalEntryInTransaction(tx, {
        tenantId: orgId,
        createdBy: userId,
        entryDate: revaluationDate,
        reference: `FXR-${data.period}-${currency}`,
        description: `FX Revaluation ${currency} ${data.period} — AR/AP/customer-credit monetary balances in ${baseCurrency}`,
        recognitionPeriod: data.period,
        source: "fx-revaluation",
        sourceId: revaluation.id,
        lines,
      });

      await tx.fxRevaluation.update({
        where: { id: revaluation.id },
        data: { journalEntryId, status: "POSTED", postedAt: new Date(), postedBy: userId },
      });
      return revaluation.id;
    });

    return { success: true, id };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to post revaluation" };
  }
}

export async function reverseFXRevaluation(revalId: string) {
  try {
    const { orgId, userId } = await getOrgAndUser();
    const today = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:fx-revaluation:${orgId}`}))`;
      const revaluation = await tx.fxRevaluation.findFirst({
        where: { id: revalId, tenantId: orgId, status: "POSTED" },
        include: { journalEntry: { include: { lines: true } } },
      });
      if (!revaluation?.journalEntry || revaluation.journalEntry.lines.length === 0) {
        throw new Error("Revaluation not found or its journal evidence is incomplete.");
      }

      const later = await tx.fxRevaluation.findFirst({
        where: { tenantId: orgId, currency: revaluation.currency, status: "POSTED", revaluationDate: { gt: revaluation.revaluationDate } },
        select: { id: true, period: true },
      });
      if (later) throw new Error(`Reverse the later ${later.period} ${revaluation.currency} revaluation first.`);

      const [arConsumed, apConsumed, customerCreditConsumed] = await Promise.all([
        tx.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*)::bigint AS "count"
          FROM "fx_revaluation_items" fri
          JOIN "customer_payment_allocations" cpa ON cpa."invoice_id" = fri."invoice_id"
          JOIN "customer_payments" cp ON cp."id" = cpa."payment_id"
          WHERE fri."fx_revaluation_id" = ${revaluation.id}
            AND fri."item_type" = 'AR'
            AND cp."tenant_id" = ${orgId}::uuid
            AND cp."status" = 'POSTED'::customer_payment_status
            AND ABS(cpa."fx_unrealized_consumed") > 0.005
        `,
        tx.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*)::bigint AS "count"
          FROM "fx_revaluation_items" fri
          JOIN "vendor_payment_allocations" vpa ON vpa."bill_id" = fri."bill_id"
          JOIN "vendor_payments" vp ON vp."id" = vpa."payment_id"
          WHERE fri."fx_revaluation_id" = ${revaluation.id}
            AND fri."item_type" = 'AP'
            AND vp."tenant_id" = ${orgId}::uuid
            AND ABS(vpa."fx_unrealized_consumed") > 0.005
        `,
        tx.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*)::bigint AS "count"
          FROM "fx_revaluation_items" fri
          WHERE fri."fx_revaluation_id"=${revaluation.id}
            AND fri."item_type"='CUSTOMER_CREDIT'
            AND (
              EXISTS (
                SELECT 1 FROM "customer_credit_applications" cca
                WHERE cca."tenant_id"=${orgId}::uuid
                  AND cca."customer_credit_id"=fri."customer_credit_id"
                  AND cca."status"='POSTED'
                  AND ABS(cca."credit_fx_unrealized_consumed")>0.005
              )
              OR EXISTS (
                SELECT 1 FROM "customer_credit_refunds" ccr
                WHERE ccr."tenant_id"=${orgId}::uuid
                  AND ccr."customer_credit_id"=fri."customer_credit_id"
                  AND ccr."status"='POSTED'
                  AND ABS(ccr."credit_fx_unrealized_consumed")>0.005
              )
            )
        `,
      ]);
      if (Number(arConsumed[0]?.count ?? 0) > 0 || Number(apConsumed[0]?.count ?? 0) > 0 || Number(customerCreditConsumed[0]?.count ?? 0) > 0) {
        throw new Error("This revaluation has already been consumed by a posted settlement. Reverse the affected receipt, vendor payment, customer-credit application, or customer-credit refund first.");
      }

      const reversalPeriod = getRecognitionPeriod(today);
      await assertPeriodOpenInTransaction(tx, orgId, reversalPeriod);
      await postJournalEntryInTransaction(tx, {
        tenantId: orgId,
        createdBy: userId,
        entryDate: today,
        reference: `FXR-REV-${revaluation.period}-${revaluation.currency}`,
        description: `Reversal: FX Revaluation ${revaluation.currency} ${revaluation.period}`,
        recognitionPeriod: reversalPeriod,
        source: "fx-revaluation-reversal",
        sourceId: `${revaluation.id}:${revaluation.journalEntry.id}`,
        lines: revaluation.journalEntry.lines.map((line) => ({
          accountId: line.accountId,
          description: `REVERSAL: ${line.description ?? "FX revaluation"}`,
          debit: Number(line.credit),
          credit: Number(line.debit),
          projectId: line.projectId,
          reportingTags: line.reportingTags && typeof line.reportingTags === "object" && !Array.isArray(line.reportingTags)
            ? line.reportingTags as Record<string, string>
            : null,
        })),
      });
      await tx.fxRevaluation.update({ where: { id: revaluation.id }, data: { status: "REVERSED" } });
    });
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to reverse revaluation" };
  }
}
