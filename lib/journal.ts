/**
 * Authoritative auto-journal posting helper for FINOS.
 *
 * Business-document postings should use JournalEntry + JournalEntryLine only.
 * This helper centralises posting integrity, tenant validation, idempotency,
 * accounting-period control, dimension validation and entry-number serialisation.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export interface JournalPostingLine {
  /** Preferred for reconstructed flows and system-account role resolution. */
  accountId?: string;
  /** Backward-compatible while legacy posting flows are migrated away from codes. */
  accountCode?: string;
  description?: string;
  debit: number;
  credit: number;
  projectId?: string | null;
  reportingTags?: Record<string, string> | null;
}

export interface PostJournalOptions {
  tenantId: string;
  createdBy: string;
  entryDate: Date;
  reference?: string | null;
  description: string;
  recognitionPeriod: string; // YYYY-MM
  source: string;
  sourceId: string;
  lines: JournalPostingLine[];
}

type ResolvedLine = JournalPostingLine & { accountId: string };

function assertPostingShape(opts: PostJournalOptions) {
  if (!opts.tenantId) throw new Error("Tenant is required for journal posting.");
  if (!opts.source?.trim()) throw new Error("Journal source is required.");
  if (!opts.sourceId?.trim()) throw new Error("Journal source ID is required for idempotent posting.");
  if (!/^\d{4}-\d{2}$/.test(opts.recognitionPeriod)) {
    throw new Error("Recognition period must use YYYY-MM format.");
  }
  if (!(opts.entryDate instanceof Date) || Number.isNaN(opts.entryDate.getTime())) {
    throw new Error("A valid journal entry date is required.");
  }
  if (opts.lines.length < 2) throw new Error("A journal must contain at least two lines.");

  for (const [index, line] of opts.lines.entries()) {
    if (!line.accountId?.trim() && !line.accountCode?.trim()) {
      throw new Error(`Journal line ${index + 1} is missing an account.`);
    }
    if (![line.debit, line.credit].every(Number.isFinite)) {
      throw new Error(`Journal line ${index + 1} contains an invalid amount.`);
    }
    if (line.debit < 0 || line.credit < 0) {
      throw new Error(`Journal line ${index + 1} cannot contain a negative debit or credit.`);
    }
    const hasDebit = line.debit > 0;
    const hasCredit = line.credit > 0;
    if (hasDebit === hasCredit) {
      throw new Error(`Journal line ${index + 1} must contain either a debit or a credit, but not both.`);
    }
  }

  const totalDebits = opts.lines.reduce((sum, line) => sum + line.debit, 0);
  const totalCredits = opts.lines.reduce((sum, line) => sum + line.credit, 0);
  if (Math.abs(totalDebits - totalCredits) > 0.005) {
    throw new Error(
      `Journal imbalance: debits ${totalDebits.toFixed(2)} ≠ credits ${totalCredits.toFixed(2)}`,
    );
  }
}

/**
 * Serialise every operation that changes or relies on one accounting period's
 * open/closed state. Posting, close and reopen actions must all take this same
 * advisory lock before reading the period status.
 */
export async function lockAccountingPeriodInTransaction(
  tx: Prisma.TransactionClient,
  tenantId: string,
  recognitionPeriod: string,
) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:period:${tenantId}:${recognitionPeriod}`}))`;
  return tx.accountingPeriod.findUnique({
    where: { tenantId_period: { tenantId, period: recognitionPeriod } },
    select: { isClosed: true },
  });
}

/** Throws if the period is closed, while holding the shared period lock. */
export async function assertPeriodOpenInTransaction(
  tx: Prisma.TransactionClient,
  tenantId: string,
  recognitionPeriod: string,
) {
  const period = await lockAccountingPeriodInTransaction(tx, tenantId, recognitionPeriod);
  if (period?.isClosed) {
    throw new Error(`Period ${recognitionPeriod} is closed. Reopen it before posting.`);
  }
}

async function resolveAndValidateLines(
  tx: Prisma.TransactionClient,
  tenantId: string,
  lines: JournalPostingLine[],
): Promise<ResolvedLine[]> {
  const accountIds = Array.from(new Set(lines.map((line) => line.accountId?.trim() || "").filter(Boolean)));
  const accountCodes = Array.from(new Set(lines.map((line) => line.accountCode?.trim() || "").filter(Boolean)));

  const accounts = await tx.chartOfAccounts.findMany({
    where: {
      tenantId,
      isActive: true,
      OR: [
        ...(accountIds.length ? [{ id: { in: accountIds } }] : []),
        ...(accountCodes.length ? [{ code: { in: accountCodes } }] : []),
      ],
    },
    select: { id: true, code: true },
  });
  const validIds = new Set(accounts.map((account) => account.id));
  const codeToId = new Map(accounts.map((account) => [account.code, account.id]));

  const resolved = lines.map((line, index) => {
    const suppliedId = line.accountId?.trim() || "";
    const suppliedCode = line.accountCode?.trim() || "";
    const resolvedId = suppliedId || codeToId.get(suppliedCode) || "";

    if (!resolvedId || !validIds.has(resolvedId)) {
      const label = suppliedCode || suppliedId || `line ${index + 1}`;
      throw new Error(`Active account not found in this entity: ${label}`);
    }
    if (suppliedId && suppliedCode && codeToId.get(suppliedCode) !== suppliedId) {
      throw new Error(`Journal line ${index + 1} contains conflicting account ID and code.`);
    }
    return { ...line, accountId: resolvedId };
  });

  const projectIds = Array.from(new Set(resolved.map((line) => line.projectId?.trim() || "").filter(Boolean)));
  if (projectIds.length) {
    const projects = await tx.project.findMany({
      where: { tenantId, id: { in: projectIds } },
      select: { id: true },
    });
    const validProjects = new Set(projects.map((project) => project.id));
    const invalid = projectIds.find((id) => !validProjects.has(id));
    if (invalid) throw new Error("One or more journal Projects do not belong to this entity.");
  }

  const tagOptionIds = Array.from(
    new Set(
      resolved.flatMap((line) => Object.values(line.reportingTags ?? {})).filter(Boolean),
    ),
  );
  if (tagOptionIds.length) {
    const options = await tx.reportingTagOption.findMany({
      where: { tenantId, id: { in: tagOptionIds }, isActive: true },
      select: { id: true },
    });
    const validOptions = new Set(options.map((option) => option.id));
    const invalid = tagOptionIds.find((id) => !validOptions.has(id));
    if (invalid) throw new Error("One or more journal Reporting Tags are invalid for this entity.");
  }

  return resolved;
}

async function nextEntryNumber(tx: Prisma.TransactionClient, tenantId: string) {
  // Serialise journal number allocation per tenant without requiring a schema change.
  // All reconstructed auto-posting flows should pass through this helper.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:journal:${tenantId}`}))`;
  const count = await tx.journalEntry.count({ where: { tenantId } });
  return `JE-${String(count + 1).padStart(5, "0")}`;
}

/**
 * Use this variant when the source business document is already being mutated in
 * a Prisma transaction. It lets the document and its journal commit or roll back together.
 */
export async function postJournalEntryInTransaction(
  tx: Prisma.TransactionClient,
  opts: PostJournalOptions,
): Promise<string> {
  assertPostingShape(opts);

  // Idempotent success: reprocessing the same business event returns the existing journal.
  const existing = await tx.journalEntry.findFirst({
    where: {
      tenantId: opts.tenantId,
      source: opts.source,
      sourceId: opts.sourceId,
    },
    select: { id: true },
  });
  if (existing) return existing.id;

  await assertPeriodOpenInTransaction(tx, opts.tenantId, opts.recognitionPeriod);
  const lines = await resolveAndValidateLines(tx, opts.tenantId, opts.lines);
  const entryNumber = await nextEntryNumber(tx, opts.tenantId);

  // Re-check after acquiring the tenant journal-number lock. This closes the gap
  // between two concurrent requests for the same source event.
  const duplicate = await tx.journalEntry.findFirst({
    where: {
      tenantId: opts.tenantId,
      source: opts.source,
      sourceId: opts.sourceId,
    },
    select: { id: true },
  });
  if (duplicate) return duplicate.id;

  const entry = await tx.journalEntry.create({
    data: {
      tenantId: opts.tenantId,
      entryNumber,
      entryDate: opts.entryDate,
      reference: opts.reference ?? null,
      description: opts.description,
      recognitionPeriod: opts.recognitionPeriod,
      source: opts.source,
      sourceId: opts.sourceId,
      createdBy: opts.createdBy,
      isLocked: true,
      lines: {
        create: lines.map((line) => ({
          accountId: line.accountId,
          description: line.description ?? null,
          debit: line.debit,
          credit: line.credit,
          projectId: line.projectId?.trim() || null,
          reportingTags: line.reportingTags ?? undefined,
        })),
      },
    },
    select: { id: true },
  });

  return entry.id;
}

export async function postJournalEntry(opts: PostJournalOptions): Promise<string> {
  return prisma.$transaction((tx) => postJournalEntryInTransaction(tx, opts));
}
