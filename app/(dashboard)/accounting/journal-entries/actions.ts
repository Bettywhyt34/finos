"use server";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import {
  assertPeriodOpenInTransaction,
  postJournalEntryInTransaction,
} from "@/lib/journal";

async function getOrgAndUser() {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Unauthorized");
  return {
    orgId: session.user.tenantId,
    userId: (session.user as { id?: string }).id ?? "system",
  };
}

async function getNextManualEntryNumber(tx: Prisma.TransactionClient, orgId: string): Promise<string> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:journal:${orgId}`}))`;
  const count = await tx.journalEntry.count({ where: { tenantId: orgId } });
  return "MJE-" + String(count + 1).padStart(5, "0");
}

function validateBalancedLines(lines: JournalLineInput[]) {
  const activeLines = lines.filter((l) => l.debit > 0 || l.credit > 0);
  if (activeLines.length < 2) throw new Error("A journal must contain at least two lines.");

  for (const [index, line] of activeLines.entries()) {
    if (![line.debit, line.credit].every(Number.isFinite) || line.debit < 0 || line.credit < 0) {
      throw new Error(`Journal line ${index + 1} contains an invalid amount.`);
    }
    if ((line.debit > 0) === (line.credit > 0)) {
      throw new Error(`Journal line ${index + 1} must contain either a debit or a credit, but not both.`);
    }
  }

  const totalDebits = activeLines.reduce((s, l) => s + l.debit, 0);
  const totalCredits = activeLines.reduce((s, l) => s + l.credit, 0);
  if (Math.abs(totalDebits - totalCredits) > 0.005) {
    throw new Error(
      "Journal imbalance: debits " + totalDebits.toFixed(2) + " ≠ credits " + totalCredits.toFixed(2),
    );
  }
  return activeLines;
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
    const lines = validateBalancedLines(data.lines);

    const entry = await prisma.$transaction(async (tx) => {
      // Drafts do not hit the ledger, but a closed period should not acquire new drafts.
      await assertPeriodOpenInTransaction(tx, orgId, data.recognitionPeriod);
      const entryNumber = await getNextManualEntryNumber(tx, orgId);

      const uniqueAccountIds = Array.from(new Set(lines.map((line) => line.accountId)));
      const accounts = await tx.chartOfAccounts.count({
        where: {
          tenantId: orgId,
          isActive: true,
          id: { in: uniqueAccountIds },
        },
      });
      if (accounts !== uniqueAccountIds.length) {
        throw new Error("One or more journal accounts do not belong to this entity or are inactive.");
      }

      return tx.journalEntry.create({
        data: {
          tenantId: orgId,
          entryNumber,
          entryDate: new Date(data.entryDate),
          reference: data.reference ?? null,
          description: data.description,
          recognitionPeriod: data.recognitionPeriod,
          isReversing: data.isReversing,
          isLocked: false,
          source: "manual",
          sourceId: entryNumber,
          attachmentUrl: data.attachmentUrl ?? null,
          createdBy: userId,
          lines: {
            create: lines.map((line) => ({
              accountId: line.accountId,
              description: line.description ?? null,
              debit: line.debit,
              credit: line.credit,
            })),
          },
        },
      });
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

    await prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.findFirst({
        where: { id: entryId, tenantId: orgId },
        include: { lines: true },
      });
      if (!entry) throw new Error("Entry not found");
      if (entry.isLocked) throw new Error("Entry is already posted");

      await assertPeriodOpenInTransaction(tx, orgId, entry.recognitionPeriod);
      validateBalancedLines(
        entry.lines.map((line) => ({
          accountId: line.accountId,
          description: line.description ?? undefined,
          debit: Number(line.debit),
          credit: Number(line.credit),
        })),
      );

      await tx.journalEntry.update({
        where: { id: entryId },
        data: { isLocked: true },
      });
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
    const today = new Date();
    const period = today.toISOString().slice(0, 7);

    const reversalId = await prisma.$transaction(async (tx) => {
      const original = await tx.journalEntry.findFirst({
        where: { id: entryId, tenantId: orgId, isLocked: true },
        include: { lines: true },
      });
      if (!original) throw new Error("Entry not found or not posted");

      const existingReversal = await tx.journalEntry.findFirst({
        where: { tenantId: orgId, source: "reversal", sourceId: entryId },
        select: { id: true },
      });
      if (existingReversal) throw new Error("Entry has already been reversed");

      const createdId = await postJournalEntryInTransaction(tx, {
        tenantId: orgId,
        createdBy: userId,
        entryDate: today,
        reference: "REV-" + original.entryNumber,
        description: "Reversal of " + original.entryNumber + ": " + original.description,
        recognitionPeriod: period,
        source: "reversal",
        sourceId: entryId,
        lines: original.lines.map((line) => ({
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

      await tx.journalEntry.update({
        where: { id: createdId },
        data: {
          isReversing: true,
          reversedById: entryId,
          reversalReason: reason,
        },
      });
      return createdId;
    });

    revalidatePath("/accounting/journal-entries");
    revalidatePath("/accounting/journal-entries/" + entryId);
    return { success: true, reversalId };
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
    const lines = validateBalancedLines(data.lines);

    await prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.findFirst({
        where: { id: entryId, tenantId: orgId },
      });
      if (!entry) throw new Error("Entry not found");
      if (entry.isLocked) throw new Error("Cannot edit a posted entry");

      // The target period is the relevant control when a draft is moved between months.
      await assertPeriodOpenInTransaction(tx, orgId, data.recognitionPeriod);

      const uniqueAccountIds = Array.from(new Set(lines.map((line) => line.accountId));
      const accountCount = await tx.chartOfAccounts.count({
        where: { tenantId: orgId, isActive: true, id: { in: uniqueAccountIds } },
      });
      if (accountCount !== uniqueAccountIds.length) {
        throw new Error("One or more journal accounts do not belong to this entity or are inactive.");
      }

      await tx.journalEntryLine.deleteMany({ where: { entryId } });
      await tx.journalEntry.update({
        where: { id: entryId },
        data: {
          entryDate: new Date(data.entryDate),
          reference: data.reference ?? null,
          description: data.description,
          recognitionPeriod: data.recognitionPeriod,
          attachmentUrl: data.attachmentUrl ?? null,
          lines: {
            create: lines.map((line) => ({
              accountId: line.accountId,
              description: line.description ?? null,
              debit: line.debit,
              credit: line.credit,
            })),
          },
        },
      });
    });

    revalidatePath("/accounting/journal-entries");
    revalidatePath("/accounting/journal-entries/" + entryId);
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to update entry" };
  }
}
