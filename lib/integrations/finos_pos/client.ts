/**
 * FINOS POS API client — API key auth (X-API-Key header).
 * Does NOT extend BaseOAuthClient since FINOS POS is internally owned
 * and uses a static API key, not OAuth 2.0 Bearer tokens.
 *
 * server-only
 */
import "server-only";
import type { POSProduct, POSSale } from "./cdm";

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

/** Sentinel thrown by the client when POS returns 401 */
export const FINOS_POS_API_KEY_INVALID = "FINOS_POS_API_KEY_INVALID";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export class FinosPosClient {
  private readonly baseUrl: string;
  private readonly apiKey:  string;

  constructor(apiUrl: string, apiKey: string) {
    this.baseUrl = apiUrl.replace(/\/$/, "");
    this.apiKey  = apiKey;
  }

  private async posRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "X-API-Key":    this.apiKey,
      "Content-Type": "application/json",
      "Accept":       "application/json",
      ...(options.headers as Record<string, string> ?? {}),
    };

    let lastError: Error = new Error("Unknown error");

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const res = await fetch(url, { ...options, headers });

      if (res.status === 401) throw new Error(FINOS_POS_API_KEY_INVALID);

      if (res.status >= 400 && res.status < 500) {
        const body = await res.text().catch(() => res.statusText);
        throw new Error(`HTTP ${res.status}: ${body}`);
      }

      if (res.ok) return res.json() as Promise<T>;

      lastError = new Error(`HTTP ${res.status} from ${url}`);
      if (attempt < MAX_RETRIES - 1) await sleep(RETRY_DELAY * 2 ** attempt);
    }

    throw lastError;
  }

  private async posGet<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = params
      ? `${path}?${new URLSearchParams(params).toString()}`
      : path;
    return this.posRequest<T>(url, { method: "GET" });
  }

  /** GET /api/finos/products?since=<ISO> */
  async getProducts(since?: string): Promise<POSProduct[]> {
    const params: Record<string, string> = {};
    if (since) params.since = since;
    const result = await this.posGet<{ data: POSProduct[] }>("/api/finos/products", params);
    return result.data ?? [];
  }

  /** GET /api/finos/sales?since=<ISO> */
  async getSales(since?: string): Promise<POSSale[]> {
    const params: Record<string, string> = {};
    if (since) params.since = since;
    const result = await this.posGet<{ data: POSSale[] }>("/api/finos/sales", params);
    return result.data ?? [];
  }
}
