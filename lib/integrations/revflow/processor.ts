/**
 * Revflow sync processor.
 * server-only — Prisma, auto-journal posting, Zod validation.
 *
 * Sync order (dependency-safe):
 *   1. Chart of Accounts → validate account mappings exist
 *   2. Campaigns         → upsert RevflowCampaign
 *   3. Invoices          → upsert RevflowInvoice + auto-post GL (DR AR / CR Revenue)
 *   4. Payments          → update invoice.paidAmount + post GL (DR Bank / CR AR + WHT)
 *   5. Journal Entries   → validate balance + cache (no FINOS GL re-post)
 *
 * Auto-post account codes (FINOS standard):
 *   CA-001  Accounts Receivable
 *   CA-002  WHT Receivable (tax asset)
 *   CA-003  Bank / Cash
 *   IN-001  Service Revenue (default; overridden by revenueAccountCode if set)
 *   OE-001  Write-off Expense
 */
import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SyncJobPayload } from "@/lib/integrations/bullmq-queue";
import {
  quarantineRecord,
  upsertCache,
} from "@/lib/integrations/sync-engine";
import { postJournalEntry } from "@/lib/journal";
import { getValidAccessToken } from "@/lib/integrations/oauth-refresh";
import { buildCallbackUri } from "@/lib/integrations/oauth-config";
import { createRevflowClient } from "./client";
import {
  RFCoAResponseSchema,
  parseRFCursor,
  stringifyRFCursor,
  type RFCampaign,
  type RFInvoice,
  type RFPayment,
  type RFJournalEntry,
} from "./types";

type JsonObject = Prisma.InputJsonObject;

const SOURCE = "revflow" as const;

// FINOS standard account codes for Revflow journal entries
const AC = {
  AR:       "CA-001",
  WHT:      "CA-002",
  BANK:     "CA-003",
  REVENUE:  "IN-001",
  WRITEOFF: "OE-001",
} as const;

type Counts = {
  processed:   number;
  created:     number;
  updated:     number;
  failed:      number;
  quarantined: number;
};

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function processRevflow(
  payload: SyncJobPayload
): Promise<Counts & { nextCursor?: string }> {
  const { tenantId, connectionId, syncLogId, cursor } = payload;

  const connection = await prisma.integrationConnection.findUniqueOrThrow({
    where:  { id: connectionId },
    select: { apiUrl: true },
  });

  if (!connection.apiUrl) {
    throw new Error("Revflow connection missing apiUrl");
  }

  const appUrl      = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const redirectUri = buildCallbackUri(appUrl, SOURCE);
  const accessToken = await getValidAccessToken(connectionId, redirectUri);
  const client      = createRevflowClient(connection.apiUrl, accessToken);
  const since  = parseRFCursor(cursor).since;
  const newTs  = new Date().toISOString();

  const totals: Counts = { processed: 0, created: 0, updated: 0, failed: 0, quarantined: 0 };
  const add = (c: Counts) => {
    totals.processed   += c.processed;
    totals.created     += c.created;
    totals.updated     += c.updated;
    totals.failed      += c.failed;
    totals.quarantined += c.quarantined;
  };

  // 1. Validate account mappings (no quarantine — throw to abort sync on missing maps)
  await validateAccountMappings(client, tenantId, since);

  // 2-5. Sync entities in dependency order
  add(await syncCampaigns(client, tenantId, syncLogId, since));
  add(await syncInvoices(client, tenantId, syncLogId, since));
  add(await syncPayments(client, tenantId, syncLogId, since));
  add(await syncJournalEntries(client, tenantId, syncLogId, since));

  return { ...totals, nextCursor: stringifyRFCursor({ since: newTs }) };
}

// ─── Step 1: Validate account mappings ───────────────────────────────────────

async function validateAccountMappings(
  client: ReturnType<typeof createRevflowClient>,
  orgId: string,
  _since: string
): Promise<void> {
  const raw = await client.chartOfAccounts();
  const parse = RFCoAResponseSchema.safeParse(raw);
  if (!parse.success) {
    // Non-fatal: CoA endpoint may not exist on all Revflow versions
    console.warn("[revflow] CoA endpoint returned unexpected shape — skipping validation");
    return;
  }

  const missingCodes: string[] = [];
  for (const xfAcc of parse.data) {
    const exists = await prisma.chartOfAccounts.findFirst({
      where: { tenantId: orgId, code: xfAcc.code },
      select: { id: true },
    });
    if (!exists) missingCodes.push(xfAcc.code);
  }

  if (missingCodes.length > 0) {
    console.warn(
      `[revflow] ${missingCodes.length} Revflow account codes have no FINOS mapping: ` +
      missingCodes.slice(0, 10).join(", ")
    );
    // Warn only — do not abort. Processors will quarantine records with unmapped accounts.
  }
}

// ─── Step 2: Campaigns ───────────────────────────────────────────────────────

async function syncCampaigns(
  client: ReturnType<typeof createRevflowClient>,
  orgId: string,
  syncLogId: string,
  since: string
): Promise<Counts> {
  const c    = zero();
  const data = await client.getCampaigns(since);

  for (const xf of data) {
    c.processed++;
    try {
      (await upsertCampaign(orgId, xf)) === "created" ? c.created++ : c.updated++;
      await upsertCache(orgId, SOURCE, "campaigns", xf.id, xf as unknown as JsonObject);
    } catch (err) {
      c.failed++;
      c.quarantined++;
      await quarantineRecord(
        orgId, syncLogId, SOURCE, "campaigns", xf.id,
        xf as unknown as JsonObject,
        String(err instanceof Error ? err.message : err)
      );
    }
  }
  return c;
}

async function upsertCampaign(
  orgId: string,
  xf: RFCampaign
): Promise<"created" | "updated"> {
  const data = {
    clientName:      xf.clientName,
    campaignName:    xf.name,
    campaignCode:    xf.campaignCode ?? undefined,
    startDate:       xf.startDate ? new Date(xf.startDate) : undefined,
    endDate:         xf.endDate   ? new Date(xf.endDate)   : undefined,
    contractedAmount: xf.plannedValue,
    currency:        xf.currency,
    status:          xf.status ?? undefined,
    syncedAt:        new Date(),
  };

  const existing = await prisma.revflowCampaign.findUnique({
    where: { tenantId_revflowId: { tenantId: orgId, revflowId: xf.id } },
    select: { id: true },
  });

  if (existing) {
    await prisma.revflowCampaign.update({ where: { id: existing.id }, data });
    return "updated";
  }

  await prisma.revflowCampaign.create({
    data: { ...data, tenantId: orgId, revflowId: xf.id },
  });
  return "created";
}

// ─── Step 3: Invoices + GL auto-post ─────────────────────────────────────────

async function syncInvoices(
  client: ReturnType<typeof createRevflowClient>,
  orgId: string,
  syncLogId: string,
  since: string
): Promise<Counts> {
  const c    = zero();
  // Revflow entity name is "documents"; getInvoices() maps this internally.
  const data = await client.getInvoices(since);

  for (const xf of data) {
    c.processed++;
    try {
      (await upsertInvoice(orgId, xf)) === "created" ? c.created++ : c.updated++;
      await upsertCache(
        orgId, SOURCE, "invoices", xf.id,
        xf as unknown as JsonObject,
        xf.recognitionPeriod
      );
    } catch (err) {
      c.failed++;
      c.quarantined++;
      await quarantineRecord(
        orgId, syncLogId, SOURCE, "invoices", xf.id,
        xf as unknown as JsonObject,
        String(err instanceof Error ? err.message : err)
      );
    }
  }
  return c;
}

async function upsertInvoice(
  orgId: string,
  xf: RFInvoice
): Promise<"created" | "updated"> {
  // Resolve campaign FK (may be null)
  let campaignId: string | null = null;
  if (xf.campaignId) {
    const camp = await prisma.revflowCampaign.findUnique({
      where: { tenantId_revflowId: { tenantId: orgId, revflowId: xf.campaignId } },
      select: { id: true },
    });
    campaignId = camp?.id ?? null;
  }

  const invoiceData = {
    campaignId:        campaignId ?? undefined,
    invoiceNumber:     xf.invoiceNumber,
    clientName:        xf.clientName,
    invoiceDate:       new Date(xf.issueDate),
    dueDate:           xf.dueDate ? new Date(xf.dueDate) : undefined,
    recognitionPeriod: xf.recognitionPeriod,
    currency:          xf.currency,
    exchangeRate:      xf.exchangeRate,
    subtotal:          xf.amountBeforeVat,
    taxAmount:         xf.vatAmount,
    totalAmount:       xf.totalAmount,
    paidAmount:        xf.paidAmount,
    status:            xf.status,
    syncedAt:          new Date(),
  };

  const existing = await prisma.revflowInvoice.findUnique({
    where:  { tenantId_revflowId: { tenantId: orgId, revflowId: xf.id } },
    select: { id: true, finosJournalId: true },
  });

  if (existing) {
    await prisma.revflowInvoice.update({
      where: { id: existing.id },
      data:  invoiceData,
    });

    // Auto-post GL if not yet posted and status warrants it
    if (!existing.finosJournalId && shouldPostInvoiceGL(xf.status)) {
      await postInvoiceGL(orgId, existing.id, xf);
    }
    return "updated";
  }

  const created = await prisma.revflowInvoice.create({
    data: { ...invoiceData, tenantId: orgId, revflowId: xf.id },
  });

  if (shouldPostInvoiceGL(xf.status)) {
    await postInvoiceGL(orgId, created.id, xf);
  }
  return "created";
}

function shouldPostInvoiceGL(status: string): boolean {
  return ["SENT", "PARTIAL", "PAID", "OVERDUE"].includes(status);
}

async function postInvoiceGL(
  orgId: string,
  finosInvoiceId: string,
  xf: RFInvoice
): Promise<void> {
  const revenueCode = xf.revenueAccountCode ?? AC.REVENUE;
  const ngn         = xf.totalAmount * xf.exchangeRate;

  const jeId = await postJournalEntry({
    tenantId:    orgId,
    createdBy:         "revflow-sync",
    entryDate:         new Date(xf.issueDate),
    reference:         xf.invoiceNumber,
    description:       `Revflow invoice ${xf.invoiceNumber} — ${xf.clientName}`,
    recognitionPeriod: xf.recognitionPeriod,
    source:            SOURCE,
    sourceId:          xf.id,
    lines: [
      { accountCode: AC.AR,      debit: ngn,  credit: 0,   description: xf.clientName },
      { accountCode: revenueCode, debit: 0,   credit: ngn, description: xf.recognitionPeriod },
    ],
  });

  await prisma.revflowInvoice.update({
    where: { id: finosInvoiceId },
    data:  { finosJournalId: jeId },
  });
}

// ─── Step 4: Payments + GL auto-post ─────────────────────────────────────────

async function syncPayments(
  client: ReturnType<typeof createRevflowClient>,
  orgId: string,
  syncLogId: string,
  since: string
): Promise<Counts> {
  const c    = zero();
  const data = await client.getPayments(since);

  for (const xf of data) {
    c.processed++;
    try {
      (await upsertPayment(orgId, xf)) === "created" ? c.created++ : c.updated++;
      await upsertCache(orgId, SOURCE, "payments", xf.id, xf as unknown as JsonObject);
    } catch (err) {
      c.failed++;
      c.quarantined++;
      await quarantineRecord(
        orgId, syncLogId, SOURCE, "payments", xf.id,
        xf as unknown as JsonObject,
        String(err instanceof Error ? err.message : err)
      );
    }
  }
  return c;
}

async function upsertPayment(
  orgId: string,
  xf: RFPayment
): Promise<"created" | "updated"> {
  // Check if we already cached this payment
  const cached = await prisma.unifiedTransactionsCache.findFirst({
    where: {
      tenantId: orgId,
      sourceApp:   SOURCE,
      sourceTable: "payments",
      sourceId:    xf.id,
    },
    select: { id: true },
  });

  // Lookup by revflowId stored on the RevflowInvoice row
  const revInvoice = await prisma.revflowInvoice.findUnique({
    where: { tenantId_revflowId: { tenantId: orgId, revflowId: xf.invoiceId } },
    select: { id: true, recognitionPeriod: true, invoiceNumber: true, totalAmount: true, paidAmount: true },
  });

  if (!revInvoice) {
    throw new Error(
      `RevflowInvoice "${xf.invoiceId}" not in FINOS. Sync invoices before payments.`
    );
  }

  // Update paidAmount on invoice
  const newPaid = Number(revInvoice.paidAmount) + xf.amount - xf.whtDeducted;
  await prisma.revflowInvoice.update({
    where: { id: revInvoice.id },
    data:  {
      paidAmount: Math.min(newPaid, Number(revInvoice.totalAmount)),
      syncedAt:   new Date(),
    },
  });

  // Post payment GL (if new payment)
  if (!cached) {
    await postPaymentGL(orgId, xf, revInvoice.recognitionPeriod ?? "YYYY-MM", revInvoice.invoiceNumber);
  }

  return cached ? "updated" : "created";
}

async function postPaymentGL(
  orgId: string,
  xf: RFPayment,
  recognitionPeriod: string,
  invoiceNumber: string
): Promise<void> {
  const grossNGN = xf.amount;
  const whtNGN   = xf.whtDeducted;
  const netNGN   = grossNGN - whtNGN;

  const lines: Parameters<typeof postJournalEntry>[0]["lines"] = [];

  // DR Bank (net received)
  if (netNGN > 0) {
    lines.push({ accountCode: AC.BANK, debit: netNGN, credit: 0, description: xf.reference ?? invoiceNumber });
  }

  // DR WHT Receivable (tax asset — client deducted on our behalf)
  if (whtNGN > 0) {
    lines.push({ accountCode: AC.WHT, debit: whtNGN, credit: 0, description: `WHT on ${invoiceNumber}` });
  }

  // CR Accounts Receivable (full gross)
  lines.push({ accountCode: AC.AR, debit: 0, credit: grossNGN, description: invoiceNumber });

  if (lines.length === 0) return;

  await postJournalEntry({
    tenantId:    orgId,
    createdBy:         "revflow-sync",
    entryDate:         new Date(xf.paymentDate),
    reference:         xf.reference ?? invoiceNumber,
    description:       `Payment received: ${invoiceNumber} (${xf.method})`,
    recognitionPeriod,
    source:            SOURCE,
    sourceId:          xf.id,
    lines,
  });
}

// ─── Step 5: Journal entries (Revflow GL → unified cache) ────────────────────
// We validate double-entry balance but do NOT re-post to FINOS GL (to avoid duplicates).
// The FINOS GL is maintained by the invoice/payment auto-post above.
// Revflow JEs are cached for audit / discrepancy review.

async function syncJournalEntries(
  client: ReturnType<typeof createRevflowClient>,
  orgId: string,
  syncLogId: string,
  since: string
): Promise<Counts> {
  const c    = zero();
  const data = await client.getJournalEntries(since);

  for (const xf of data) {
    c.processed++;
    try {
      validateJEBalance(xf);
      await upsertCache(
        orgId, SOURCE, "journal_entries", xf.id,
        xf as unknown as JsonObject,
        xf.recognitionPeriod
      );
      c.created++; // always treated as created (cache upsert)
    } catch (err) {
      c.failed++;
      c.quarantined++;
      await quarantineRecord(
        orgId, syncLogId, SOURCE, "journal_entries", xf.id,
        xf as unknown as JsonObject,
        String(err instanceof Error ? err.message : err)
      );
    }
  }
  return c;
}

function validateJEBalance(xf: RFJournalEntry): void {
  const totalDebit  = xf.lines.reduce((s, l) => s + l.debit,  0);
  const totalCredit = xf.lines.reduce((s, l) => s + l.credit, 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(
      `JE ${xf.id} is unbalanced: debits ${totalDebit.toFixed(2)} ≠ credits ${totalCredit.toFixed(2)}`
    );
  }
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function zero(): Counts {
  return { processed: 0, created: 0, updated: 0, failed: 0, quarantined: 0 };
}
