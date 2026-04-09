import "server-only";

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // ms base, doubles each retry

export interface PagedResponse<T> {
  data:    T[];
  total:   number;
  page:    number;
  limit:   number;
  hasMore: boolean;
}

export interface FetchPageOptions {
  since?: string;
  page:   number;
  limit:  number;
}

/** Override the default `Authorization: Bearer <token>` auth header. */
export interface AuthHeader {
  /** Header name, e.g. "X-FINOS-API-Key" */
  name:  string;
  /** Full header value, e.g. the token string itself */
  value: string;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Base HTTP client for authenticated API integrations.
 * Defaults to `Authorization: Bearer <token>` but accepts a custom auth header
 * for products that use a different scheme (e.g. Revflow's X-FINOS-API-Key).
 */
export class BaseOAuthClient {
  protected readonly baseUrl:     string;
  protected readonly accessToken: string;
  private   readonly authHeader:  AuthHeader;

  constructor(baseUrl: string, accessToken: string, authHeader?: AuthHeader) {
    this.baseUrl     = baseUrl.replace(/\/$/, "");
    this.accessToken = accessToken;
    this.authHeader  = authHeader ?? {
      name:  "Authorization",
      value: `Bearer ${accessToken}`,
    };
  }

  protected async request<T>(
    path:    string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      [this.authHeader.name]: this.authHeader.value,
      "Content-Type":         "application/json",
      "Accept":               "application/json",
      ...(options.headers as Record<string, string> ?? {}),
    };

    let lastError: Error = new Error("Unknown error");

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const res = await fetch(url, { ...options, headers });

      // 4xx — fail immediately (client error, no retry)
      if (res.status >= 400 && res.status < 500) {
        const body = await res.text().catch(() => res.statusText);
        throw new Error(`HTTP ${res.status}: ${body}`);
      }

      // 2xx — success
      if (res.ok) {
        return res.json() as Promise<T>;
      }

      // 5xx — retry with exponential backoff
      lastError = new Error(`HTTP ${res.status} from ${url}`);
      if (attempt < MAX_RETRIES - 1) {
        await sleep(RETRY_DELAY * 2 ** attempt);
      }
    }

    throw lastError;
  }

  /** GET a paginated resource with standard query params. */
  async fetchPage<T>(
    path:    string,
    options: FetchPageOptions,
  ): Promise<PagedResponse<T>> {
    const params = new URLSearchParams({
      page:  String(options.page),
      limit: String(options.limit),
    });
    if (options.since) params.set("since", options.since);

    return this.request<PagedResponse<T>>(`${path}?${params.toString()}`);
  }

  /** Iterate all pages of a resource, yielding each page's data array. */
  async *iteratePages<T>(
    path:  string,
    since?: string,
    limit  = 100,
  ): AsyncGenerator<T[]> {
    let page    = 1;
    let hasMore = true;

    while (hasMore) {
      const result = await this.fetchPage<T>(path, { since, page, limit });
      if (result.data.length > 0) yield result.data;
      hasMore = result.hasMore;
      page++;
    }
  }
}
