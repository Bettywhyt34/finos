/**
 * GET  /api/settings/roles  — list all 5 system roles with real user counts (OWNER/ADMIN only)
 * POST /api/settings/roles  — stub (custom roles not yet supported → 501)
 */
import { NextResponse }                 from "next/server";
import { auth }                         from "@/lib/auth";
import { prisma }                       from "@/lib/prisma";
import { SYSTEM_ROLE_DEFINITIONS }      from "@/lib/roles/service";
import type { UserRole, RoleWithStats } from "@/lib/roles/service";

const ROLE_ORDER: UserRole[] = ["OWNER", "ADMIN", "ACCOUNTANT", "MEMBER", "VIEWER"];

function isAdmin(role: string | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session.user.role)) {
    return NextResponse.json({ error: "Forbidden. Only Owners and Admins can view roles." }, { status: 403 });
  }

  const tenantId = session.user.tenantId;

  // Fetch active and inactive user counts for each role in parallel
  const [activeCounts, inactiveCounts] = await Promise.all([
    Promise.all(
      ROLE_ORDER.map((role) =>
        prisma.tenantMembership.count({ where: { tenantId, role, status: "ACTIVE" } })
      )
    ),
    Promise.all(
      ROLE_ORDER.map((role) =>
        prisma.tenantMembership.count({ where: { tenantId, role, status: "INACTIVE" } })
      )
    ),
  ]);

  const roles: RoleWithStats[] = ROLE_ORDER.map((role, i) => ({
    id:            role,
    ...SYSTEM_ROLE_DEFINITIONS[role],
    userCount:     activeCounts[i],
    inactiveCount: inactiveCounts[i],
    createdAt:     null,
    updatedAt:     null,
  }));

  return NextResponse.json(roles);
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST() {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session.user.role)) {
    return NextResponse.json({ error: "Forbidden. Only Owners and Admins can create roles." }, { status: 403 });
  }
  return NextResponse.json(
    { error: "Custom roles are not supported yet." },
    { status: 501 }
  );
}
