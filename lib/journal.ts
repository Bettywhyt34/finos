/**
 * Auto-journal posting helpers.
 * All business document mutations call these to maintain double-entry integrity.
 */
import { prisma } from "@/lib/prisma";

interface JournalLine {
  accountCode: string;
  description?: string;
  debit: number;
  credit: number;
}

interface PostJournalOptions {
  tenantId: string;
  createdBy: string;
  entryDate: Date;
  reference: string;
  description: string;
  recognitionPeriod: string; // YYYY-MM
  source: string;
  sourceId: string;
  lines: JournalLine[];
}

async function getNextEntryNumber(tenantId: string): Promise<string> {
  const count = await prisma.journalEntry.count({ where: { tenantId } });
  return `JE-${String(count + 1).padStart(5, "0")}`;
}

export async function postJournalEntry(opts: PostJournalOptions): Promise<string> {
  const { tenantId, createdBy, entryDate, reference, description, recognitionPeriod, source, sourceId, lines } = opts;

  // Check period is not locked
  const period = await prisma.accountingPeriod.findUnique({
    where: { tenantId_period: { tenantId, period: recognitionPeriod } },
  });
  if (period?.isClosed) {
    throw new Error(`Period ${recognitionPeriod} is closed. Reopen it before posting.`);
  }

  // Validate double-entry
  const totalDebits = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredits = lines.reduce((s, l) => s + l.credit, 0);
  if (Math.abs(totalDebits - totalCredits) > 0.001) {
    throw new Error(`Journal imbalance: debits ${totalDebits} ≠ credits ${totalCredits}`);
  }

  // Resolve account IDs
  const codes = lines.map((l) => l.accountCode);
  const accounts = await prisma.chartOfAccounts.findMany({
    where: { tenantId, code: { in: codes } },
    select: { id: true, code: true },
  });
  const codeToId = Object.fromEntries(accounts.map((a) => [a.code, a.id]));

  const entryNumber = await getNextEntryNumber(tenantId);

  const entry = await prisma.journalEntry.create({
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
      isLocked: true, // auto-entries are locked
      lines: {
        create: lines.map((l) => {
          const accountId = codeToId[l.accountCode];
          if (!accountId) throw new Error(`Account code not found: ${l.accountCode}`);
          return {
            accountId,
            description: l.description,
            debit: l.debit,
            credit: l.credit,
          };
        }),
      },
    },
  });

  return entry.id;
}
