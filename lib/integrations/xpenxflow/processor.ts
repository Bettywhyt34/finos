/**
 * XpenxFlow sync processor.
 * server-only — uses Prisma, OAuth tokens, and journal posting.
 *
 * Sync order (dependency-safe):
 *   1. Bills      → upsert Vendor (resolved from cache) + Bill + BillLines
 *   2. Expenses   → upsert Expense (category resolved from cache)
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
import {
  createXFClient,
  XPENXFLOW_TOKEN_EXPIRED,
  type XpenxFlowClient,
} from "./client";
import {
  parseCursor,
  stringifyCursor,
  type XFBill,
  type XFExpense,
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
  const { organizationId, connectionId, syncLogId, cursor } = payload;

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
    add(await syncBills(xf, organizationId, syncLogId, since));
    add(await syncExpenses(xf, organizationId, syncLogId, since));
    add(await syncJournals(xf, organizationId, syncLogId, since));
    add(await syncAssets(xf, organizationId, syncLogId, since));
    add(await syncBudgets(xf, organizationId, syncLogId, since));
  } catch (err) {
    if (err instanceof Error && err.message === XPENXFLOW_TOKEN_EXPIRED) {
      // Mark connection expired so UI prompts reconnect
      await markTokenExpired(connectionId);
      throw new Error("XpenxFlow token expired — please reconnect the integration");
    }
    throw err;
  }

  // Rolling TTL: mirror XpenxFlow's server-side reset so we don't trigger
  // premature refresh attempts before the next sync.
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

  // Bulk-resolve FINOS account IDs for all line account_codes
  const allCodes   = Array.from(new Set(data.flatMap((b) => b.lines.map((l) => l.account_code))));
  const accountMap = await resolveAccountMappings(orgId, SOURCE, allCodes);

  for (const raw of data) {
    c.processed++;
    try {
      (await upsertBill(orgId, raw, accountMap)) === "created" ? c.created++ : c.updated++;
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

async function upsertBill(
  orgId:      string,
  xf:         XFBill,
  accountMap: Map<string, string>,
): Promise<"created" | "updated"> {
  const vendorId = await resolveXFVendorId(orgId, xf.vendor_id);
  if (!vendorId) {
    throw new Error(`Vendor "${xf.vendor_id}" not in FINOS. Sync vendors before bills.`);
  }

  const statusMap: Record<string, "DRAFT" | "RECORDED" | "PARTIAL" | "PAID" | "OVERDUE"> = {
    draft:     "DRAFT",
    approved:  "RECORDED",
    partial:   "PARTIAL",
    paid:      "PAID",
    overdue:   "OVERDUE",
    cancelled: "DRAFT",
  };

  const billData = {
    vendorId,
    billDate:     new Date(xf.bill_date),
    dueDate:      new Date(xf.due_date),
    currency:     xf.currency,
    exchangeRate: xf.exchange_rate,
    subtotal:     xf.subtotal,
    taxAmount:    xf.tax_amount,
    totalAmount:  xf.total_amount,
    status:       statusMap[xf.status] ?? "DRAFT",
    notes:        xf.notes              ?? undefined,
    vendorRef:    xf.purchase_order_number ?? undefined,
  };

  const existing = await prisma.bill.findFirst({
    where:  { organizationId: orgId, billNumber: xf.bill_number, vendorId },
    select: { id: true },
  });

  if (existing) {
    await prisma.$transaction([
      prisma.bill.update({ where: { id: existing.id }, data: billData }),
      prisma.billLine.deleteMany({ where: { billId: existing.id } }),
      ...makeBillLineCreates(existing.id, xf, accountMap),
    ]);
    return "updated";
  }

  await prisma.$transaction(async (tx) => {
    const bill = await tx.bill.create({
      data: { ...billData, organizationId: orgId, billNumber: xf.bill_number, amountPaid: 0 },
    });
    for (const lineData of makeBillLineData(bill.id, xf, accountMap)) {
      await tx.billLine.create({ data: lineData });
    }
  });
  return "created";
}

function makeBillLineData(billId: string, xf: XFBill, accountMap: Map<string, string>) {
  return xf.lines.map((line) => {
    const accountId = accountMap.get(line.account_code);
    if (!accountId) {
      throw new Error(
        `No account mapping for code "${line.account_code}". Add it in Integration Settings > Account Mapping.`
      );
    }
    return {
      billId,
      accountId,
      description: line.description,
      quantity:    line.quantity,
      rate:        line.unit_price,
      amount:      line.net_amount,
    };
  });
}

function makeBillLineCreates(billId: string, xf: XFBill, accountMap: Map<string, string>) {
  return makeBillLineData(billId, xf, accountMap).map((data) => prisma.billLine.create({ data }));
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
      (await upsertExpense(orgId, raw)) === "created" ? c.created++ : c.updated++;
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

async function upsertExpense(orgId: string, xf: XFExpense): Promise<"created" | "updated"> {
  const catCache = await prisma.unifiedTransactionsCache.findFirst({
    where: {
      organizationId: orgId,
      sourceApp:      SOURCE,
      sourceTable:    "expense_categories",
      sourceId:       xf.category_id,
    },
    select: { dataJson: true },
  });

  let categoryId: string | undefined;
  if (catCache?.dataJson) {
    const catName  = (catCache.dataJson as unknown as { name: string }).name;
    const finosCat = await prisma.expenseCategory.findFirst({
      where:  { organizationId: orgId, name: catName },
      select: { id: true },
    });
    categoryId = finosCat?.id;
  }

  if (!categoryId) {
    throw new Error(
      `Expense category "${xf.category_id}" not in FINOS. Sync categories before expenses.`
    );
  }

  const statusMap: Record<string, "DRAFT" | "PENDING" | "APPROVED" | "REJECTED" | "REIMBURSED"> = {
    draft:      "DRAFT",
    submitted:  "PENDING",
    approved:   "APPROVED",
    rejected:   "REJECTED",
    reimbursed: "REIMBURSED",
    cancelled:  "DRAFT",
  };

  const desc        = `${xf.expense_number} — ${xf.description} (${xf.employee_name})`;
  const expenseData = {
    categoryId,
    expenseDate: new Date(xf.expense_date),
    description: desc,
    amount:      xf.amount,
    taxAmount:   xf.tax_amount,
    totalAmount: xf.total_amount,
    status:      statusMap[xf.status] ?? "DRAFT",
    receiptUrl:  xf.receipt_url  ?? undefined,
    approvedBy:  xf.approved_by  ?? undefined,
    approvedAt:  xf.approved_at  ? new Date(xf.approved_at)  : undefined,
  };

  const existing = await prisma.expense.findFirst({
    where:  { organizationId: orgId, description: { startsWith: `${xf.expense_number} —` } },
    select: { id: true },
  });

  if (existing) {
    await prisma.expense.update({ where: { id: existing.id }, data: expenseData });
    return "updated";
  }

  await prisma.expense.create({ data: { ...expenseData, organizationId: orgId } });
  return "created";
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Resolves an XpenxFlow vendor UUID → FINOS vendor.id via the unified cache. */
async function resolveXFVendorId(orgId: string, xfVendorId: string): Promise<string | null> {
  const cached = await prisma.unifiedTransactionsCache.findFirst({
    where:  { organizationId: orgId, sourceApp: SOURCE, sourceTable: "vendors", sourceId: xfVendorId },
    select: { dataJson: true },
  });
  if (!cached?.dataJson) return null;

  const vendorCode = (cached.dataJson as unknown as { vendor_code: string }).vendor_code;
  const vendor     = await prisma.vendor.findUnique({
    where:  { organizationId_vendorCode: { organizationId: orgId, vendorCode } },
    select: { id: true },
  });
  return vendor?.id ?? null;
}

function zero(): Counts {
  return { processed: 0, created: 0, updated: 0, failed: 0, quarantined: 0 };
}
