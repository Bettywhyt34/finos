/**
 * POST /api/settings/roles/[roleId]/duplicate  — stub (custom roles not yet supported → 501)
 */
import { NextResponse } from "next/server";
import { auth }         from "@/lib/auth";

function isAdmin(role: string | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export async function POST() {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session.user.role)) {
    return NextResponse.json({ error: "Forbidden. Only Owners and Admins can duplicate roles." }, { status: 403 });
  }
  return NextResponse.json(
    { error: "Custom roles are not supported yet." },
    { status: 501 }
  );
}
