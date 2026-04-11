/**
 * GET /api/integrations/earnmark360/callback
 * OAuth 2.0 callback: exchange code → tokens, store encrypted, start full sync.
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
      new URL(`/integrations/earnmark360/connect?error=${encodeURIComponent(error)}`, url.origin)
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL("/integrations/earnmark360/connect?error=missing_params", url.origin));
  }

  try {
    const { tenantId, userId } = await consumeOAuthState(state, "earnmark360");

    const connection = await prisma.integrationConnection.findUniqueOrThrow({
      where:  { tenantId_sourceApp: { tenantId, sourceApp: "earnmark360" } },
      select: { id: true },
    });

    const redirectUri = buildCallbackUri(url.origin, "earnmark360");
    const tokens      = await exchangeCodeForTokens("earnmark360", code, redirectUri);

    await storeTokens(connection.id, tokens);

    await prisma.integrationConnection.update({
      where: { id: connection.id },
      data: {
        sourceOrgId:       tokens.sourceOrgId   ?? undefined,
        sourceOrgName:     tokens.sourceOrgName ?? undefined,
        scope:             tokens.scope         ?? undefined,
        connectedByUserId: userId,
        syncEnabled:       true,
      },
    });

    await startSync(tenantId, "earnmark360", "full", userId);

    return NextResponse.redirect(new URL("/integrations/earnmark360/status", url.origin));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "OAuth callback failed";
    return NextResponse.redirect(
      new URL(`/integrations/earnmark360/connect?error=${encodeURIComponent(msg)}`, url.origin)
    );
  }
}
