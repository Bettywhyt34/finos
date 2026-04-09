/**
 * POST /api/integrations/revflow/test
 * Tests connectivity to a Revflow endpoint without saving credentials.
 * Body: { apiUrl: string; apiKey: string }
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { RevflowClient } from "@/lib/integrations/revflow/client";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const apiUrl = typeof body?.apiUrl === "string" ? body.apiUrl.trim() : "";
  const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";

  if (!apiUrl || !apiKey) {
    return NextResponse.json(
      { ok: false, message: "apiUrl and apiKey are required" },
      { status: 400 }
    );
  }

  // Use the raw (unencrypted) key just for this test — it is never persisted here
  const client = new RevflowClient(apiUrl, apiKey);
  const result = await client.testConnection();

  return NextResponse.json(result);
}
