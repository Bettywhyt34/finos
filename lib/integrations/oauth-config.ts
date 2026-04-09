import "server-only";

export type SourceApp = "revflow" | "xpenxflow" | "earnmark360" | "bettywhyt";

export interface OAuthConfig {
  clientId:         string;
  clientSecret:     string;
  authorizationUrl: string;
  tokenUrl:         string;
  scopes:           string[];
  callbackPath:     string;
  /** Default REST API base URL used when no custom instance URL is provided */
  defaultApiUrl:    string;
  /** Product's discovery endpoint — FINOS POSTs here with user email to check for existing account */
  discoveryUrl:     string;
  /**
   * Fallback token TTL in days when the token response omits `expires_in`.
   * Revflow issues 90-day tokens; standard OAuth servers typically return expires_in.
   */
  tokenTtlDays:     number;
  /**
   * If true, `redirect_uri` is NOT sent in token refresh requests.
   * Revflow's refresh endpoint does not accept redirect_uri.
   */
  refreshWithoutRedirectUri?: boolean;
}

export const OAUTH_CONFIGS: Record<SourceApp, OAuthConfig> = {
  /**
   * BettyWhyt uses API key auth, not OAuth.
   * Stub values satisfy the OAuthConfig type; the real connection
   * is stored via apiKeyEncrypted in IntegrationConnection.
   */
  bettywhyt: {
    clientId:         "",
    clientSecret:     "",
    authorizationUrl: "",
    tokenUrl:         "",
    scopes:           [],
    callbackPath:     "/api/integrations/bettywhyt/connect",
    defaultApiUrl:    process.env.BETTYWHYT_BASE_URL ?? "https://bettywhyt.com",
    discoveryUrl:     "",
    tokenTtlDays:     0,
  },
  revflow: {
    clientId:                 process.env.REVFLOW_OAUTH_CLIENT_ID!,
    clientSecret:             process.env.REVFLOW_OAUTH_CLIENT_SECRET!,
    authorizationUrl:         "https://revflowapp.com/oauth/pre-approve",
    tokenUrl:                 "https://revflowapp.com/api/oauth/token",
    scopes:                   ["read:all"],
    callbackPath:             "/api/integrations/revflow/callback",
    defaultApiUrl:            "https://revflowapp.com/api/finos",
    discoveryUrl:             "https://revflowapp.com/api/discover",
    tokenTtlDays:             90,
    refreshWithoutRedirectUri: true,
  },
  xpenxflow: {
    clientId:         process.env.XPENXFLOW_OAUTH_CLIENT_ID!,
    clientSecret:     process.env.XPENXFLOW_OAUTH_CLIENT_SECRET!,
    authorizationUrl: "https://xpenseflow-v2-bay.vercel.app/oauth/pre-approve",  // UI page — stays on Vercel
    tokenUrl:         "https://gzlhihuabpxzpobtqvql.supabase.co/functions/v1/oauth-token",
    scopes:           ["read:all"],
    callbackPath:     "/api/integrations/xpenxflow/callback",
    defaultApiUrl:    "https://gzlhihuabpxzpobtqvql.supabase.co/functions/v1",
    discoveryUrl:     "https://gzlhihuabpxzpobtqvql.supabase.co/functions/v1/discover",
    tokenTtlDays:     90,
  },
  earnmark360: {
    clientId:         process.env.EARNMARK360_OAUTH_CLIENT_ID!,
    clientSecret:     process.env.EARNMARK360_OAUTH_CLIENT_SECRET!,
    authorizationUrl: "https://earnmark360.com.ng/oauth/pre-approve",
    tokenUrl:         "https://earnmark360.com.ng/api/oauth-token",
    scopes:           ["read:all"],
    callbackPath:     "/api/integrations/earnmark360/callback",
    defaultApiUrl:    "https://earnmark360.com.ng",
    discoveryUrl:     "https://earnmark360.com.ng/api/discover",
    tokenTtlDays:     90,
  },
};

/** Build the full redirect URI from the request origin + callbackPath */
export function buildCallbackUri(origin: string, sourceApp: SourceApp): string {
  return `${origin}${OAUTH_CONFIGS[sourceApp].callbackPath}`;
}

/** Build the authorization URL with all required query params */
export function buildAuthorizationUrl(
  sourceApp:   SourceApp,
  state:       string,
  redirectUri: string,
): string {
  const cfg = OAUTH_CONFIGS[sourceApp];
  const params = new URLSearchParams({
    response_type: "code",
    client_id:     cfg.clientId,
    redirect_uri:  redirectUri,
    scope:         cfg.scopes.join(" "),
    state,
  });
  return `${cfg.authorizationUrl}?${params.toString()}`;
}
