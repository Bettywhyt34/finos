/**
 * GET /api/bettywhyt/health
 *
 * BettyWhyt calls this to verify FINOS_API_KEY and FINOS_BASE_URL are correct.
 * BettyWhyt env: FINOS_BASE_URL + /api/bettywhyt/health
 * Header: X-API-Key: {FINOS_API_KEY}
 */
import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

export async function GET(req: Request) {
  const finosApiKey = process.env.FINOS_API_KEY ?? "";
  if (!finosApiKey) {
    return NextResponse.json({ error: "FINOS_API_KEY not configured" }, { status: 500 });
  }

  const providedKey = req.headers.get("X-API-Key") ?? "";
  let valid = false;
  try {
    valid = timingSafeEqual(
      Buffer.from(providedKey, "utf8"),
      Buffer.from(finosApiKey, "utf8")
    );
  } catch {
    valid = false;
  }

  if (!valid) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  return NextResponse.json({
    ok:      true,
    service: "FINOS",
    version: "5.0",
    webhook: "/api/webhooks/bettywhyt",
  });
}
