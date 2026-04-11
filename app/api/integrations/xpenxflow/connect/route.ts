/**
 * POST /api/integrations/xpenxflow/connect
 *
 * Initiates the XpenxFlow pre-approve OAuth flow.
 * Called when the user clicks "Connect with XpenxFlow" manually.
 *
 * XpenxFlow's pre-approve page (like Revflow) requires a short-lived token
 * obtained from the discovery endpoint — not a standard client_id OAuth flow:
 *   /oauth/pre-approve?token={jwt}&finosState={state}&finosCallback={uri}
 *
 * We re-run discovery here to get the token-bearing preAuthUrl, then append
 * our FINOS state and callback URI.
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createOAuthState } from "@/lib/integrations/oauth-state";
import { buildCallbackUri, OAUTH_CONFIGS } from "@/lib/integrations/oauth-config";
import { discoverAccount } from "@/lib/integrations/discovery";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.tenantId || !session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId  = session.user.tenantId;
  const userId = session.user.id ?? "system";
  const email  = session.user.email;

  const body   = await req.json().catch(() => null);
  const apiUrl = (typeof body?.apiUrl === "string" && body.apiUrl.trim())
    ? body.apiUrl.trim()
    : OAUTH_CONFIGS.xpenxflow.defaultApiUrl;

  await prisma.integrationConnection.upsert({
    where:  { tenantId_sourceApp: { tenantId: orgId, sourceApp: "xpenxflow" } },
    create: { tenantId: orgId, sourceApp: "xpenxflow", apiUrl, syncEnabled: false, status: "CONNECTING" },
    update: { apiUrl, status: "CONNECTING", lastError: null, syncEnabled: false },
  });

  const discovered = await discoverAccount(email, "xpenxflow");

  if (!discovered.found || !discovered.preAuthUrl) {
    return NextResponse.json(
      {
        error:
          "No XpenxFlow account was found for your email address. " +
          "Please log into XpenxFlow and ensure your account email matches, " +
          "then try connecting again.",
      },
      { status: 404 }
    );
  }

  const origin      = new URL(req.url).origin;
  const redirectUri = buildCallbackUri(origin, "xpenxflow");
  const state       = await createOAuthState(orgId, userId, "xpenxflow");

  // Use token-bearing authUrl from discovery; append FINOS state + callback only.
  const authUrl = new URL(discovered.preAuthUrl);
  authUrl.searchParams.set("finosState",    state);
  authUrl.searchParams.set("finosCallback", redirectUri);

  return NextResponse.json({ ok: true, authUrl: authUrl.toString() });
}
