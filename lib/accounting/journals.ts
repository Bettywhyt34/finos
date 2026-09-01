/**
 * Compatibility adapter for older callers that still use the DR/CR + amount shape.
 *
 * IMPORTANT: this module does NOT implement a second ledger. All postings are
 * converted and delegated to ../journal.ts, whose JournalEntry +
 * JournalEntryLine model is FINOS's authoritative general ledger.
 *
 * New code should import directly from @/lib/journal.
 */
import {
  postJournalEntry as postAuthoritativeJournalEntry,
  type JournalPostingLine,
} from "@/lib/journal";

export type JournalLineInput = {
  accountId: string;
  direction: "DR" | "CR";
  amountNgn: number;
  description?: string;
};

export type PostJournalOptions = {
  tenantId: string;
  createdBy: string;
  entryDate: Date;
  reference?: string;
  description: string;
  recognitionPeriod: string;
  source: string;
  sourceId?: string;
  lines: JournalLineInput[];
};

/**
 * Backward-compatible adapter. The authoritative helper requires sourceId for
 * idempotency, so legacy callers must now provide one as well.
 */
export async function postJournalEntry(opts: PostJournalOptions): Promise<{ id: string }> {
  if (!opts.sourceId?.trim()) {
    throw new Error("Journal source ID is required for idempotent posting.");
  }

  const lines: JournalPostingLine[] = opts.lines.map((line) => ({
    accountId: line.accountId,
    description: line.description,
    debit: line.direction === "DR" ? line.amountNgn : 0,
    credit: line.direction === "CR" ? line.amountNgn : 0,
  }));

  const id = await postAuthoritativeJournalEntry({
    tenantId: opts.tenantId,
    createdBy: opts.createdBy,
    entryDate: opts.entryDate,
    reference: opts.reference ?? null,
    description: opts.description,
    recognitionPeriod: opts.recognitionPeriod,
    source: opts.source,
    sourceId: opts.sourceId,
    lines,
  });

  return { id };
}
