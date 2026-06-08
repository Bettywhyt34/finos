/**
 * GET  /api/settings/setup-configurations/currencies
 * POST /api/settings/setup-configurations/currencies
 *
 * GET returns the tenant's base currency from tenant.currency.
 * POST returns 503 — no TenantCurrency join-table exists yet.
 */
import { NextResponse }          from "next/server";
import { auth }                  from "@/lib/auth";
import {
  getCurrencies,
  createCurrency,
} from "@/lib/setup-configurations/service";

function isAdmin(role: string | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const data = await getCurrencies(session.user.tenantId);
  return NextResponse.json({ data, connected: false });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session.user.role)) {
    return NextResponse.json(
      { error: "Forbidden. Only Owners and Admins can add currencies." },
      { status: 403 },
    );
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    await createCurrency(session.user.tenantId, body);
    return NextResponse.json({ data: null }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
