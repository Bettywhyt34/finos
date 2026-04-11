/**
 * GET /api/integrations/revflow/callback
 * OAuth 2.0 callback: exchanges authorization code for tokens, stores encrypted tokens,
 * updates the connection to CONNECTED, and starts an initial full sync.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { consumeOAuthState } from "@/lib/integrations/oauth-state";
import { buildCallbackUri } from "@/lib/integrations/oauth-config";
import { exchangeCodeForTokens } from "@/lib/integrations/oauth-exchange";
import { storeTokens } from "@/lib/integrations/oauth-refresh";
import { startSync } from "@/lib/integrations/sync-engine";

export async function GET(req: Request) {
  const url   = new URL(req.url);
  const code  = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(`/integrations/revflow/connect?error=${encodeURIComponent(error)}`, url.origin)
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL("/integrations/revflow/connect?error=missing_params", url.origin));
  }

  try {
    const { tenantId, userId } = await consumeOAuthState(state, "revflow");

    const connection = await prisma.integrationConnection.findUniqueOrThrow({
      where:  { tenantId_sourceApp: { tenantId, sourceApp: "revflow" } },
      select: { id: true },
    });

    const redirectUri = buildCallbackUri(url.origin, "revflow");
    const tokens      = await exchangeCodeForTokens("revflow", code, redirectUri);

    await storeTokens(connection.id, tokens);

    // Save optional org metadata if returned by Revflow
    if (tokens.sourceOrgId || tokens.sourceOrgName || tokens.scope) {
      await prisma.integrationConnection.update({
        where: { id: connection.id },
        data: {
          sourceOrgId:      tokens.sourceOrgId    ?? undefined,
          sourceOrgName:    tokens.sourceOrgName  ?? undefined,
          scope:            tokens.scope          ?? undefined,
          connectedByUserId: userId,
          syncEnabled:      true,
        },
      });
    } else {
      await prisma.integrationConnection.update({
        where: { id: connection.id },
        data:  { syncEnabled: true, connectedByUserId: userId },
      });
    }

    // Kick off initial full sync
    await startSync(tenantId, "revflow", "full", userId);

    return NextResponse.redirect(new URL("/integrations/revflow/status", url.origin));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "OAuth callback failed";
    return NextResponse.redirect(
      new URL(`/integrations/revflow/connect?error=${encodeURIComponent(msg)}`, url.origin)
    );
  }
}
