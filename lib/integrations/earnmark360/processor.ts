/**
 * EARNMARK360 sync processor.
 * server-only — uses Prisma, OAuth tokens, and journal posting.
 *
 * Currency:
 *   EARNMARK360 returns all monetary amounts in Kobo.
 *   The processor divides by 100 before caching or posting GL (converts to Naira).
 *
 * Sync order (dependency-safe):
 *   1. Employees     → cache (reference data for all other entities)
 *   2. Payroll Runs  → cache converted to Naira (reference data for payroll lines)
 *   3. Payroll Lines → cache converted to Naira + auto-post GL
 *   4. Attendance    → cache (no monetary fields)
 *   5. Deductions    → cache converted to Naira
 *
 * Token behaviour:
 *   - Token TTL is rolling: EARNMARK360 resets it on every successful call.
 *   - After a full sync, FINOS mirrors this by resetting tokenExpiresAt = now + 90d.
 *   - On 401 token_expired: connection is marked TOKEN_EXPIRED and the sync aborts.
 *
 * Payroll GL account codes (FINOS standard):
 *   OE-002  Salary / Wages Expense
 *   OE-003  Employer Pension Contribution Expense
 *   CA-003  Bank / Cash (net salaries paid)
 *   CL-010  PAYE Payable
 *   CL-011  Pension Employee Payable
 *   CL-012  Pension Employer Payable
 *   CL-013  NHF Payable
 *   CL-014  NSITF Payable
 */
import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SyncJobPayload } from "@/lib/integrations/bullmq-queue";
import { quarantineRecord, upsertCache } from "@/lib/integrations/sync-engine";
import { getValidAccessToken, markTokenExpired } from "@/lib/integrations/oauth-refresh";
import { postJournalEntry } from "@/lib/journal";
import { buildCallbackUri } from "@/lib/integrations/oauth-config";
import {
  createEMKClient,
  EARNMARK360_TOKEN_EXPIRED,
  type Earnmark360Client,
} from "./client";
import {
  parseCursor,
  stringifyCursor,
  type EMKEmployee,
  type EMKPayrollRun,
  type EMKPayrollLine,
  type EMKAttendance,
  type EMKDeduction,
} from "./cdm";

type JsonObject = Prisma.InputJsonObject;

const SOURCE           = "earnmark360" as const;
const ROLLING_TTL_DAYS = 90;

// FINOS account codes for payroll journal entries
const AC = {
  SALARY_EXP:    "OE-002",  // Salary / Wages Expense
  PENSION_EXP:   "OE-003",  // Employer Pension Contribution Expense
  BANK:          "CA-003",  // Bank (net salaries paid out)
  PAYE_PAY:      "CL-010",  // PAYE Payable
  PENSION_EE:    "CL-011",  // Employee Pension Payable
  PENSION_ER:    "CL-012",  // Employer Pension Payable
  NHF_PAY:       "CL-013",  // NHF Payable
  NSITF_PAY:     "CL-014",  // NSITF Payable
} as const;

/** Convert Kobo → Naira. EARNMARK360 API returns all monetary amounts in Kobo. */
const koboToNaira = (kobo: number) => kobo / 100;

/** Return a Naira-converted copy of a payroll run. */
function toNairaPayrollRun(r: EMKPayrollRun): EMKPayrollRun {
  return { ...r, total_gross: koboToNaira(r.total_gross), total_net: koboToNaira(r.total_net) };
}

/** Return a Naira-converted copy of a payroll line. */
function toNairaPayrollLine(l: EMKPayrollLine): EMKPayrollLine {
  return {
    ...l,
    gross_pay:   koboToNaira(l.gross_pay),
    paye:        koboToNaira(l.paye),
    pension_ee:  koboToNaira(l.pension_ee),
    pension_er:  koboToNaira(l.pension_er),
    nhf:         koboToNaira(l.nhf),
    nsitf:       koboToNaira(l.nsitf),
    net_pay:     koboToNaira(l.net_pay),
  };
}

/** Return a Naira-converted copy of a deduction. */
function toNairaDeduction(d: EMKDeduction): EMKDeduction {
  return { ...d, amount: koboToNaira(d.amount) };
}

type Counts = {
  processed:   number;
  created:     number;
  updated:     number;
  failed:      number;
  quarantined: number;
};

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function processEarnmark360(payload: SyncJobPayload): Promise<
  Counts & { nextCursor?: string }
> {
  const { organizationId, connectionId, syncLogId, cursor } = payload;

  const connection = await prisma.integrationConnection.findUniqueOrThrow({
    where:  { id: connectionId },
    select: { apiUrl: true },
  });

  if (!connection.apiUrl) {
    throw new Error("EARNMARK360 connection missing apiUrl");
  }

  const appUrl      = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const redirectUri = buildCallbackUri(appUrl, SOURCE);

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(connectionId, redirectUri);
  } catch (err) {
    throw new Error(`EARNMARK360 token unavailable: ${err instanceof Error ? err.message : err}`);
  }

  const emk         = createEMKClient(connection.apiUrl, accessToken);
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
    // Employees must come before payroll lines, attendance, and deductions
    add(await syncEmployees(emk, organizationId, syncLogId, since));
    add(await syncPayrollRuns(emk, organizationId, syncLogId, since));
    add(await syncPayrollLines(emk, organizationId, syncLogId, since));
    add(await syncAttendance(emk, organizationId, syncLogId, since));
    add(await syncDeductions(emk, organizationId, syncLogId, since));
  } catch (err) {
    if (err instanceof Error && err.message === EARNMARK360_TOKEN_EXPIRED) {
      await markTokenExpired(connectionId);
      throw new Error("EARNMARK360 token expired — please reconnect the integration");
    }
    throw err;
  }

  // Rolling TTL: mirror EARNMARK360's server-side reset
  await prisma.integrationConnection.update({
    where: { id: connectionId },
    data:  { tokenExpiresAt: new Date(Date.now() + ROLLING_TTL_DAYS * 24 * 60 * 60 * 1000) },
  });

  return { ...totals, nextCursor: stringifyCursor({ since: newCursorTs }) };
}

// ─── Employees ────────────────────────────────────────────────────────────────

async function syncEmployees(
  emk:       Earnmark360Client,
  orgId:     string,
  syncLogId: string,
  since:     string,
): Promise<Counts> {
  const c    = zero();
  const data = await emk.getEmployees(since);

  for (const raw of data) {
    c.processed++;
    try {
      await upsertCache(orgId, SOURCE, "employees", raw.id, raw as unknown as JsonObject);
      c.created++;
    } catch (err) {
      c.failed++;
      c.quarantined++;
      await quarantineRecord(
        orgId, syncLogId, SOURCE, "employees", raw.id,
        raw as unknown as JsonObject,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return c;
}

// ─── Payroll Runs ─────────────────────────────────────────────────────────────

async function syncPayrollRuns(
  emk:       Earnmark360Client,
  orgId:     string,
  syncLogId: string,
  since:     string,
): Promise<Counts> {
  const c    = zero();
  const data = await emk.getPayrollRuns(since);

  for (const raw of data) {
    c.processed++;
    const naira = toNairaPayrollRun(raw); // convert Kobo → Naira before caching
    try {
      await upsertCache(orgId, SOURCE, "payroll_runs", naira.id, naira as unknown as JsonObject);
      c.created++;
    } catch (err) {
      c.failed++;
      c.quarantined++;
      await quarantineRecord(
        orgId, syncLogId, SOURCE, "payroll_runs", raw.id,
        raw as unknown as JsonObject,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return c;
}

// ─── Payroll Lines + GL auto-post ─────────────────────────────────────────────

async function syncPayrollLines(
  emk:       Earnmark360Client,
  orgId:     string,
  syncLogId: string,
  since:     string,
): Promise<Counts> {
  const c    = zero();
  const data = await emk.getPayrollLines(since);

  for (const raw of data) {
    c.processed++;
    const naira = toNairaPayrollLine(raw); // convert Kobo → Naira before caching/GL posting
    try {
      // Only post GL for new payroll lines (not yet in cache)
      const existing = await prisma.unifiedTransactionsCache.findFirst({
        where: { organizationId: orgId, sourceApp: SOURCE, sourceTable: "payroll_lines", sourceId: naira.id },
        select: { id: true },
      });

      await upsertCache(orgId, SOURCE, "payroll_lines", naira.id, naira as unknown as JsonObject);

      if (!existing) {
        await postPayrollLineGL(orgId, naira);
      }

      c.created++;
    } catch (err) {
      c.failed++;
      c.quarantined++;
      await quarantineRecord(
        orgId, syncLogId, SOURCE, "payroll_lines", raw.id,
        raw as unknown as JsonObject,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return c;
}

async function postPayrollLineGL(orgId: string, line: EMKPayrollLine): Promise<void> {
  // Resolve payroll run for recognition period
  const runCache = await prisma.unifiedTransactionsCache.findFirst({
    where: { organizationId: orgId, sourceApp: SOURCE, sourceTable: "payroll_runs", sourceId: line.payroll_run_id },
    select: { dataJson: true },
  });

  const run = runCache?.dataJson as unknown as EMKPayrollRun | undefined;
  if (!run) {
    // Can't post GL without the payroll run context — quarantine silently
    throw new Error(`Payroll run "${line.payroll_run_id}" not in cache. Sync runs before lines.`);
  }

  // Derive recognition period from period_end (YYYY-MM)
  const recognitionPeriod = run.period_end?.slice(0, 7) ?? new Date().toISOString().slice(0, 7);

  // Only post for processed runs
  if (run.status !== "processed") return;

  const gross       = line.gross_pay;
  const pensionExp  = line.pension_er;    // Employer contribution — expense
  const netPay      = line.net_pay;
  const paye        = line.paye;
  const pensionEE   = line.pension_ee;   // Employee contribution — liability
  const pensionER   = line.pension_er;   // Employer contribution — liability
  const nhf         = line.nhf;
  const nsitf       = line.nsitf;

  const totalDebits  = gross + pensionExp;
  const totalCredits = netPay + paye + pensionEE + pensionER + nhf + nsitf;

  // Guard against rounding drift — skip if unbalanced by more than 1 unit
  if (Math.abs(totalDebits - totalCredits) > 1) {
    throw new Error(
      `PayrollLine ${line.id} GL imbalance: debits ${totalDebits.toFixed(2)} ≠ credits ${totalCredits.toFixed(2)}`
    );
  }

  await postJournalEntry({
    organizationId:    orgId,
    createdBy:         "earnmark360-sync",
    entryDate:         new Date(run.run_date),
    reference:         line.payroll_run_id,
    description:       `Payroll — ${recognitionPeriod}`,
    recognitionPeriod,
    source:            SOURCE,
    sourceId:          line.id,
    lines: [
      // Debits
      { accountCode: AC.SALARY_EXP,  debit: gross,      credit: 0,        description: "Gross salary" },
      { accountCode: AC.PENSION_EXP, debit: pensionExp,  credit: 0,        description: "Employer pension" },
      // Credits
      { accountCode: AC.BANK,        debit: 0,           credit: netPay,   description: "Net pay to employee" },
      { accountCode: AC.PAYE_PAY,    debit: 0,           credit: paye,     description: "PAYE payable" },
      { accountCode: AC.PENSION_EE,  debit: 0,           credit: pensionEE, description: "Pension (employee)" },
      { accountCode: AC.PENSION_ER,  debit: 0,           credit: pensionER, description: "Pension (employer)" },
      { accountCode: AC.NHF_PAY,     debit: 0,           credit: nhf,      description: "NHF payable" },
      { accountCode: AC.NSITF_PAY,   debit: 0,           credit: nsitf,    description: "NSITF payable" },
    ].filter((l) => l.debit > 0 || l.credit > 0),
  });
}

// ─── Attendance ───────────────────────────────────────────────────────────────

async function syncAttendance(
  emk:       Earnmark360Client,
  orgId:     string,
  syncLogId: string,
  since:     string,
): Promise<Counts> {
  const c    = zero();
  const data = await emk.getAttendance(since);

  for (const raw of data) {
    c.processed++;
    try {
      await upsertCache(orgId, SOURCE, "attendance", raw.id, raw as unknown as JsonObject);
      c.created++;
    } catch (err) {
      c.failed++;
      c.quarantined++;
      await quarantineRecord(
        orgId, syncLogId, SOURCE, "attendance", raw.id,
        raw as unknown as JsonObject,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return c;
}

// ─── Deductions ───────────────────────────────────────────────────────────────

async function syncDeductions(
  emk:       Earnmark360Client,
  orgId:     string,
  syncLogId: string,
  since:     string,
): Promise<Counts> {
  const c    = zero();
  const data = await emk.getDeductions(since);

  for (const raw of data) {
    c.processed++;
    const naira = toNairaDeduction(raw); // convert Kobo → Naira before caching
    try {
      await upsertCache(orgId, SOURCE, "deductions", naira.id, naira as unknown as JsonObject);
      c.created++;
    } catch (err) {
      c.failed++;
      c.quarantined++;
      await quarantineRecord(
        orgId, syncLogId, SOURCE, "deductions", raw.id,
        raw as unknown as JsonObject,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return c;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function zero(): Counts {
  return { processed: 0, created: 0, updated: 0, failed: 0, quarantined: 0 };
}
