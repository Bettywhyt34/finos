/**
 * POST /api/integrations/earnmark360/connect
 *
 * Initiates the EARNMARK360 pre-approve OAuth flow.
 * Called when the user clicks "Connect with EARNMARK360" manually.
 *
 * EARNMARK360's pre-approve page requires a short-lived token from discovery:
 *   /oauth/pre-approve?token={jwt}&finosState={state}&finosCallback={uri}
 *
 * We run discovery to get the token-bearing preAuthUrl, then append
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
  if (!session?.user?.organizationId || !session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId  = session.user.organizationId;
  const userId = session.user.id ?? "system";
  const email  = session.user.email;

  const body   = await req.json().catch(() => null);
  const apiUrl = (typeof body?.apiUrl === "string" && body.apiUrl.trim())
    ? body.apiUrl.trim()
    : OAUTH_CONFIGS.earnmark360.defaultApiUrl;

  await prisma.integrationConnection.upsert({
    where:  { organizationId_sourceApp: { organizationId: orgId, sourceApp: "earnmark360" } },
    create: { organizationId: orgId, sourceApp: "earnmark360", apiUrl, syncEnabled: false, status: "CONNECTING" },
    update: { apiUrl, status: "CONNECTING", lastError: null, syncEnabled: false },
  });

  const discovered = await discoverAccount(email, "earnmark360");

  if (!discovered.found || !discovered.preAuthUrl) {
    return NextResponse.json(
      {
        error:
          "No EARNMARK360 account was found for your email address. " +
          "Please log into EARNMARK360 and ensure your account email matches, " +
          "then try connecting again.",
      },
      { status: 404 }
    );
  }

  const origin      = new URL(req.url).origin;
  const redirectUri = buildCallbackUri(origin, "earnmark360");
  const state       = await createOAuthState(orgId, userId, "earnmark360");

  // Use token-bearing authUrl from discovery; append FINOS state + callback only.
  const authUrl = new URL(discovered.preAuthUrl);
  authUrl.searchParams.set("finosState",    state);
  authUrl.searchParams.set("finosCallback", redirectUri);

  return NextResponse.json({ ok: true, authUrl: authUrl.toString() });
}
