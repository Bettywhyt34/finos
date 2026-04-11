/**
 * POST /api/integrations/discover
 * Hybrid auto-discovery: checks if the logged-in user has an existing account
 * in the requested source product (Revflow / XpenxFlow / EARNMARK360).
 *
 * Body: { source: "revflow" | "xpenxflow" | "earnmark360" }
 *
 * Responses:
 *   { found: false, method: "oauth_manual" }
 *     → No account found or discovery unavailable — fall back to standard OAuth
 *
 *   { found: true, method: "auto_connect", orgName: string, preAuthUrl: string }
 *     → Account found — redirect user to preAuthUrl (product's approval screen)
 *       which will redirect back to our /callback with code + state already set.
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { discoverAccount } from "@/lib/integrations/discovery";
import { OAUTH_CONFIGS, buildCallbackUri } from "@/lib/integrations/oauth-config";
import { createOAuthState } from "@/lib/integrations/oauth-state";
import type { SourceApp } from "@/lib/integrations/oauth-config";

const VALID_SOURCES = new Set<string>(["revflow", "xpenxflow", "earnmark360"]);

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email || !session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  if (!VALID_SOURCES.has(body?.source)) {
    return NextResponse.json({ error: "Invalid source" }, { status: 400 });
  }

  const sourceApp = body.source as SourceApp;
  const orgId     = session.user.tenantId;
  const userId    = session.user.id ?? "system";
  const email     = session.user.email;

  // ── 1. Call product's discovery endpoint ─────────────────────────────────
  const discovered = await discoverAccount(email, sourceApp);

  if (!discovered.found || !discovered.preAuthUrl) {
    return NextResponse.json({ found: false, method: "oauth_manual" });
  }

  // ── 2. Pre-create the connection row so the callback can find it ──────────
  const cfg    = OAUTH_CONFIGS[sourceApp];
  const apiUrl = discovered.apiUrl ?? cfg.defaultApiUrl;

  await prisma.integrationConnection.upsert({
    where:  { tenantId_sourceApp: { tenantId: orgId, sourceApp } },
    create: { tenantId: orgId, sourceApp, apiUrl, syncEnabled: false, status: "CONNECTING" },
    update: { apiUrl, status: "CONNECTING", lastError: null, syncEnabled: false },
  });

  // ── 3. Generate a FINOS OAuth state for the callback to validate ──────────
  const origin      = new URL(req.url).origin;
  const callbackUri = buildCallbackUri(origin, sourceApp);
  const state       = await createOAuthState(orgId, userId, sourceApp);

  // ── 4. Append finosState + finosCallback to the product's pre-auth URL ───
  //  The product's pre-approval page reads these, shows "Connect to FINOS?" screen,
  //  then redirects to callbackUri?code=<code>&state=<state> on approval.
  const preAuthUrl = new URL(discovered.preAuthUrl);
  preAuthUrl.searchParams.set("finosState",    state);
  preAuthUrl.searchParams.set("finosCallback", callbackUri);

  return NextResponse.json({
    found:      true,
    method:     "auto_connect",
    orgName:    discovered.orgName ?? "",
    preAuthUrl: preAuthUrl.toString(),
  });
}
