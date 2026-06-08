/**
 * GET  /api/settings/setup-configurations/general
 * PATCH /api/settings/setup-configurations/general
 *
 * No general_preferences model in DB — GET returns { data: null, connected: false }.
 * PATCH returns 503 until backend is wired up.
 */
import { NextResponse }              from "next/server";
import { auth }                      from "@/lib/auth";
import {
  getGeneralPreferences,
  updateGeneralPreferences,
} from "@/lib/setup-configurations/service";

function isAdmin(role: string | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const prefs = await getGeneralPreferences(session.user.tenantId);
  return NextResponse.json({ data: prefs, connected: false });
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session.user.role)) {
    return NextResponse.json(
      { error: "Forbidden. Only Owners and Admins can update general preferences." },
      { status: 403 },
    );
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    await updateGeneralPreferences(session.user.tenantId, body);
    return NextResponse.json({ data: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
