"use server";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { assertPeriodOpenInTransaction, postJournalEntryInTransaction } from "@/lib/journal";
import { resolveSystemAccount } from "@/lib/accounting/system-accounts";
import { getRecognitionPeriod } from "@/lib/utils";
import { getActiveArFxAdjustment, getActiveApFxAdjustment } from "@/lib/accounting/open-item-fx";

type DbClient = Prisma.TransactionClient | typeof prisma;

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

async function getOrgAndUser() {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Unauthorized");
  return { orgId: session.user.tenantId, userId: (session.user as { id?: string }).id ?? "system" };
}

export interface ARItem {
  id: string;
  invoiceNumber: string;
  customerName: string;
  foreignBalance: number;
  originalRate: number;
  historicalNGN: number;
  priorAdjustment: number;
  bookedNGN: number;
  currentNGN: number;
  adjustment: number;
}

export interface APItem {
  id: string;
  billNumber: string;
  vendorName: string;
  foreignBalance: number;
  originalRate: number;
  historicalNGN: number;
  priorAdjustment: number;
  bookedNGN: number;
  currentNGN: number;
  adjustment: number;
}

export interface FXExposureResult {
  currency: string;
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
  arItems: ARItem[];
  apItems: APItem[];
}

async function calculateFXExposureWithDb(db: DbClient, orgId: string, currency: string, closingRate: number): Promise<FXExposureResult> {
  const normalCurrency = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalCurrency) || normalCurrency === "NGN") throw new Error("Select a valid foreign currency.");
  if (!Number.isFinite(closingRate) || closingRate <= 0) throw new Error("Closing FX rate must be greater than zero.");

  const invoices = await db.invoice.findMany({
    where: { tenantId: orgId, currency: normalCurrency, status: { in: ["SENT", "PARTIAL", "OVERDUE"] }, balanceDue: { gt: 0 } },
    select: { id: true, invoiceNumber: true, balanceDue: true, exchangeRate: true, customer: { select: { companyName: true } } },
    orderBy: [{ issueDate: "asc" }, { id: "asc" }],
  });
  const bills = await db.bill.findMany({
    where: { tenantId: orgId, currency: normalCurrency, status: { in: ["RECORDED", "PARTIAL", "OVERDUE"] } },
    select: { id: true, billNumber: true, totalAmount: true, amountPaid: true, exchangeRate: true, vendor: { select: { companyName: true } } },
    orderBy: [{ billDate: "asc" }, { id: "asc" }],
  });

  const arItems: ARItem[] = [];
  for (const inv of invoices) {
    const foreignBalance = roundMoney(Number(inv.balanceDue));
    if (foreignBalance <= 0.005) continue;
    const originalRate = Number(inv.exchangeRate);
    if (!Number.isFinite(originalRate) || originalRate <= 0) throw new Error(`Invoice ${inv.invoiceNumber} has an invalid exchange rate.`);
    const historicalNGN = roundMoney(foreignBalance * originalRate);
    const priorAdjustment = await getActiveArFxAdjustment(db, orgId, inv.id);
    const bookedNGN = roundMoney(historicalNGN + priorAdjustment);
    const currentNGN = roundMoney(foreignBalance * closingRate);
    arItems.push({ id: inv.id, invoiceNumber: inv.invoiceNumber, customerName: inv.customer.companyName, foreignBalance, originalRate, historicalNGN, priorAdjustment, bookedNGN, currentNGN, adjustment: roundMoney(currentNGN - bookedNGN) });
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
    apItems.push({ id: bill.id, billNumber: bill.billNumber, vendorName: bill.vendor.companyName, foreignBalance, originalRate, historicalNGN, priorAdjustment, bookedNGN, currentNGN, adjustment: roundMoney(currentNGN - bookedNGN) });
  }

  const arExposure = roundMoney(arItems.reduce((s, i) => s + i.foreignBalance, 0));
  const apExposure = roundMoney(apItems.reduce((s, i) => s + i.foreignBalance, 0));
  const arBookedNGN = roundMoney(arItems.reduce((s, i) => s + i.bookedNGN, 0));
  const apBookedNGN = roundMoney(apItems.reduce((s, i) => s + i.bookedNGN, 0));
  const arCurrentNGN = roundMoney(arItems.reduce((s, i) => s + i.currentNGN, 0));
  const apCurrentNGN = roundMoney(apItems.reduce((s, i) => s + i.currentNGN, 0));
  const arGainLoss = roundMoney(arItems.reduce((s, i) => s + i.adjustment, 0));
  const apGainLoss = roundMoney(apItems.reduce((s, i) => s - i.adjustment, 0));
  return { currency: normalCurrency, closingRate, arExposure, apExposure, arBookedNGN, apBookedNGN, arCurrentNGN, apCurrentNGN, arGainLoss, apGainLoss, unrealizedGainLoss: roundMoney(arGainLoss + apGainLoss), arItems, apItems };
}

export async function calculateFXExposure(orgId: string, currency: string, closingRate: number): Promise<FXExposureResult> {
  const { orgId: sessionOrg } = await getOrgAndUser();
  if (orgId !== sessionOrg) throw new Error("Organisation mismatch.");
  return calculateFXExposureWithDb(prisma, sessionOrg, currency, closingRate);
}

export async function postFXRevaluation(data: {
  period: string; currency: string; revaluationDate: string; openingRate: number; closingRate: number;
  arExposure: number; apExposure: number; arBookedNGN: number; apBookedNGN: number; arCurrentNGN: number; apCurrentNGN: number;
  arGainLoss: number; apGainLoss: number; unrealizedGainLoss: number; fxGainAccountCode: string; fxLossAccountCode: string; notes?: string;
}) {
  try {
    const { orgId, userId } = await getOrgAndUser();
    const currency = data.currency.trim().toUpperCase();
    if (!/^\d{4}-\d{2}$/.test(data.period)) throw new Error("Invalid revaluation period.");
    if (!/^[A-Z]{3}$/.test(currency) || currency === "NGN") throw new Error("Select a valid foreign currency.");
    if (!Number.isFinite(data.closingRate) || data.closingRate <= 0) throw new Error("Closing FX rate must be greater than zero.");
    if (!Number.isFinite(data.openingRate) || data.openingRate <= 0) throw new Error("Opening FX rate must be greater than zero.");
    const revaluationDate = new Date(`${data.revaluationDate}T00:00:00`);
    if (Number.isNaN(revaluationDate.getTime())) throw new Error("Invalid revaluation date.");
    if (getRecognitionPeriod(revaluationDate) !== data.period) throw new Error("Revaluation date must fall inside the selected accounting period.");

    const id = await prisma.$transaction(async (tx) => {
      await assertPeriodOpenInTransaction(tx, orgId, data.period);
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:fx-revaluation:${orgId}:${currency}`}))`;
      const existing = await tx.fxRevaluation.findUnique({ where: { tenantId_period_currency: { tenantId: orgId, period: data.period, currency } }, select: { id: true } });
      if (existing) throw new Error(`A revaluation for ${data.period} / ${currency} already exists. Reverse it before creating a corrected period revaluation.`);

      const exposure = await calculateFXExposureWithDb(tx, orgId, currency, data.closingRate);
      if (exposure.apItems.length > 0) {
        throw new Error(`Foreign-currency AP exists in ${currency}. AP FX posting is temporarily blocked until Money Out uses the same open-item settlement evidence. AR revaluation was not posted.`);
      }
      if (exposure.arItems.length === 0) throw new Error(`No open ${currency} Accounts Receivable items require revaluation.`);
      if (Math.abs(exposure.arGainLoss) <= 0.005) throw new Error("AR carrying value already equals the selected closing rate; no revaluation journal is required.");

      const [arAccount, gainAccount, lossAccount] = await Promise.all([
        resolveSystemAccount(tx, orgId, "ACCOUNTS_RECEIVABLE", "CA-001"),
        resolveSystemAccount(tx, orgId, "FX_GAIN", data.fxGainAccountCode),
        resolveSystemAccount(tx, orgId, "FX_LOSS", data.fxLossAccountCode),
      ]);

      const reval = await tx.fxRevaluation.create({ data: {
        tenantId: orgId, period: data.period, currency, revaluationDate, openingRate: data.openingRate, closingRate: data.closingRate,
        arExposure: exposure.arExposure, apExposure: 0, arBookedNGN: exposure.arBookedNGN, apBookedNGN: 0,
        arCurrentNGN: exposure.arCurrentNGN, apCurrentNGN: 0, arGainLoss: exposure.arGainLoss, apGainLoss: 0,
        unrealizedGainLoss: exposure.arGainLoss, fxGainAccountCode: gainAccount.code, fxLossAccountCode: lossAccount.code,
        status: "DRAFT", notes: data.notes?.trim() || null,
      }, select: { id: true } });

      for (const item of exposure.arItems) {
        await tx.$executeRaw`
          INSERT INTO "fx_revaluation_items" (
            "tenant_id","fx_revaluation_id","item_type","invoice_id","currency","foreign_balance","original_rate","closing_rate",
            "historical_base_amount","prior_carrying_adjustment","carrying_base_amount","target_base_amount","adjustment_base_amount"
          ) VALUES (
            ${orgId}::uuid, ${reval.id}, 'AR', ${item.id}, ${currency}, ${item.foreignBalance}, ${item.originalRate}, ${data.closingRate},
            ${item.historicalNGN}, ${item.priorAdjustment}, ${item.bookedNGN}, ${item.currentNGN}, ${item.adjustment}
          )
        `;
      }

      const amount = Math.abs(exposure.arGainLoss);
      const lines = exposure.arGainLoss > 0
        ? [
            { accountId: arAccount.id, description: `FX revaluation AR gain (${currency})`, debit: amount, credit: 0 },
            { accountId: gainAccount.id, description: `Unrealised FX gain (${currency})`, debit: 0, credit: amount },
          ]
        : [
            { accountId: lossAccount.id, description: `Unrealised FX loss (${currency})`, debit: amount, credit: 0 },
            { accountId: arAccount.id, description: `FX revaluation AR loss (${currency})`, debit: 0, credit: amount },
          ];

      const journalEntryId = await postJournalEntryInTransaction(tx, {
        tenantId: orgId, createdBy: userId, entryDate: revaluationDate, reference: `FXR-${data.period}-${currency}`,
        description: `FX Revaluation ${currency} ${data.period} — AR adjustment ₦${amount.toLocaleString("en-NG", { minimumFractionDigits: 2 })}`,
        recognitionPeriod: data.period, source: "fx-revaluation", sourceId: reval.id, lines,
      });

      await tx.fxRevaluation.update({ where: { id: reval.id }, data: { journalEntryId, status: "POSTED", postedAt: new Date(), postedBy: userId } });
      return reval.id;
    });
    return { success: true, id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to post revaluation" };
  }
}

export async function reverseFXRevaluation(revalId: string) {
  try {
    const { orgId, userId } = await getOrgAndUser();
    const today = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:fx-revaluation:${orgId}`}))`;
      const reval = await tx.fxRevaluation.findFirst({ where: { id: revalId, tenantId: orgId, status: "POSTED" }, include: { journalEntry: { include: { lines: true } } } });
      if (!reval?.journalEntry || reval.journalEntry.lines.length === 0) throw new Error("Revaluation not found or its journal evidence is incomplete.");

      const later = await tx.fxRevaluation.findFirst({ where: { tenantId: orgId, currency: reval.currency, status: "POSTED", revaluationDate: { gt: reval.revaluationDate } }, select: { id: true, period: true } });
      if (later) throw new Error(`Reverse the later ${later.period} ${reval.currency} revaluation first.`);

      const consumed = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS "count"
        FROM "fx_revaluation_items" fri
        JOIN "customer_payment_allocations" cpa ON cpa."invoice_id" = fri."invoice_id"
        JOIN "customer_payments" cp ON cp."id" = cpa."payment_id"
        WHERE fri."fx_revaluation_id" = ${reval.id}
          AND fri."item_type" = 'AR'
          AND cp."tenant_id" = ${orgId}::uuid
          AND cp."status" = 'POSTED'::customer_payment_status
          AND ABS(cpa."fx_unrealized_consumed") > 0.005
      `;
      if (Number(consumed[0]?.count ?? 0) > 0) throw new Error("This revaluation has already been consumed by a posted customer receipt. Reverse the affected receipt first.");

      const reversalPeriod = getRecognitionPeriod(today);
      await assertPeriodOpenInTransaction(tx, orgId, reversalPeriod);
      await postJournalEntryInTransaction(tx, {
        tenantId: orgId, createdBy: userId, entryDate: today, reference: `FXR-REV-${reval.period}-${reval.currency}`,
        description: `Reversal: FX Revaluation ${reval.currency} ${reval.period}`, recognitionPeriod: reversalPeriod,
        source: "fx-revaluation-reversal", sourceId: `${reval.id}:${reval.journalEntry.id}`,
        lines: reval.journalEntry.lines.map((line) => ({
          accountId: line.accountId, description: `REVERSAL: ${line.description ?? "FX revaluation"}`, debit: Number(line.credit), credit: Number(line.debit),
          projectId: line.projectId, reportingTags: line.reportingTags && typeof line.reportingTags === "object" && !Array.isArray(line.reportingTags) ? line.reportingTags as Record<string, string> : null,
        })),
      });
      await tx.fxRevaluation.update({ where: { id: reval.id }, data: { status: "REVERSED" } });
    });
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to reverse revaluation" };
  }
}
