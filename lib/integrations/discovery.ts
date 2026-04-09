/**
 * Inter-product account discovery.
 *
 * FINOS calls each product's /api/discover endpoint with the user's email.
 * The request is HMAC-SHA256 signed so each product can verify it came from FINOS.
 *
 * Shared secret: PRODUCT_DISCOVERY_SECRET env var (must be set identically in all products).
 * Signature header: X-Discovery-Signature: sha256=<hmac>
 *
 * If the product finds an account for that email, it returns:
 *   { orgId, orgName, preAuthUrl }
 * The preAuthUrl is a short-lived, single-use URL at the product that shows a simple
 * "Approve access to FINOS?" screen and then redirects to our callback with an OAuth code.
 *
 * On any failure (timeout, 4xx, 5xx, missing secret) we return found=false so the
 * caller falls back to the standard manual OAuth flow gracefully.
 */
import "server-only";
import { createHmac } from "crypto";
import { OAUTH_CONFIGS } from "./oauth-config";
import type { SourceApp } from "./oauth-config";

const DISCOVERY_TIMEOUT_MS = 5_000;

export interface DiscoveredAccount {
  found:       boolean;
  orgId?:      string;
  orgName?:    string;
  /** The product's pre-approval page URL (before we append finosState + finosCallback) */
  preAuthUrl?: string;
  /** If the product returns its own API base URL (enterprise instances) */
  apiUrl?:     string;
}

/** Sign a request body with the shared discovery secret */
function signDiscovery(body: string): string {
  const secret = process.env.PRODUCT_DISCOVERY_SECRET;
  if (!secret) return "";
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Call the source product's discovery endpoint and check if the given email
 * has an existing account there.
 *
 * Always resolves (never throws) — returns { found: false } on any error.
 */
export async function discoverAccount(
  email:     string,
  sourceApp: SourceApp,
): Promise<DiscoveredAccount> {
  const cfg = OAUTH_CONFIGS[sourceApp];

  if (!process.env.PRODUCT_DISCOVERY_SECRET) {
    return { found: false };
  }

  const bodyObj = {
    email,
    requestingApp: "finos",
    timestamp:     new Date().toISOString(),
  };
  const body = JSON.stringify(bodyObj);
  const sig  = signDiscovery(body);

  try {
    const res = await fetch(cfg.discoveryUrl, {
      method:  "POST",
      headers: {
        "Content-Type":         "application/json",
        "X-Discovery-Signature": sig,
      },
      body,
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });

    if (!res.ok) return { found: false };

    const data = await res.json() as {
      orgId?:      string;
      orgName?:    string;
      preAuthUrl?: string;
      apiUrl?:     string;
    };

    if (!data.preAuthUrl) return { found: false };

    return {
      found:      true,
      orgId:      data.orgId,
      orgName:    data.orgName,
      preAuthUrl: data.preAuthUrl,
      apiUrl:     data.apiUrl,
    };
  } catch {
    return { found: false };
  }
}

/**
 * Verify that an incoming discovery request was signed by FINOS.
 * Call this in each product's /api/discover handler.
 *
 * @param body    Raw request body string (before JSON.parse)
 * @param header  Value of the X-Discovery-Signature header
 */
export function verifyDiscoverySignature(body: string, header: string | null): boolean {
  const secret = process.env.PRODUCT_DISCOVERY_SECRET;
  if (!secret || !header) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  if (expected.length !== header.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ header.charCodeAt(i);
  }
  return mismatch === 0;
}
