// @ts-nocheck — reference implementation for other products; not compiled as part of FINOS
/**
 * ============================================================
 * PRODUCT-SIDE: Discovery Endpoint
 * ============================================================
 * Copy this file to: app/api/discover/route.ts
 * in each of your other SaaS products (Revflow, XpenxFlow, EARNMARK360).
 *
 * This endpoint receives an email from FINOS, verifies the HMAC signature,
 * looks up the user in your product's DB, and returns a pre-auth URL
 * that will show the user a simple "Connect to FINOS?" approval screen.
 *
 * Required env vars in each product:
 *   PRODUCT_DISCOVERY_SECRET=<same secret as FINOS>
 *   NEXT_PUBLIC_APP_URL=https://your-product.com
 * ============================================================
 */
import { NextResponse } from "next/server";
import { createHmac, randomBytes } from "crypto";
// ↓ Replace with your product's Prisma import
import { prisma } from "@/lib/prisma";

// ── Signature verification ────────────────────────────────────────────────────

function verifySignature(body: string, header: string | null): boolean {
  const secret = process.env.PRODUCT_DISCOVERY_SECRET;
  if (!secret || !header) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  if (expected.length !== header.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ header.charCodeAt(i);
  }
  return mismatch === 0;
}

// ── Pre-auth token (single-use, 10-min TTL) ───────────────────────────────────
//
// Store these in a small in-memory Map for simplicity, or add a `pre_auth_tokens`
// table to your DB for persistence across instances.
//
const PRE_AUTH_TOKENS = new Map<string, { userId: string; orgId: string; orgName: string; expiresAt: number }>();

function createPreAuthToken(userId: string, orgId: string, orgName: string): string {
  const token     = randomBytes(32).toString("hex");
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
  PRE_AUTH_TOKENS.set(token, { userId, orgId, orgName, expiresAt });
  return token;
}

export function consumePreAuthToken(token: string) {
  const data = PRE_AUTH_TOKENS.get(token);
  if (!data)                        return null;
  if (data.expiresAt < Date.now())  { PRE_AUTH_TOKENS.delete(token); return null; }
  PRE_AUTH_TOKENS.delete(token);    // Single-use
  return data;
}

// ── Discovery handler ─────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const rawBody = await req.text();
  const sig     = req.headers.get("x-discovery-signature");

  if (!verifySignature(rawBody, sig)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: { email?: string; requestingApp?: string; timestamp?: string };
  try { body = JSON.parse(rawBody); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { email, requestingApp } = body;
  if (!email || requestingApp !== "finos") {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  // ── Look up user by email in YOUR product's DB ───────────────────────────
  // Adapt this query to your schema:
  const user = await prisma.user.findUnique({
    where:   { email },
    include: {
      // Adapt to your membership/org model:
      organizationMemberships: {
        take:    1,
        include: { organization: true },
      },
    },
  });

  if (!user || user.organizationMemberships.length === 0) {
    return NextResponse.json(null, { status: 404 });
  }

  const membership = user.organizationMemberships[0];
  const org        = membership.organization;

  // ── Generate a pre-auth token ────────────────────────────────────────────
  const token      = createPreAuthToken(user.id, org.id, org.name);
  const appUrl     = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";
  const preAuthUrl = `${appUrl}/oauth/pre-approve?token=${token}`;

  return NextResponse.json({
    orgId:      org.id,
    orgName:    org.name,
    preAuthUrl,
    // Optionally return your API URL if it differs from the default:
    // apiUrl: `${appUrl}/api`,
  });
}
