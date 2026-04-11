/**
 * BettyWhyt outbound webhook sender.
 * Sends FINOS events to BettyWhyt (e.g., POS sales, stock receipts).
 *
 * Signs the body with HMAC-SHA256 using BETTYWHYT_WEBHOOK_SECRET:
 *   X-FINOS-Signature: sha256=<hex>
 *
 * Fire-and-forget — logs errors but never throws, so FINOS flows are never blocked.
 *
 * server-only
 */
import "server-only";
import { createHmac } from "crypto";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";

export async function sendToBettywhyt(
  orgId:   string,
  event:   string,
  payload: unknown
): Promise<void> {
  try {
    const connection = await prisma.integrationConnection.findUnique({
      where:  { tenantId_sourceApp: { tenantId: orgId, sourceApp: "bettywhyt" } },
      select: { status: true, apiKeyEncrypted: true, apiUrl: true },
    });

    if (!connection || connection.status === "DISCONNECTED" || !connection.apiUrl) {
      return; // silently skip — no active BettyWhyt connection
    }

    const apiUrl = connection.apiUrl;
    const body   = JSON.stringify({ orgId, event, payload });

    // Sign with HMAC-SHA256
    const secret    = process.env.BETTYWHYT_WEBHOOK_SECRET ?? "";
    const signature = createHmac("sha256", secret).update(body).digest("hex");

    const headers: Record<string, string> = {
      "Content-Type":       "application/json",
      "X-FINOS-Signature":  `sha256=${signature}`,
    };

    // Optionally include API key for extra auth
    if (connection.apiKeyEncrypted) {
      try {
        headers["X-API-Key"] = decrypt(connection.apiKeyEncrypted);
      } catch {
        // ignore decrypt failures — signature is the primary security
      }
    }

    const res = await fetch(`${apiUrl.replace(/\/$/, "")}/api/webhooks/finos`, {
      method:  "POST",
      headers,
      body,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      console.error(`[bettywhyt-sender] Webhook delivery failed for event "${event}": HTTP ${res.status} — ${text}`);
    }
  } catch (err) {
    // Never throw — FINOS flow must not be blocked by webhook delivery
    console.error(`[bettywhyt-sender] Failed to send "${event}" webhook:`, err);
  }
}
