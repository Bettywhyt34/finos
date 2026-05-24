/**
 * POST /api/integrations/finos_pos/connect
 * Body: { apiKey: string; baseUrl: string }
 *
 * 1. Tests connection via GET {baseUrl}/api/finos/products
 * 2. Encrypts apiKey
 * 3. Upserts IntegrationConnection
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/encryption";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = session.user.tenantId;
  const userId   = session.user.id ?? "system";

  const body    = await req.json().catch(() => null);
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
      return NextResponse.json(
        { error: "Invalid API key — FINOS POS returned 401" },
        { status: 400 }
      );
    }
    if (!testRes.ok) {
      return NextResponse.json(
        { error: `FINOS POS test request failed: HTTP ${testRes.status}` },
        { status: 400 }
      );
    }
  } catch (err) {
    return NextResponse.json(
      { error: `Could not reach FINOS POS at ${baseUrl}: ${err instanceof Error ? err.message : err}` },
      { status: 400 }
    );
  }

  const apiKeyEncrypted = encrypt(apiKey);

  await prisma.integrationConnection.upsert({
    where:  { tenantId_sourceApp: { tenantId, sourceApp: "finos_pos" } },
    create: {
      tenantId,
      sourceApp:         "finos_pos",
      apiKeyEncrypted,
      apiUrl:            baseUrl,
      status:            "CONNECTED",
      syncEnabled:       true,
      connectedByUserId: userId,
    },
    update: {
      apiKeyEncrypted,
      apiUrl:    baseUrl,
      status:    "CONNECTED",
      syncEnabled: true,
      lastError:   null,
      connectedByUserId: userId,
    },
  });

  return NextResponse.json({ ok: true });
}
