"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";

async function getOrgAndUser() {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Unauthorized");
  return {
    orgId: session.user.tenantId,
    userId: (session.user as { id?: string }).id ?? "system",
  };
}

async function getNextEntryNumber(orgId: string): Promise<string> {
  const count = await prisma.journalEntry.count({ where: { tenantId: orgId } });
  return "MJE-" + String(count + 1).padStart(5, "0");
}

async function checkPeriodLocked(orgId: string, period: string) {
  const ap = await prisma.accountingPeriod.findUnique({
    where: { tenantId_period: { tenantId: orgId, period } },
  });
  if (ap?.isClosed) throw new Error("Period " + period + " is closed. Reopen it before posting.");
}

export interface JournalLineInput {
  accountId: string;
  description?: string;
  debit: number;
  credit: number;
}

export async function createManualJournalEntry(data: {
  entryDate: string;
  description: string;
  recognitionPeriod: string;
  reference?: string;
  isReversing: boolean;
  attachmentUrl?: string;
  lines: JournalLineInput[];
}) {
  try {
    const { orgId, userId } = await getOrgAndUser();
    await checkPeriodLocked(orgId, data.recognitionPeriod);

    const totalDebits = data.lines.reduce((s, l) => s + l.debit, 0);
    const totalCredits = data.lines.reduce((s, l) => s + l.credit, 0);
    if (Math.abs(totalDebits - totalCredits) > 0.005) {
      return { error: "Journal imbalance: debits " + totalDebits.toFixed(2) + " ≠ credits " + totalCredits.toFixed(2) };
    }

    const entryNumber = await getNextEntryNumber(orgId);

    const entry = await prisma.journalEntry.create({
      data: {
        tenantId: orgId,
        entryNumber,
        entryDate: new Date(data.entryDate),
        reference: data.reference ?? null,
        description: data.description,
        recognitionPeriod: data.recognitionPeriod,
        isReversing: data.isReversing,
        isLocked: false, // DRAFT until posted
        source: "manual",
        sourceId: entryNumber,
        attachmentUrl: data.attachmentUrl ?? null,
        createdBy: userId,
        lines: {
          create: data.lines
            .filter((l) => l.debit > 0 || l.credit > 0)
            .map((l) => ({
              accountId: l.accountId,
              description: l.description ?? null,
              debit: l.debit,
              credit: l.credit,
            })),
        },
      },
    });

    revalidatePath("/accounting/journal-entries");
    return { success: true, id: entry.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to create entry" };
  }
}

export async function postJournalEntry(entryId: string) {
  try {
    const { orgId } = await getOrgAndUser();
    const entry = await prisma.journalEntry.findFirst({
      where: { id: entryId, tenantId: orgId },
      include: { lines: true },
    });
    if (!entry) return { error: "Entry not found" };
    if (entry.isLocked) return { error: "Entry is already posted" };

    await checkPeriodLocked(orgId, entry.recognitionPeriod);

    const totalDebits = entry.lines.reduce((s, l) => s + Number(l.debit), 0);
    const totalCredits = entry.lines.reduce((s, l) => s + Number(l.credit), 0);
    if (Math.abs(totalDebits - totalCredits) > 0.005) {
      return { error: "Journal imbalance — fix lines before posting" };
    }

    await prisma.journalEntry.update({
      where: { id: entryId },
      data: { isLocked: true },
    });

    revalidatePath("/accounting/journal-entries");
    revalidatePath("/accounting/journal-entries/" + entryId);
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to post entry" };
  }
}

export async function reverseJournalEntry(entryId: string, reason: string) {
  try {
    const { orgId, userId } = await getOrgAndUser();
    const original = await prisma.journalEntry.findFirst({
      where: { id: entryId, tenantId: orgId, isLocked: true },
      include: { lines: { include: { account: { select: { id: true, code: true } } } } },
    });
    if (!original) return { error: "Entry not found or not posted" };

    // Check not already reversed
    const existingReversal = await prisma.journalEntry.findFirst({
      where: { tenantId: orgId, reversedById: entryId },
    });
    if (existingReversal) return { error: "Entry has already been reversed" };

    const today = new Date();
    const period = today.toISOString().slice(0, 7);
    await checkPeriodLocked(orgId, period);

    const entryNumber = await getNextEntryNumber(orgId);

    const reversal = await prisma.journalEntry.create({
      data: {
        tenantId: orgId,
        entryNumber,
        entryDate: today,
        reference: "REV-" + original.entryNumber,
        description: "Reversal of " + original.entryNumber + ": " + original.description,
        recognitionPeriod: period,
        isReversing: true,
        reversedById: entryId,
        reversalReason: reason,
        isLocked: true,
        source: "reversal",
        sourceId: entryId,
        createdBy: userId,
        lines: {
          create: original.lines.map((l) => ({
            accountId: l.accountId,
            description: "REVERSAL: " + (l.description ?? ""),
            debit: Number(l.credit),
            credit: Number(l.debit),
          })),
        },
      },
    });

    revalidatePath("/accounting/journal-entries");
    revalidatePath("/accounting/journal-entries/" + entryId);
    return { success: true, reversalId: reversal.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to reverse entry" };
  }
}

export async function updateJournalEntry(
  entryId: string,
  data: {
    entryDate: string;
    description: string;
    recognitionPeriod: string;
    reference?: string;
    attachmentUrl?: string;
    lines: JournalLineInput[];
  }
) {
  try {
    const { orgId } = await getOrgAndUser();
    const entry = await prisma.journalEntry.findFirst({
      where: { id: entryId, tenantId: orgId },
    });
    if (!entry) return { error: "Entry not found" };
    if (entry.isLocked) return { error: "Cannot edit a posted entry" };

    const totalDebits = data.lines.reduce((s, l) => s + l.debit, 0);
    const totalCredits = data.lines.reduce((s, l) => s + l.credit, 0);
    if (Math.abs(totalDebits - totalCredits) > 0.005) {
      return { error: "Journal imbalance: debits " + totalDebits.toFixed(2) + " ≠ credits " + totalCredits.toFixed(2) };
    }

    await prisma.journalEntryLine.deleteMany({ where: { entryId } });
    await prisma.journalEntry.update({
      where: { id: entryId },
      data: {
        entryDate: new Date(data.entryDate),
        reference: data.reference ?? null,
        description: data.description,
        recognitionPeriod: data.recognitionPeriod,
        attachmentUrl: data.attachmentUrl ?? null,
        lines: {
          create: data.lines
            .filter((l) => l.debit > 0 || l.credit > 0)
            .map((l) => ({
              accountId: l.accountId,
              description: l.description ?? null,
              debit: l.debit,
              credit: l.credit,
            })),
        },
      },
    });

    revalidatePath("/accounting/journal-entries");
    revalidatePath("/accounting/journal-entries/" + entryId);
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to update entry" };
  }
}
