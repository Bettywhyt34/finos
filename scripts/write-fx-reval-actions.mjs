import fs from "fs";
import path from "path";

const root = process.cwd();
const dir = path.join(root, "app", "(dashboard)", "accounting", "fx-revaluation");
fs.mkdirSync(dir, { recursive: true });

const actions = `"use server";

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { postJournalEntry } from "@/lib/journal";
import { getRecognitionPeriod } from "@/lib/utils";

async function getOrgAndUser() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.organizationId) throw new Error("Unauthorized");
  return { orgId: session.user.organizationId, userId: (session.user as { id?: string }).id ?? "system" };
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

export async function calculateFXExposure(
  orgId: string,
  currency: string,
  closingRate: number
): Promise<FXExposureResult> {
  const invoices = await prisma.invoice.findMany({
    where: {
      organizationId: orgId,
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

  const bills = await prisma.bill.findMany({
    where: {
      organizationId: orgId,
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

    const existing = await prisma.fxRevaluation.findUnique({
      where: {
        organizationId_period_currency: {
          organizationId: orgId,
          period: data.period,
          currency: data.currency,
        },
      },
    });
    if (existing && existing.status !== "REVERSED") {
      return { error: "Revaluation for " + data.period + " / " + data.currency + " already exists" };
    }

    const lines: { accountCode: string; description: string; debit: number; credit: number }[] = [];
    const { arGainLoss, apGainLoss } = data;

    if (arGainLoss > 0.005) {
      lines.push({ accountCode: "CA-001", description: "FX revaluation AR gain (" + data.currency + ")", debit: arGainLoss, credit: 0 });
      lines.push({ accountCode: data.fxGainAccountCode, description: "FX revaluation AR gain (" + data.currency + ")", debit: 0, credit: arGainLoss });
    } else if (arGainLoss < -0.005) {
      lines.push({ accountCode: data.fxLossAccountCode, description: "FX revaluation AR loss (" + data.currency + ")", debit: Math.abs(arGainLoss), credit: 0 });
      lines.push({ accountCode: "CA-001", description: "FX revaluation AR loss (" + data.currency + ")", debit: 0, credit: Math.abs(arGainLoss) });
    }

    if (apGainLoss > 0.005) {
      lines.push({ accountCode: "CL-001", description: "FX revaluation AP gain (" + data.currency + ")", debit: apGainLoss, credit: 0 });
      lines.push({ accountCode: data.fxGainAccountCode, description: "FX revaluation AP gain (" + data.currency + ")", debit: 0, credit: apGainLoss });
    } else if (apGainLoss < -0.005) {
      lines.push({ accountCode: data.fxLossAccountCode, description: "FX revaluation AP loss (" + data.currency + ")", debit: Math.abs(apGainLoss), credit: 0 });
      lines.push({ accountCode: "CL-001", description: "FX revaluation AP loss (" + data.currency + ")", debit: 0, credit: Math.abs(apGainLoss) });
    }

    if (lines.length === 0) {
      return { error: "Net revaluation is zero — no journal entry required" };
    }

    const entryNumber = "FXR-" + data.period + "-" + data.currency + "-" + Date.now();
    const journalEntryId = await postJournalEntry({
      orgId,
      entryNumber,
      entryDate: new Date(data.revaluationDate),
      description:
        "FX Revaluation " +
        data.currency +
        " " +
        data.period +
        " — unrealised " +
        (data.unrealizedGainLoss >= 0 ? "gain" : "loss") +
        " ₦" +
        Math.abs(data.unrealizedGainLoss).toLocaleString("en-NG", { minimumFractionDigits: 2 }),
      recognitionPeriod: data.period,
      source: "fx-revaluation",
      createdBy: userId,
      lines,
    });

    const reval = await prisma.fxRevaluation.upsert({
      where: {
        organizationId_period_currency: {
          organizationId: orgId,
          period: data.period,
          currency: data.currency,
        },
      },
      create: {
        organizationId: orgId,
        revaluationDate: new Date(data.revaluationDate),
        period: data.period,
        currency: data.currency,
        openingRate: data.openingRate,
        closingRate: data.closingRate,
        arExposure: data.arExposure,
        apExposure: data.apExposure,
        arBookedNGN: data.arBookedNGN,
        apBookedNGN: data.apBookedNGN,
        arCurrentNGN: data.arCurrentNGN,
        apCurrentNGN: data.apCurrentNGN,
        arGainLoss: data.arGainLoss,
        apGainLoss: data.apGainLoss,
        unrealizedGainLoss: data.unrealizedGainLoss,
        fxGainAccountCode: data.fxGainAccountCode,
        fxLossAccountCode: data.fxLossAccountCode,
        journalEntryId,
        status: "POSTED",
        notes: data.notes,
        postedAt: new Date(),
        postedBy: userId,
      },
      update: {
        closingRate: data.closingRate,
        arExposure: data.arExposure,
        apExposure: data.apExposure,
        arBookedNGN: data.arBookedNGN,
        apBookedNGN: data.apBookedNGN,
        arCurrentNGN: data.arCurrentNGN,
        apCurrentNGN: data.apCurrentNGN,
        arGainLoss: data.arGainLoss,
        apGainLoss: data.apGainLoss,
        unrealizedGainLoss: data.unrealizedGainLoss,
        fxGainAccountCode: data.fxGainAccountCode,
        fxLossAccountCode: data.fxLossAccountCode,
        journalEntryId,
        status: "POSTED",
        notes: data.notes,
        postedAt: new Date(),
        postedBy: userId,
      },
    });

    return { success: true, id: reval.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to post revaluation";
    return { error: msg };
  }
}

export async function reverseFXRevaluation(revalId: string) {
  try {
    const { orgId, userId } = await getOrgAndUser();

    const reval = await prisma.fxRevaluation.findFirst({
      where: { id: revalId, organizationId: orgId, status: "POSTED" },
      include: {
        journalEntry: { include: { lines: { include: { account: true } } } },
      },
    });

    if (!reval) return { error: "Revaluation not found or not in POSTED status" };

    const originalLines = reval.journalEntry?.lines ?? [];
    if (originalLines.length === 0) return { error: "No journal lines to reverse" };

    const reversingLines = originalLines.map((l) => ({
      accountCode: l.account.code,
      description: "REVERSAL: " + (l.description ?? ""),
      debit: Number(l.credit),
      credit: Number(l.debit),
    }));

    const today = new Date();
    const entryNumber = "FXR-REV-" + reval.period + "-" + reval.currency + "-" + Date.now();

    await postJournalEntry({
      orgId,
      entryNumber,
      entryDate: today,
      description: "Reversal: FX Revaluation " + reval.currency + " " + reval.period,
      recognitionPeriod: getRecognitionPeriod(today),
      source: "fx-revaluation-reversal",
      createdBy: userId,
      lines: reversingLines,
    });

    await prisma.fxRevaluation.update({
      where: { id: revalId },
      data: { status: "REVERSED" },
    });

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to reverse revaluation";
    return { error: msg };
  }
}
`;

fs.writeFileSync(path.join(dir, "actions.ts"), actions);
console.log("Written: accounting/fx-revaluation/actions.ts");
