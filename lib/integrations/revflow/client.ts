/**
 * Revflow REST API client.
 * server-only — reads encrypted tokens; must never reach the browser.
 *
 * Authentication: X-FINOS-API-Key: rfx_{64 hex chars}
 * Token TTL:      90 days (expires_in: 7776000)
 * API base:       https://revflowapp.com/api/finos  (REVFLOW_API_BASE)
 *
 * Spec entity types for ?entity= param:
 *   campaigns | documents | clients | payments | journal_entries | chart_of_accounts
 *   "documents" is Revflow's name for what FINOS calls "invoices".
 */
import "server-only";
import { z } from "zod";
import { BaseOAuthClient } from "@/lib/integrations/base-client";
import {
  RFCampaignSchema,
  RFInvoiceSchema,
  RFPaymentSchema,
  RFJournalEntrySchema,
  type RFCampaign,
  type RFInvoice,
  type RFPayment,
  type RFJournalEntry,
} from "./types";

/** Revflow entity type identifiers (as defined in the Revflow API spec). */
export const RF_ENTITY = {
  CAMPAIGNS:       "campaigns",
  /** Revflow calls invoices "documents" */
  DOCUMENTS:       "documents",
  CLIENTS:         "clients",
  PAYMENTS:        "payments",
  JOURNAL_ENTRIES: "journal_entries",
  CHART_OF_ACCTS:  "chart_of_accounts",
} as const;

export class RevflowClient extends BaseOAuthClient {
  constructor(apiUrl: string, accessToken: string) {
    // Revflow uses X-FINOS-API-Key instead of Authorization: Bearer
    super(apiUrl, accessToken, { name: "X-FINOS-API-Key", value: accessToken });
  }

  // ── Spec-defined endpoints ─────────────────────────────────────────────────

  /**
   * GET /sync[?since={ISO}][&entity={type}]
   * Returns all entity types or filtered by entity. Raw JSON — use typed helpers below.
   */
  async sync(params?: { since?: string; entity?: string }): Promise<unknown> {
    const entries = Object.entries(params ?? {}).filter(([, v]) => v != null) as [string, string][];
    const qs = entries.length ? "?" + new URLSearchParams(entries).toString() : "";
    return this.request<unknown>(`/sync${qs}`);
  }

  /** GET /sync/status */
  async status(): Promise<{ ok: boolean; version?: string; message?: string }> {
    try {
      const data = await this.request<{ status: string; version?: string }>("/sync/status");
      return { ok: data.status === "ok", version: data.version };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  /** GET /sync/journal-entries[?since={ISO}] */
  async journalEntriesRaw(since?: string): Promise<unknown> {
    const qs = since ? `?since=${encodeURIComponent(since)}` : "";
    return this.request<unknown>(`/sync/journal-entries${qs}`);
  }

  /** GET /sync/chart-of-accounts */
  async chartOfAccounts(): Promise<unknown> {
    return this.request<unknown>("/sync/chart-of-accounts");
  }

  // ── Typed convenience methods ──────────────────────────────────────────────

  async getCampaigns(since?: string): Promise<RFCampaign[]> {
    const raw = await this.sync({ entity: RF_ENTITY.CAMPAIGNS, ...(since ? { since } : {}) });
    return parseEntityArray(raw, RFCampaignSchema, "campaigns");
  }

  /** Revflow entity name: "documents" (= invoices in FINOS) */
  async getInvoices(since?: string): Promise<RFInvoice[]> {
    const raw = await this.sync({ entity: RF_ENTITY.DOCUMENTS, ...(since ? { since } : {}) });
    return parseEntityArray(raw, RFInvoiceSchema, "documents");
  }

  async getPayments(since?: string): Promise<RFPayment[]> {
    const raw = await this.sync({ entity: RF_ENTITY.PAYMENTS, ...(since ? { since } : {}) });
    return parseEntityArray(raw, RFPaymentSchema, "payments");
  }

  async getJournalEntries(since?: string): Promise<RFJournalEntry[]> {
    const raw = await this.journalEntriesRaw(since);
    return parseEntityArray(raw, RFJournalEntrySchema, "journal_entries");
  }

  /** Alias for status() — used by the test-connection route. */
  async testConnection(): Promise<{ ok: boolean; version?: string; message?: string }> {
    return this.status();
  }
}

/**
 * Parse a Revflow entity response into a typed array.
 * Handles both flat array `[...]` and enveloped `{ data: [...] }` shapes.
 * Items that fail Zod validation are skipped with a warning (not thrown).
 */
function parseEntityArray<T>(
  raw:    unknown,
  schema: z.ZodType<T>,
  label:  string,
): T[] {
  const arr: unknown[] = Array.isArray(raw)
    ? raw
    : (raw != null && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).data))
      ? ((raw as Record<string, unknown>).data as unknown[])
      : [];

  const results: T[] = [];
  for (const item of arr) {
    const parse = schema.safeParse(item);
    if (parse.success) {
      results.push(parse.data);
    } else {
      console.warn(`[revflow] ${label} item parse error:`, parse.error.message);
    }
  }
  return results;
}

/** Build a RevflowClient from a plain (already-decrypted) access token. */
export function createRevflowClient(apiUrl: string, accessToken: string): RevflowClient {
  return new RevflowClient(apiUrl, accessToken);
}

/** Build a RevflowClient from environment variables (dev / testing). */
export function createRevflowClientFromEnv(): RevflowClient {
  const apiUrl = process.env.REVFLOW_API_BASE ?? "https://revflowapp.com/api/finos";
  const token  = process.env.REVFLOW_TEST_TOKEN ?? "";
  return new RevflowClient(apiUrl, token);
}
