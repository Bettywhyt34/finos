/**
 * POST /api/integrations/bettywhyt/connect
 *
 * Body: { apiKey: string; baseUrl: string }
 *
 * 1. Requires session
 * 2. Tests connection by calling GET {baseUrl}/api/finos/products
 * 3. Encrypts apiKey with AES-256-GCM
 * 4. Upserts IntegrationConnection
 * 5. Enqueues full sync
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/encryption";
import { isBettywhytOrg } from "@/lib/integrations/bettywhyt/guard";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId  = session.user.organizationId;
  const userId = session.user.id ?? "system";

  if (!isBettywhytOrg(orgId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const apiKey  = typeof body?.apiKey  === "string" ? body.apiKey.trim()  : null;
  const baseUrl = typeof body?.baseUrl === "string" ? body.baseUrl.trim() : null;

  if (!apiKey || !baseUrl) {
    return NextResponse.json({ error: "apiKey and baseUrl are required" }, { status: 400 });
  }

  // Test connection
  try {
    const testRes = await fetch(`${baseUrl.replace(/\/$/, "")}/api/finos/products`, {
      headers: { "X-API-Key": apiKey, "Accept": "application/json" },
    });
    if (testRes.status === 401) {
      return NextResponse.json({ error: "Invalid API key — BettyWhyt returned 401" }, { status: 400 });
    }
    if (!testRes.ok) {
      return NextResponse.json(
        { error: `BettyWhyt test request failed: HTTP ${testRes.status}` },
        { status: 400 }
      );
    }
  } catch (err) {
    return NextResponse.json(
      { error: `Could not reach BettyWhyt at ${baseUrl}: ${err instanceof Error ? err.message : err}` },
      { status: 400 }
    );
  }

  // Encrypt and store
  const apiKeyEncrypted = encrypt(apiKey);

  await prisma.integrationConnection.upsert({
    where:  { organizationId_sourceApp: { organizationId: orgId, sourceApp: "bettywhyt" } },
    create: {
      organizationId:   orgId,
      sourceApp:        "bettywhyt",
      apiKeyEncrypted,
      apiUrl:           baseUrl,
      status:           "CONNECTED",
      syncEnabled:      true,
      connectedByUserId: userId,
    },
    update: {
      apiKeyEncrypted,
      apiUrl:   baseUrl,
      status:   "CONNECTED",
      syncEnabled: true,
      lastError:   null,
      connectedByUserId: userId,
    },
  });

  return NextResponse.json({ ok: true });
}
