/**
 * OAuth 2.0 authorization code → token exchange.
 * Used by all three callback route handlers.
 */
import "server-only";
import { OAUTH_CONFIGS } from "./oauth-config";
import type { SourceApp } from "./oauth-config";

export interface ExchangedTokens {
  accessToken:  string;
  refreshToken: string | null;
  expiresAt:    Date | null;
  scope:        string | null;
  /** Provider-level org/account details, if returned */
  sourceOrgId:  string | null;
  sourceOrgName:string | null;
}

interface RawTokenResponse {
  access_token:  string;
  refresh_token?: string;
  expires_in?:   number;
  token_type?:   string;
  scope?:        string;
  /** Some providers return org info in the token response */
  account_id?:   string;
  account_name?: string;
  org_id?:       string;
  org_name?:     string;
}

export async function exchangeCodeForTokens(
  sourceApp:   SourceApp,
  code:        string,
  redirectUri: string,
): Promise<ExchangedTokens> {
  const cfg  = OAUTH_CONFIGS[sourceApp];
  const body = new URLSearchParams({
    grant_type:   "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id:    cfg.clientId,
    client_secret: cfg.clientSecret,
  });

  const res = await fetch(cfg.tokenUrl, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Token exchange failed [${res.status}]: ${text}`);
  }

  const raw = await res.json() as RawTokenResponse;

  if (!raw.access_token) {
    throw new Error("Token response missing access_token");
  }

  const expiresAt = raw.expires_in
    ? new Date(Date.now() + raw.expires_in * 1000)
    : null;

  return {
    accessToken:   raw.access_token,
    refreshToken:  raw.refresh_token ?? null,
    expiresAt,
    scope:         raw.scope        ?? null,
    sourceOrgId:   raw.org_id   ?? raw.account_id  ?? null,
    sourceOrgName: raw.org_name ?? raw.account_name ?? null,
  };
}
