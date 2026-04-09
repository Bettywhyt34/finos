/**
 * POST /api/webhooks/bettywhyt
 * Receives real-time events from BettyWhyt.
 *
 * Security (two-layer):
 *   1. X-API-Key header must match FINOS_API_KEY env var
 *   2. X-BettyWhyt-Signature: sha256=<hex> (HMAC-SHA256 over raw body with BETTYWHYT_WEBHOOK_SECRET)
 *
 * BettyWhyt env vars:
 *   FINOS_BASE_URL         = this FINOS deployment URL
 *   FINOS_API_KEY          = value of FINOS env FINOS_API_KEY
 *   FINOS_WEBHOOK_SECRET   = value of FINOS env BETTYWHYT_WEBHOOK_SECRET (shared secret)
 */
import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { handleBettywhytWebhook } from "@/lib/integrations/bettywhyt/webhook-handler";

export async function POST(req: Request) {
  // 1. API key check (fast rejection before reading body)
  const finosApiKey = process.env.FINOS_API_KEY ?? "";
  if (finosApiKey) {
    const providedKey = req.headers.get("X-API-Key") ?? "";
    let keyValid = false;
    try {
      keyValid = timingSafeEqual(
        Buffer.from(providedKey, "utf8"),
        Buffer.from(finosApiKey, "utf8")
      );
    } catch {
      keyValid = false;
    }
    if (!keyValid) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
    }
  }

  // 2. Read raw body for signature verification (must come before .json())
  const rawBody = await req.text();

  // 3. Validate HMAC-SHA256 signature
  const sigHeader = req.headers.get("X-BettyWhyt-Signature") ?? "";
  const secret    = process.env.BETTYWHYT_WEBHOOK_SECRET ?? "";

  if (!secret) {
    console.error("[bettywhyt-webhook] BETTYWHYT_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;

  let signatureValid = false;
  try {
    signatureValid = timingSafeEqual(
      Buffer.from(sigHeader, "utf8"),
      Buffer.from(expected, "utf8")
    );
  } catch {
    signatureValid = false;
  }

  if (!signatureValid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // 3. Parse body
  let body: { orgId?: string; event?: string; payload?: unknown };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { orgId, event, payload } = body;
  if (!orgId || !event) {
    return NextResponse.json({ error: "Missing orgId or event" }, { status: 400 });
  }

  // 4. Return 200 immediately — process asynchronously
  void handleBettywhytWebhook(event, payload, orgId).catch((err) => {
    console.error(`[bettywhyt-webhook] Error processing event "${event}" for org ${orgId}:`, err);
  });

  return NextResponse.json({ ok: true });
}
