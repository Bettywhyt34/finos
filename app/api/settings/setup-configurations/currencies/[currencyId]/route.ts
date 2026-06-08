/**
 * PATCH  /api/settings/setup-configurations/currencies/[currencyId]
 * DELETE /api/settings/setup-configurations/currencies/[currencyId]
 *
 * Both return 503 — no TenantCurrency join-table exists yet.
 */
import { NextResponse }          from "next/server";
import { auth }                  from "@/lib/auth";
import {
  updateCurrency,
  disableCurrency,
} from "@/lib/setup-configurations/service";

type Params = { params: Promise<{ currencyId: string }> };

function isAdmin(role: string | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export async function PATCH(request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session.user.role)) {
    return NextResponse.json(
      { error: "Forbidden. Only Owners and Admins can update currencies." },
      { status: 403 },
    );
  }

  try {
    const { currencyId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    await updateCurrency(session.user.tenantId, currencyId, body);
    return NextResponse.json({ data: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session.user.role)) {
    return NextResponse.json(
      { error: "Forbidden. Only Owners and Admins can disable currencies." },
      { status: 403 },
    );
  }

  try {
    const { currencyId } = await params;
    await disableCurrency(session.user.tenantId, currencyId);
    return NextResponse.json({ data: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
