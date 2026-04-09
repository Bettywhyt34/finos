/**
 * EARNMARK360 REST API client.
 * server-only — reads encrypted tokens; must never reach the browser.
 *
 * Authentication: X-FINOS-API-Key: emk_{64 hex chars}
 * Token TTL:      90 days rolling (resets on every successful API call)
 * API base:       https://earnmark360.com.ng  (EARNMARK360_APP_URL)
 *
 * 401 handling:
 *   { error: "token_expired" } → throws EARNMARK360_TOKEN_EXPIRED
 *   Other 401 → throws "Unauthorized"
 */
import "server-only";
import { BaseOAuthClient } from "@/lib/integrations/base-client";
import type {
  EMKEmployee,
  EMKPayrollRun,
  EMKPayrollLine,
  EMKAttendance,
  EMKDeduction,
} from "./cdm";

/** Sentinel thrown when EARNMARK360 returns { error: "token_expired" }. */
export const EARNMARK360_TOKEN_EXPIRED = "EARNMARK360_TOKEN_EXPIRED" as const;

export class Earnmark360Client extends BaseOAuthClient {
  constructor(apiUrl: string, accessToken: string) {
    // EARNMARK360 uses X-FINOS-API-Key instead of Authorization: Bearer
    super(apiUrl, accessToken, { name: "X-FINOS-API-Key", value: accessToken });
  }

  /**
   * Internal GET helper with EARNMARK360-specific 401 handling.
   */
  private async emkGet<T>(path: string, params?: Record<string, string>): Promise<T> {
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
        throw new Error(EARNMARK360_TOKEN_EXPIRED);
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

  /** GET /api/finos-health */
  async health(): Promise<{ ok: boolean; version?: string; message?: string }> {
    try {
      const data = await this.emkGet<{ status?: string; version?: string }>("/api/finos-health");
      return { ok: data.status !== "error", version: data.version };
    } catch (err) {
      if (err instanceof Error && err.message === EARNMARK360_TOKEN_EXPIRED) throw err;
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  /** GET /api/finos-employees[?since={ISO}] */
  async employees(since?: string): Promise<unknown> {
    return this.emkGet("/api/finos-employees", since ? { since } : undefined);
  }

  /** GET /api/finos-payroll[?since={ISO}] */
  async payroll(since?: string): Promise<unknown> {
    return this.emkGet("/api/finos-payroll", since ? { since } : undefined);
  }

  /** GET /api/finos-payroll-lines[?since={ISO}] */
  async payrollLines(since?: string): Promise<unknown> {
    return this.emkGet("/api/finos-payroll-lines", since ? { since } : undefined);
  }

  /** GET /api/finos-attendance[?since={ISO}][&employee_id={uuid}] */
  async attendance(since?: string, employeeId?: string): Promise<unknown> {
    const params: Record<string, string> = {};
    if (since)      params.since       = since;
    if (employeeId) params.employee_id = employeeId;
    return this.emkGet("/api/finos-attendance", Object.keys(params).length ? params : undefined);
  }

  /** GET /api/finos-deductions[?since={ISO}] */
  async deductions(since?: string): Promise<unknown> {
    return this.emkGet("/api/finos-deductions", since ? { since } : undefined);
  }

  // ── Typed convenience methods ──────────────────────────────────────────────

  async getEmployees(since?: string): Promise<EMKEmployee[]> {
    return parseEntityArray<EMKEmployee>(await this.employees(since), "employees");
  }

  async getPayrollRuns(since?: string): Promise<EMKPayrollRun[]> {
    return parseEntityArray<EMKPayrollRun>(await this.payroll(since), "payroll");
  }

  async getPayrollLines(since?: string): Promise<EMKPayrollLine[]> {
    return parseEntityArray<EMKPayrollLine>(await this.payrollLines(since), "payroll-lines");
  }

  async getAttendance(since?: string, employeeId?: string): Promise<EMKAttendance[]> {
    return parseEntityArray<EMKAttendance>(await this.attendance(since, employeeId), "attendance");
  }

  async getDeductions(since?: string): Promise<EMKDeduction[]> {
    return parseEntityArray<EMKDeduction>(await this.deductions(since), "deductions");
  }

  /** Alias for health() — used by the test-connection route. */
  async testConnection(): Promise<{ ok: boolean; version?: string; message?: string }> {
    return this.health();
  }
}

/**
 * Parse an EARNMARK360 entity response into a typed array.
 * Handles flat `[...]` and enveloped `{ data: [...] }` response shapes.
 */
function parseEntityArray<T>(raw: unknown, label: string): T[] {
  const arr: unknown[] = Array.isArray(raw)
    ? raw
    : (raw != null && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).data))
      ? ((raw as Record<string, unknown>).data as unknown[])
      : [];

  if (!Array.isArray(raw) && !Array.isArray((raw as Record<string, unknown>)?.data)) {
    console.warn(`[earnmark360] ${label}: unexpected response shape`, typeof raw);
  }

  return arr.filter((item) => {
    if (item == null || typeof item !== "object") {
      console.warn(`[earnmark360] ${label}: skipping non-object item`);
      return false;
    }
    return true;
  }) as T[];
}

/** Build an Earnmark360Client from a plain (already-decrypted) access token. */
export function createEMKClient(apiUrl: string, accessToken: string): Earnmark360Client {
  return new Earnmark360Client(apiUrl, accessToken);
}

/** Build an Earnmark360Client from environment variables (dev / testing). */
export function createEMKClientFromEnv(): Earnmark360Client {
  const apiUrl = process.env.EARNMARK360_APP_URL ?? "https://earnmark360.com.ng";
  const token  = process.env.EARNMARK360_TEST_TOKEN ?? "";
  return new Earnmark360Client(apiUrl, token);
}
