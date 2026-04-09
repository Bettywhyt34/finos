/**
 * BettyWhyt API client — API key auth (X-API-Key header).
 * Does NOT extend BaseOAuthClient since BettyWhyt is internally owned
 * and uses a static API key, not OAuth 2.0 Bearer tokens.
 *
 * server-only
 */
import "server-only";
import type { BWPProduct, BWPOrder, BWPStockUpdate } from "./cdm";

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

/** Sentinel thrown by the client when BettyWhyt returns 401 */
export const BETTYWHYT_API_KEY_INVALID = "BETTYWHYT_API_KEY_INVALID";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export class BettyWhytClient {
  private readonly baseUrl: string;
  private readonly apiKey:  string;

  constructor(apiUrl: string, apiKey: string) {
    this.baseUrl = apiUrl.replace(/\/$/, "");
    this.apiKey  = apiKey;
  }

  private async bwpRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
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

      if (res.status === 401) {
        throw new Error(BETTYWHYT_API_KEY_INVALID);
      }

      if (res.status >= 400 && res.status < 500) {
        const body = await res.text().catch(() => res.statusText);
        throw new Error(`HTTP ${res.status}: ${body}`);
      }

      if (res.ok) {
        return res.json() as Promise<T>;
      }

      // 5xx — retry
      lastError = new Error(`HTTP ${res.status} from ${url}`);
      if (attempt < MAX_RETRIES - 1) {
        await sleep(RETRY_DELAY * 2 ** attempt);
      }
    }

    throw lastError;
  }

  protected async bwpGet<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = params
      ? `${path}?${new URLSearchParams(params).toString()}`
      : path;
    return this.bwpRequest<T>(url, { method: "GET" });
  }

  protected async bwpPost<T>(path: string, body: unknown): Promise<T> {
    return this.bwpRequest<T>(path, {
      method: "POST",
      body:   JSON.stringify(body),
    });
  }

  /** GET /api/finos/products?since=<ISO> */
  async getProducts(since?: string): Promise<BWPProduct[]> {
    const params: Record<string, string> = {};
    if (since) params.since = since;
    const result = await this.bwpGet<{ data: BWPProduct[] }>("/api/finos/products", params);
    return result.data ?? [];
  }

  /** GET /api/finos/orders?since=<ISO> */
  async getOrders(since?: string): Promise<BWPOrder[]> {
    const params: Record<string, string> = {};
    if (since) params.since = since;
    const result = await this.bwpGet<{ data: BWPOrder[] }>("/api/finos/orders", params);
    return result.data ?? [];
  }

  /** POST /api/finos/stock — push inventory change to BettyWhyt */
  async postStockUpdate(update: BWPStockUpdate): Promise<void> {
    await this.bwpPost<void>("/api/finos/stock", update);
  }
}

/** Factory using env variables (dev / CI). */
export function createBWPClientFromEnv(): BettyWhytClient {
  const apiKey  = process.env.BETTYWHYT_API_KEY;
  const baseUrl = process.env.BETTYWHYT_BASE_URL;
  if (!apiKey || !baseUrl) {
    throw new Error(
      "BETTYWHYT_API_KEY and BETTYWHYT_BASE_URL must be set to use BettyWhyt integration"
    );
  }
  return new BettyWhytClient(baseUrl, apiKey);
}
