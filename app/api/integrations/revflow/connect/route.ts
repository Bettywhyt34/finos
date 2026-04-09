/**
 * POST /api/integrations/revflow/connect
 *
 * Initiates the Revflow pre-approve OAuth flow.
 * Called by the UI when the user clicks "Connect with Revflow" manually
 * (i.e. the auto-discovery path didn't find an account, or the user chose
 * a different account / custom instance URL).
 *
 * Revflow's pre-approve endpoint is NOT standard OAuth — it requires a
 * short-lived token obtained from the discovery endpoint:
 *   /oauth/pre-approve?token={preAuthToken}&finosState={state}&finosCallback={uri}
 *
 * So we re-run discovery here to get the token-bearing preAuthUrl, then
 * append our FINOS state and callback URI.  If discovery returns no account,
 * the user is not in Revflow and cannot connect without signing up there first.
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
    : OAUTH_CONFIGS.revflow.defaultApiUrl;

  // Pre-create the connection row so the callback can find it.
  await prisma.integrationConnection.upsert({
    where:  { organizationId_sourceApp: { organizationId: orgId, sourceApp: "revflow" } },
    create: { organizationId: orgId, sourceApp: "revflow", apiUrl, syncEnabled: false, status: "CONNECTING" },
    update: { apiUrl, status: "CONNECTING", lastError: null, syncEnabled: false },
  });

  // Revflow's pre-approve page requires a short-lived token that only the
  // discovery endpoint can provide — we cannot build the URL from client_id alone.
  const discovered = await discoverAccount(email, "revflow");

  if (!discovered.found || !discovered.preAuthUrl) {
    return NextResponse.json(
      {
        error:
          "No Revflow account was found for your email address. " +
          "Please log into Revflow and ensure your account email matches, " +
          "then try connecting again.",
      },
      { status: 404 }
    );
  }

  const origin      = new URL(req.url).origin;
  const redirectUri = buildCallbackUri(origin, "revflow");
  const state       = await createOAuthState(orgId, userId, "revflow");

  // Use the token-bearing authUrl from discovery; append FINOS state + callback.
  // Do NOT add standard OAuth params (client_id, response_type, etc.) — Revflow's
  // pre-approve page does not accept them and will break if they are present.
  const authUrl = new URL(discovered.preAuthUrl);
  authUrl.searchParams.set("finosState",    state);
  authUrl.searchParams.set("finosCallback", redirectUri);

  return NextResponse.json({ ok: true, authUrl: authUrl.toString() });
}
