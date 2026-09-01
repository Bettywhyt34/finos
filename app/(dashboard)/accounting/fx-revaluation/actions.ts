"use server";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import {
  assertPeriodOpenInTransaction,
  postJournalEntryInTransaction,
} from "@/lib/journal";
import { resolveSystemAccount } from "@/lib/accounting/system-accounts";
import { getRecognitionPeriod } from "@/lib/utils";

type DbClient = Prisma.TransactionClient | typeof prisma;

async function getOrgAndUser() {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Unauthorized");
  return {
    orgId: session.user.tenantId,
    userId: (session.user as { id?: string }).id ?? "system",
  };
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

export interface ARItem {
  id: string;
  invoiceNumber: string;
  customerName: string;
  foreignBalance: number;
  originalRate: number;
  bookedNGN: number;
}

export interface APItem {
  id: string;
  billNumber: string;
  vendorName: string;
  foreignBalance: number;
  originalRate: number;
  bookedNGN: number;
}

async function calculateFXExposureWithDb(
  db: DbClient,
  orgId: string,
  currency: string,
  closingRate: number,
): Promise<FXExposureResult> {
  const invoices = await db.invoice.findMany({
    where: {
      tenantId: orgId,
      currency,
      status: { in: ["SENT", "PARTIAL", "OVERDUE"] },
    },
    select: {
      id: true,
      invoiceNumber: true,
      balanceDue: true,
      exchangeRate: true,
      customer: { select: { companyName: true } },
    },
  });

  const bills = await db.bill.findMany({
    where: {
      tenantId: orgId,
      currency,
      status: { in: ["RECORDED", "PARTIAL", "OVERDUE"] },
    },
    select: {
      id: true,
      billNumber: true,
      totalAmount: true,
      amountPaid: true,
      exchangeRate: true,
      vendor: { select: { companyName: true } },
    },
  });

  let arExposure = 0;
  let arBookedNGN = 0;
  const arItems: ARItem[] = invoices.map((inv) => {
    const foreignBalance = Number(inv.balanceDue);
    const originalRate = Number(inv.exchangeRate);
    const bookedNGN = Math.round(foreignBalance * originalRate * 100) / 100;
    arExposure += foreignBalance;
    arBookedNGN += bookedNGN;
    return {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      customerName: inv.customer.companyName,
      foreignBalance,
      originalRate,
      bookedNGN,
    };
  });

  let apExposure = 0;
  let apBookedNGN = 0;
  const apItems: APItem[] = bills.map((bill) => {
    const foreignBalance = Number(bill.totalAmount) - Number(bill.amountPaid);
    const originalRate = Number(bill.exchangeRate);
    const bookedNGN = Math.round(foreignBalance * originalRate * 100) / 100;
    apExposure += foreignBalance;
    apBookedNGN += bookedNGN;
    return {
      id: bill.id,
      billNumber: bill.billNumber,
      vendorName: bill.vendor.companyName,
      foreignBalance,
      originalRate,
      bookedNGN,
    };
  });

  const arCurrentNGN = Math.round(arExposure * closingRate * 100) / 100;
  const apCurrentNGN = Math.round(apExposure * closingRate * 100) / 100;
  const arGainLoss = Math.round((arCurrentNGN - arBookedNGN) * 100) / 100;
  const apGainLoss = Math.round((apBookedNGN - apCurrentNGN) * 100) / 100;
  const unrealizedGainLoss = Math.round((arGainLoss + apGainLoss) * 100) / 100;

  return {
    currency,
    closingRate,
    arExposure,
    apExposure,
    arBookedNGN,
    apBookedNGN,
    arCurrentNGN,
    apCurrentNGN,
    arGainLoss,
    apGainLoss,
    unrealizedGainLoss,
    arItems,
    apItems,
  };
}

export async function calculateFXExposure(
  orgId: string,
  currency: string,
  closingRate: number,
): Promise<FXExposureResult> {
  return calculateFXExposureWithDb(prisma, orgId, currency, closingRate);
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
    if (!/^\d{4}-\d{2}$/.test(data.period)) throw new Error("Invalid revaluation period.");
    if (!Number.isFinite(data.closingRate) || data.closingRate <= 0) {
      throw new Error("Closing FX rate must be greater than zero.");
    }
    if (!Number.isFinite(data.openingRate) || data.openingRate <= 0) {
      throw new Error("Opening FX rate must be greater than zero.");
    }

    const revaluationDate = new Date(data.revaluationDate);
    if (Number.isNaN(revaluationDate.getTime())) throw new Error("Invalid revaluation date.");
    if (getRecognitionPeriod(revaluationDate) !== data.period) {
      throw new Error("Revaluation date must fall inside the selected accounting period.");
    }

    const result = await prisma.$transaction(async (tx) => {
      // Lock the accounting period before taking the exposure snapshot, so a close
      // cannot race this posting. Business postings use the same period lock.
      await assertPeriodOpenInTransaction(tx, orgId, data.period);

      const existing = await tx.fxRevaluation.findUnique({
        where: {
          tenantId_period_currency: {
            tenantId: orgId,
            period: data.period,
            currency: data.currency,
          },
        },
        select: { id: true, status: true, journalEntryId: true },
      });
      if (existing && existing.status !== "REVERSED") {
        throw new Error(`Revaluation for ${data.period} / ${data.currency} already exists`);
      }

      // Recalculate from FINOS books at posting time rather than trusting stale/UI totals.
      const exposure = await calculateFXExposureWithDb(tx, orgId, data.currency, data.closingRate);
      const { arGainLoss, apGainLoss } = exposure;

      const [arAccount, apAccount, gainAccount, lossAccount] = await Promise.all([
        resolveSystemAccount(tx, orgId, "ACCOUNTS_RECEIVABLE", "CA-001"),
        resolveSystemAccount(tx, orgId, "ACCOUNTS_PAYABLE", "CL-001"),
        resolveSystemAccount(tx, orgId, "FX_GAIN", data.fxGainAccountCode),
        resolveSystemAccount(tx, orgId, "FX_LOSS", data.fxLossAccountCode),
      ]);

      const lines: {
        accountId: string;
        description: string;
        debit: number;
        credit: number;
      }[] = [];

      if (arGainLoss > 0.005) {
        lines.push({
          accountId: arAccount.id,
          description: `FX revaluation AR gain (${data.currency})`,
          debit: arGainLoss,
          credit: 0,
        });
        lines.push({
          accountId: gainAccount.id,
          description: `FX revaluation AR gain (${data.currency})`,
          debit: 0,
          credit: arGainLoss,
        });
      } else if (arGainLoss < -0.005) {
        lines.push({
          accountId: lossAccount.id,
          description: `FX revaluation AR loss (${data.currency})`,
          debit: Math.abs(arGainLoss),
          credit: 0,
        });
        lines.push({
          accountId: arAccount.id,
          description: `FX revaluation AR loss (${data.currency})`,
          debit: 0,
          credit: Math.abs(arGainLoss),
        });
      }

      if (apGainLoss > 0.005) {
        lines.push({
          accountId: apAccount.id,
          description: `FX revaluation AP gain (${data.currency})`,
          debit: apGainLoss,
          credit: 0,
        });
        lines.push({
          accountId: gainAccount.id,
          description: `FX revaluation AP gain (${data.currency})`,
          debit: 0,
          credit: apGainLoss,
        });
      } else if (apGainLoss < -0.005) {
        lines.push({
          accountId: lossAccount.id,
          description: `FX revaluation AP loss (${data.currency})`,
          debit: Math.abs(apGainLoss),
          credit: 0,
        });
        lines.push({
          accountId: apAccount.id,
          description: `FX revaluation AP loss (${data.currency})`,
          debit: 0,
          credit: Math.abs(apGainLoss),
        });
      }

      if (lines.length === 0) {
        throw new Error("Net revaluation is zero — no journal entry required");
      }

      const ref = `FXR-${data.period}-${data.currency}`;
      // Re-posting after a reversal is keyed by the journal that was reversed.
      // Each correction cycle therefore gets a stable, unique source event.
      const sourceId = existing
        ? `${data.period}-${data.currency}-repost-${existing.journalEntryId ?? existing.id}`
        : `${data.period}-${data.currency}`;

      const journalEntryId = await postJournalEntryInTransaction(tx, {
        tenantId: orgId,
        entryDate: revaluationDate,
        reference: ref,
        description:
          `FX Revaluation ${data.currency} ${data.period} — unrealised ` +
          `${exposure.unrealizedGainLoss >= 0 ? "gain" : "loss"} N` +
          Math.abs(exposure.unrealizedGainLoss).toLocaleString("en-NG", { minimumFractionDigits: 2 }),
        recognitionPeriod: data.period,
        source: "fx-revaluation",
        sourceId,
        createdBy: userId,
        lines,
      });

      const recordData = {
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
        journalEntryId,
        status: "POSTED" as const,
        notes: data.notes,
        postedAt: new Date(),
        postedBy: userId,
      };

      const reval = await tx.fxRevaluation.upsert({
        where: {
          tenantId_period_currency: {
            tenantId: orgId,
            period: data.period,
            currency: data.currency,
          },
        },
        create: {
          tenantId: orgId,
          period: data.period,
          currency: data.currency,
          ...recordData,
        },
        update: recordData,
      });

      return reval.id;
    });

    return { success: true, id: result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to post revaluation";
    return { error: msg };
  }
}

export async function reverseFXRevaluation(revalId: string) {
  try {
    const { orgId, userId } = await getOrgAndUser();
    const today = new Date();
    const reversalPeriod = getRecognitionPeriod(today);

    await prisma.$transaction(async (tx) => {
      const reval = await tx.fxRevaluation.findFirst({
        where: { id: revalId, tenantId: orgId, status: "POSTED" },
        include: {
          journalEntry: {
            include: { lines: true },
          },
        },
      });
      if (!reval) throw new Error("Revaluation not found or not in POSTED status");

      const originalLines = reval.journalEntry?.lines ?? [];
      if (originalLines.length === 0 || !reval.journalEntry) {
        throw new Error("No journal lines to reverse");
      }

      await postJournalEntryInTransaction(tx, {
        tenantId: orgId,
        entryDate: today,
        reference: `FXR-REV-${reval.period}-${reval.currency}`,
        description: `Reversal: FX Revaluation ${reval.currency} ${reval.period}`,
        recognitionPeriod: reversalPeriod,
        source: "fx-revaluation-reversal",
        sourceId: `${reval.id}:${reval.journalEntry.id}`,
        createdBy: userId,
        lines: originalLines.map((line) => ({
          accountId: line.accountId,
          description: "REVERSAL: " + (line.description ?? ""),
          debit: Number(line.credit),
          credit: Number(line.debit),
          projectId: line.projectId,
          reportingTags:
            line.reportingTags && typeof line.reportingTags === "object" && !Array.isArray(line.reportingTags)
              ? (line.reportingTags as Record<string, string>)
              : null,
        })),
      });

      await tx.fxRevaluation.update({
        where: { id: revalId },
        data: { status: "REVERSED" },
      });
    });

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to reverse revaluation";
    return { error: msg };
  }
}
