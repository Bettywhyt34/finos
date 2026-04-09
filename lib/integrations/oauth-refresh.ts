import "server-only";
import { prisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/lib/encryption";
import { OAUTH_CONFIGS } from "./oauth-config";
import type { SourceApp } from "./oauth-config";

/** Buffer: refresh 5 minutes before actual expiry to avoid race conditions. */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

interface TokenSet {
  accessToken:  string;
  refreshToken: string | null;
  expiresAt:    Date | null;
}

interface TokenResponse {
  access_token:  string;
  refresh_token?: string;
  expires_in?:   number;
  token_type?:   string;
}

async function exchangeRefreshToken(
  sourceApp:    SourceApp,
  refreshToken: string,
  redirectUri:  string,
): Promise<TokenResponse> {
  const cfg  = OAUTH_CONFIGS[sourceApp];
  const body = new URLSearchParams({
    grant_type:    "refresh_token",
    refresh_token: refreshToken,
    client_id:     cfg.clientId,
    client_secret: cfg.clientSecret,
  });

  // Some products (e.g. Revflow) do not accept redirect_uri in the refresh request
  if (!cfg.refreshWithoutRedirectUri && redirectUri) {
    body.set("redirect_uri", redirectUri);
  }

  const res = await fetch(cfg.tokenUrl, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Token refresh failed [${res.status}]: ${text}`);
  }

  return res.json() as Promise<TokenResponse>;
}

/**
 * Returns a valid (non-expired) access token for the given connection.
 * Automatically refreshes if within the REFRESH_BUFFER_MS window.
 * Throws if no refresh token exists and the access token is expired.
 */
export async function getValidAccessToken(
  connectionId: string,
  redirectUri:  string,
): Promise<string> {
  const conn = await prisma.integrationConnection.findUniqueOrThrow({
    where:  { id: connectionId },
    select: {
      sourceApp:             true,
      accessTokenEncrypted:  true,
      refreshTokenEncrypted: true,
      tokenExpiresAt:        true,
    },
  });

  if (!conn.accessTokenEncrypted) {
    throw new Error("No access token stored — re-authorise the integration");
  }

  const needsRefresh =
    conn.tokenExpiresAt &&
    conn.tokenExpiresAt.getTime() - Date.now() < REFRESH_BUFFER_MS;

  if (!needsRefresh) {
    return decrypt(conn.accessTokenEncrypted);
  }

  if (!conn.refreshTokenEncrypted) {
    throw new Error("Access token expired and no refresh token available — re-authorise");
  }

  const sourceApp    = conn.sourceApp as SourceApp;
  const cfg          = OAUTH_CONFIGS[sourceApp];
  const refreshToken = decrypt(conn.refreshTokenEncrypted);
  const tokens       = await exchangeRefreshToken(sourceApp, refreshToken, redirectUri);

  // Use expires_in if provided; fall back to the product's configured TTL
  const newExpiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000)
    : new Date(Date.now() + cfg.tokenTtlDays * 24 * 60 * 60 * 1000);

  await prisma.integrationConnection.update({
    where: { id: connectionId },
    data: {
      accessTokenEncrypted:  encrypt(tokens.access_token),
      refreshTokenEncrypted: tokens.refresh_token
        ? encrypt(tokens.refresh_token)
        : conn.refreshTokenEncrypted,
      tokenExpiresAt: newExpiresAt,
      status:         "CONNECTED",
    },
  });

  return tokens.access_token;
}

/**
 * Store a freshly-exchanged token set on the connection record.
 * Called from the OAuth callback handler after code → token exchange.
 */
export async function storeTokens(
  connectionId: string,
  tokens:       TokenSet,
): Promise<void> {
  await prisma.integrationConnection.update({
    where: { id: connectionId },
    data: {
      accessTokenEncrypted:  encrypt(tokens.accessToken),
      refreshTokenEncrypted: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
      tokenExpiresAt:        tokens.expiresAt,
      status:                "CONNECTED",
    },
  });
}

/** Mark the connection as TOKEN_EXPIRED so the UI prompts re-auth. */
export async function markTokenExpired(connectionId: string): Promise<void> {
  await prisma.integrationConnection.update({
    where: { id: connectionId },
    data:  { status: "TOKEN_EXPIRED" },
  });
}
