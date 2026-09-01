/**
 * XpenxFlow sync processor.
 * server-only — uses Prisma, OAuth tokens, and journal posting.
 *
 * Sync order (dependency-safe):
 *   1. Bills      → upsert bill + accounting lifecycle atomically
 *   2. Expenses   → upsert expense + accounting lifecycle atomically
 *   3. Journals   → cache to unified_transactions_cache (no FINOS GL re-post)
 *   4. Assets     → cache to unified_transactions_cache
 *   5. Budgets    → cache to unified_transactions_cache
 *
 * Token behaviour:
 *   - Token TTL is rolling: XpenxFlow resets it on every successful call.
 *   - After a full sync, FINOS mirrors this by resetting tokenExpiresAt = now + 90d.
 *   - On 401 token_expired: connection is marked TOKEN_EXPIRED and the sync aborts.
 */
import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SyncJobPayload } from "@/lib/integrations/bullmq-queue";
import {
  quarantineRecord,
  upsertCache,
  resolveAccountMappings,
} from "@/lib/integrations/sync-engine";
import { getValidAccessToken } from "@/lib/integrations/oauth-refresh";
import { markTokenExpired } from "@/lib/integrations/oauth-refresh";
import { buildCallbackUri } from "@/lib/integrations/oauth-config";
import { upsertXpenxflowExpenseWithAccounting } from "./expense-accounting";
import { upsertXpenxflowBillAccounting } from "./bill-accounting";
import {
  createXFClient,
  XPENXFLOW_TOKEN_EXPIRED,
  type XpenxFlowClient,
} from "./client";
import {
  parseCursor,
  stringifyCursor,
  type XFJournal,
  type XFAsset,
  type XFBudget,
} from "./cdm";

type JsonObject = Prisma.InputJsonObject;

const SOURCE            = "xpenxflow" as const;
const ROLLING_TTL_DAYS  = 90;

type Counts = {
  processed:   number;
  created:     number;
  updated:     number;
  failed:      number;
  quarantined: number;
};

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function processXpenxflow(payload: SyncJobPayload): Promise<
  Counts & { nextCursor?: string }
> {
  const { tenantId, connectionId, syncLogId, cursor } = payload;

  const connection = await prisma.integrationConnection.findUniqueOrThrow({
    where:  { id: connectionId },
    select: { apiUrl: true },
  });

  if (!connection.apiUrl) {
    throw new Error("XpenxFlow connection missing apiUrl");
  }

  const appUrl      = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const redirectUri = buildCallbackUri(appUrl, SOURCE);

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(connectionId, redirectUri);
  } catch (err) {
    throw new Error(`XpenxFlow token unavailable: ${err instanceof Error ? err.message : err}`);
  }

  const xf          = createXFClient(connection.apiUrl, accessToken);
  const since       = parseCursor(cursor).since;
  const newCursorTs = new Date().toISOString();

  const totals: Counts = { processed: 0, created: 0, updated: 0, failed: 0, quarantined: 0 };
  const add = (c: Counts) => {
    totals.processed   += c.processed;
    totals.created     += c.created;
    totals.updated     += c.updated;
    totals.failed      += c.failed;
    totals.quarantined += c.quarantined;
  };

  try {
    // Order matters: bills + expenses depend on vendor/category data from prior syncs.
    add(await syncBills(xf, tenantId, syncLogId, since));
    add(await syncExpenses(xf, tenantId, syncLogId, since));
    add(await syncJournals(xf, tenantId, syncLogId, since));
    add(await syncAssets(xf, tenantId, syncLogId, since));
    add(await syncBudgets(xf, tenantId, syncLogId, since));
  } catch (err) {
    if (err instanceof Error && err.message === XPENXFLOW_TOKEN_EXPIRED) {
      await markTokenExpired(connectionId);
      throw new Error("XpenxFlow token expired — please reconnect the integration");
    }
    throw err;
  }

  await prisma.integrationConnection.update({
    where: { id: connectionId },
    data:  { tokenExpiresAt: new Date(Date.now() + ROLLING_TTL_DAYS * 24 * 60 * 60 * 1000) },
  });

  return { ...totals, nextCursor: stringifyCursor({ since: newCursorTs }) };
}

// ─── Bills ────────────────────────────────────────────────────────────────────

async function syncBills(
  xf:        XpenxFlowClient,
  orgId:     string,
  syncLogId: string,
  since:     string,
): Promise<Counts> {
  const c    = zero();
  const data = await xf.getBills(since);

  const allCodes   = Array.from(new Set(data.flatMap((b) => b.lines.map((l) => l.account_code))));
  const accountMap = await resolveAccountMappings(orgId, SOURCE, allCodes);

  for (const raw of data) {
    c.processed++;
    try {
      (await upsertXpenxflowBillAccounting(orgId, raw, accountMap)) === "created"
        ? c.created++
        : c.updated++;
      const { lines: _lines, ...billMeta } = raw;
      await upsertCache(orgId, SOURCE, "bills", raw.id, billMeta as unknown as JsonObject);
    } catch (err) {
      c.failed++;
      c.quarantined++;
      await quarantineRecord(
        orgId, syncLogId, SOURCE, "bills", raw.id,
        raw as unknown as JsonObject,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return c;
}

// ─── Expenses ─────────────────────────────────────────────────────────────────

async function syncExpenses(
  xf:        XpenxFlowClient,
  orgId:     string,
  syncLogId: string,
  since:     string,
): Promise<Counts> {
  const c    = zero();
  const data = await xf.getExpenses(since);

  for (const raw of data) {
    c.processed++;
    try {
      (await upsertXpenxflowExpenseWithAccounting(orgId, raw)) === "created"
        ? c.created++
        : c.updated++;
      await upsertCache(orgId, SOURCE, "expenses", raw.id, raw as unknown as JsonObject);
    } catch (err) {
      c.failed++;
      c.quarantined++;
      await quarantineRecord(
        orgId, syncLogId, SOURCE, "expenses", raw.id,
        raw as unknown as JsonObject,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return c;
}

// ─── Journals (cached — no FINOS GL re-post to avoid duplicates) ─────────────

async function syncJournals(
  xf:        XpenxFlowClient,
  orgId:     string,
  syncLogId: string,
  since:     string,
): Promise<Counts> {
  const c    = zero();
  const data = await xf.getJournals(since);

  for (const raw of data) {
    c.processed++;
    try {
      validateJournalBalance(raw);
      await upsertCache(
        orgId, SOURCE, "journals", raw.id,
        raw as unknown as JsonObject,
        raw.recognition_period ?? undefined,
      );
      c.created++;
    } catch (err) {
      c.failed++;
      c.quarantined++;
      await quarantineRecord(
        orgId, syncLogId, SOURCE, "journals", raw.id,
        raw as unknown as JsonObject,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return c;
}

function validateJournalBalance(xf: XFJournal): void {
  const totalDebit  = xf.lines.reduce((s, l) => s + l.debit,  0);
  const totalCredit = xf.lines.reduce((s, l) => s + l.credit, 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(
      `Journal ${xf.id} is unbalanced: debits ${totalDebit.toFixed(2)} ≠ credits ${totalCredit.toFixed(2)}`
    );
  }
}

// ─── Assets (cached) ──────────────────────────────────────────────────────────

async function syncAssets(
  xf:        XpenxFlowClient,
  orgId:     string,
  syncLogId: string,
  since:     string,
): Promise<Counts> {
  const c    = zero();
  const data = await xf.getAssets(since);

  for (const raw of data) {
    c.processed++;
    try {
      await upsertCache(orgId, SOURCE, "assets", raw.id, raw as unknown as JsonObject);
      c.created++;
    } catch (err) {
      c.failed++;
      c.quarantined++;
      await quarantineRecord(
        orgId, syncLogId, SOURCE, "assets", raw.id,
        raw as unknown as JsonObject,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return c;
}

// ─── Budgets (cached — integration with FINOS budget module TBD) ─────────────

async function syncBudgets(
  xf:        XpenxFlowClient,
  orgId:     string,
  syncLogId: string,
  since:     string,
): Promise<Counts> {
  const c    = zero();
  const data = await xf.getBudgets(since);

  for (const raw of data) {
    c.processed++;
    try {
      await upsertCache(orgId, SOURCE, "budgets", raw.id, raw as unknown as JsonObject);
      c.created++;
    } catch (err) {
      c.failed++;
      c.quarantined++;
      await quarantineRecord(
        orgId, syncLogId, SOURCE, "budgets", raw.id,
        raw as unknown as JsonObject,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return c;
}

function zero(): Counts {
  return { processed: 0, created: 0, updated: 0, failed: 0, quarantined: 0 };
}
