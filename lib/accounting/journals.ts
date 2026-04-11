/**
 * lib/accounting/journals.ts
 * Phase 2.5 Week 3 — canonical journal posting service.
 *
 * Writes to journal_lines (canonical direction+amount model).
 * Wraps inserts in a single Prisma transaction so the DEFERRABLE
 * imbalance trigger fires at commit with all lines present.
 * Never posts to a closed accounting_period.
 *
 * The legacy lib/journal.ts (writes to journal_entry_lines) is retained
 * for backward compatibility and is not modified here.
 */

import { prisma } from "@/lib/prisma";

// ── Types ──────────────────────────────────────────────────────────────────────

export type JournalLineInput = {
  accountId:   string;
  direction:   "DR" | "CR";
  amountNgn:   number;
  description?: string;
};

export type PostJournalOptions = {
  tenantId:          string;
  createdBy:         string;
  entryDate:         Date;
  reference?:        string;
  description:       string;
  recognitionPeriod: string;   // YYYY-MM
  source:            string;
  sourceId?:         string;
  lines:             JournalLineInput[];
};

// ── Guards ─────────────────────────────────────────────────────────────────────

/** Throws if the accounting period is closed. Missing row = open (new-tenant safe). */
async function assertPeriodOpen(tenantId: string, period: string): Promise<void> {
  const row = await prisma.accountingPeriod.findFirst({
    where: { tenantId, period },
    select: { isClosed: true },
  });
  if (row?.isClosed) {
    throw new Error(`Accounting period ${period} is closed`);
  }
}

/** Throws if DR total ≠ CR total (tolerance 0.001). */
function assertBalanced(lines: JournalLineInput[]): void {
  const net = lines.reduce(
    (sum, l) => sum + (l.direction === "DR" ? l.amountNgn : -l.amountNgn),
    0,
  );
  if (Math.abs(net) > 0.001) {
    throw new Error(
      `Journal lines are not balanced: DR-CR net = ${net.toFixed(4)}`,
    );
  }
}

// ── Entry-number generator ─────────────────────────────────────────────────────

async function nextEntryNumber(tenantId: string): Promise<string> {
  const last = await prisma.journalEntry.findFirst({
    where:   { tenantId },
    orderBy: { createdAt: "desc" },
    select:  { entryNumber: true },
  });
  const lastNum = last
    ? parseInt(last.entryNumber.replace(/\D/g, ""), 10)
    : 0;
  return `JE-${String(lastNum + 1).padStart(5, "0")}`;
}

// ── Main service function ──────────────────────────────────────────────────────

/**
 * Posts a balanced journal entry to the canonical journal_lines table.
 *
 * All inserts run inside a single Prisma transaction. The DEFERRABLE
 * INITIALLY DEFERRED imbalance trigger (trg_journal_balance) fires at
 * transaction commit, at which point all lines are present and the net
 * balance is 0.
 *
 * Returns the created JournalEntry record.
 */
export async function postJournalEntry(opts: PostJournalOptions) {
  const {
    tenantId,
    createdBy,
    entryDate,
    reference,
    description,
    recognitionPeriod,
    source,
    sourceId,
    lines,
  } = opts;

  if (lines.length === 0) {
    throw new Error("Journal entry must have at least one line");
  }
  if (lines.some((l) => l.amountNgn <= 0)) {
    throw new Error("All journal line amounts must be positive (> 0)");
  }

  assertBalanced(lines);
  await assertPeriodOpen(tenantId, recognitionPeriod);

  const entryNumber = await nextEntryNumber(tenantId);

  return prisma.$transaction(async (tx) => {
    // 1. Create the journal entry header
    const entry = await tx.journalEntry.create({
      data: {
        tenantId,
        entryNumber,
        entryDate,
        reference,
        description,
        recognitionPeriod,
        source,
        sourceId,
        createdBy,
        isLocked: true,
      },
    });

    // 2. Create canonical journal lines (direction + amount model)
    //    All lines land in the same transaction so the DEFERRABLE trigger
    //    finds a balanced entry at commit time.
    await tx.journalLine.createMany({
      data: lines.map((l) => ({
        jeId:        entry.id,
        tenantId,
        accountId:   l.accountId,
        direction:   l.direction,
        amountNgn:   l.amountNgn,
        description: l.description,
      })),
    });

    return entry;
  });
}

// ── Helpers for callers ────────────────────────────────────────────────────────

/** Resolve an account code → account id for a given tenant. */
export async function resolveAccountCode(
  tenantId: string,
  code: string,
): Promise<string> {
  const account = await prisma.chartOfAccounts.findFirst({
    where:  { tenantId, code, isActive: true },
    select: { id: true },
  });
  if (!account) {
    throw new Error(`Account code ${code} not found for tenant`);
  }
  return account.id;
}

/** Resolve multiple account codes in a single query. */
export async function resolveAccountCodes(
  tenantId: string,
  codes: string[],
): Promise<Map<string, string>> {
  const accounts = await prisma.chartOfAccounts.findMany({
    where:  { tenantId, code: { in: codes }, isActive: true },
    select: { id: true, code: true },
  });
  const map = new Map(accounts.map((a) => [a.code, a.id]));
  const missing = codes.filter((c) => !map.has(c));
  if (missing.length > 0) {
    throw new Error(`Account codes not found: ${missing.join(", ")}`);
  }
  return map;
}
