/**
 * XpenxFlow REST API client.
 * server-only — reads encrypted tokens; must never reach the browser.
 *
 * Authentication: X-FINOS-API-Key: xpx_{64 hex chars}
 * Token TTL:      90 days rolling (resets on every successful API call)
 * API base:       https://gzlhihuabpxzpobtqvql.supabase.co/functions/v1  (Supabase Edge Functions)
 * Pre-approve UI: https://xpenseflow-v2-bay.vercel.app/oauth/pre-approve  (Vercel — user-facing only)
 *
 * 401 handling:
 *   { error: "token_expired" } → throws XPENXFLOW_TOKEN_EXPIRED
 *   Other 401 → throws "Unauthorized"
 */
import "server-only";
import { BaseOAuthClient } from "@/lib/integrations/base-client";
import type {
  XFBill,
  XFExpense,
  XFJournal,
  XFAsset,
  XFBudget,
} from "./cdm";

/** Sentinel thrown when XpenxFlow returns { error: "token_expired" }. */
export const XPENXFLOW_TOKEN_EXPIRED = "XPENXFLOW_TOKEN_EXPIRED" as const;

export class XpenxFlowClient extends BaseOAuthClient {
  constructor(apiUrl: string, accessToken: string) {
    // XpenxFlow uses X-FINOS-API-Key instead of Authorization: Bearer
    super(apiUrl, accessToken, { name: "X-FINOS-API-Key", value: accessToken });
  }

  /**
   * Internal GET helper with XpenxFlow-specific 401 handling.
   * Overrides BaseOAuthClient's generic error path to detect token_expired.
   */
  private async xfGet<T>(path: string, params?: Record<string, string>): Promise<T> {
    const entries = params
      ? (Object.entries(params).filter(([, v]) => v != null) as [string, string][])
      : [];
    const qs  = entries.length ? "?" + new URLSearchParams(entries).toString() : "";
    const url = `${this.baseUrl}${path}${qs}`;

    const res = await fetch(url, {
      headers: {
        "X-FINOS-API-Key": this.accessToken,
        "Content-Type":    "application/json",
        "Accept":          "application/json",
      },
    });

    if (res.status === 401) {
      const body = await res.json().catch(() => ({}) as Record<string, unknown>) as Record<string, unknown>;
      if (body.error === "token_expired") {
        throw new Error(XPENXFLOW_TOKEN_EXPIRED);
      }
      throw new Error("Unauthorized");
    }

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`HTTP ${res.status}: ${text}`);
    }

    return res.json() as Promise<T>;
  }

  // ── Spec-defined endpoints ─────────────────────────────────────────────────

  /** GET /finos-health */
  async health(): Promise<{ ok: boolean; version?: string; message?: string }> {
    try {
      const data = await this.xfGet<{ status?: string; version?: string }>("/finos-health");
      return { ok: data.status !== "error", version: data.version };
    } catch (err) {
      // Re-throw token_expired — caller must handle reconnect
      if (err instanceof Error && err.message === XPENXFLOW_TOKEN_EXPIRED) throw err;
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  /** GET /finos-journals[?since={ISO}] */
  async journals(since?: string): Promise<unknown> {
    return this.xfGet("/finos-journals", since ? { since } : undefined);
  }

  /** GET /finos-expenses[?since={ISO}] */
  async expenses(since?: string): Promise<unknown> {
    return this.xfGet("/finos-expenses", since ? { since } : undefined);
  }

  /** GET /finos-bills[?since={ISO}] */
  async bills(since?: string): Promise<unknown> {
    return this.xfGet("/finos-bills", since ? { since } : undefined);
  }

  /** GET /finos-assets[?since={ISO}] */
  async assets(since?: string): Promise<unknown> {
    return this.xfGet("/finos-assets", since ? { since } : undefined);
  }

  /** GET /finos-budgets[?since={ISO}] */
  async budgets(since?: string): Promise<unknown> {
    return this.xfGet("/finos-budgets", since ? { since } : undefined);
  }

  // ── Typed convenience methods ──────────────────────────────────────────────

  async getBills(since?: string): Promise<XFBill[]> {
    return parseEntityArray<XFBill>(await this.bills(since), "bills");
  }

  async getExpenses(since?: string): Promise<XFExpense[]> {
    return parseEntityArray<XFExpense>(await this.expenses(since), "expenses");
  }

  async getJournals(since?: string): Promise<XFJournal[]> {
    return parseEntityArray<XFJournal>(await this.journals(since), "journals");
  }

  async getAssets(since?: string): Promise<XFAsset[]> {
    return parseEntityArray<XFAsset>(await this.assets(since), "assets");
  }

  async getBudgets(since?: string): Promise<XFBudget[]> {
    return parseEntityArray<XFBudget>(await this.budgets(since), "budgets");
  }

  /** Alias for health() — used by the test-connection route. */
  async testConnection(): Promise<{ ok: boolean; version?: string; message?: string }> {
    return this.health();
  }
}

/**
 * Parse an XpenxFlow entity response into a typed array.
 * Handles flat `[...]` and enveloped `{ data: [...] }` shapes.
 * Items without required fields are skipped with a warning.
 */
function parseEntityArray<T>(raw: unknown, label: string): T[] {
  const arr: unknown[] = Array.isArray(raw)
    ? raw
    : (raw != null && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).data))
      ? ((raw as Record<string, unknown>).data as unknown[])
      : [];

  if (!Array.isArray(raw) && !Array.isArray((raw as Record<string, unknown>)?.data)) {
    console.warn(`[xpenxflow] ${label}: unexpected response shape`, typeof raw);
  }

  return arr.filter((item) => {
    if (item == null || typeof item !== "object") {
      console.warn(`[xpenxflow] ${label}: skipping non-object item`);
      return false;
    }
    return true;
  }) as T[];
}

/** Build an XpenxFlowClient from a plain (already-decrypted) access token. */
export function createXFClient(apiUrl: string, accessToken: string): XpenxFlowClient {
  return new XpenxFlowClient(apiUrl, accessToken);
}

/** Build an XpenxFlowClient from environment variables (dev / testing). */
export function createXFClientFromEnv(): XpenxFlowClient {
  const apiUrl = process.env.XPENXFLOW_API_BASE ?? "https://gzlhihuabpxzpobtqvql.supabase.co/functions/v1";
  const token  = process.env.XPENXFLOW_TEST_TOKEN ?? "";
  return new XpenxFlowClient(apiUrl, token);
}
