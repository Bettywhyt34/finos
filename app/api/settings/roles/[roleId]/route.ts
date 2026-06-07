/**
 * GET    /api/settings/roles/[roleId]  — single system role with user counts (OWNER/ADMIN only)
 * PATCH  /api/settings/roles/[roleId]  — 403 (system roles immutable)
 * DELETE /api/settings/roles/[roleId]  — 403 (system roles immutable)
 */
import { NextResponse }                 from "next/server";
import { auth }                         from "@/lib/auth";
import { prisma }                       from "@/lib/prisma";
import { SYSTEM_ROLE_DEFINITIONS }      from "@/lib/roles/service";
import type { UserRole, RoleWithStats } from "@/lib/roles/service";

const VALID_ROLES = new Set<string>(["OWNER", "ADMIN", "ACCOUNTANT", "MEMBER", "VIEWER"]);

function isAdmin(role: string | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ roleId: string }> }
) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session.user.role)) {
    return NextResponse.json({ error: "Forbidden. Only Owners and Admins can view roles." }, { status: 403 });
  }

  const { roleId } = await params;

  if (!VALID_ROLES.has(roleId)) {
    return NextResponse.json({ error: "Role not found." }, { status: 404 });
  }

  const role      = roleId as UserRole;
  const tenantId  = session.user.tenantId;

  const [userCount, inactiveCount] = await Promise.all([
    prisma.tenantMembership.count({ where: { tenantId, role, status: "ACTIVE" } }),
    prisma.tenantMembership.count({ where: { tenantId, role, status: "INACTIVE" } }),
  ]);

  const result: RoleWithStats = {
    id:            role,
    ...SYSTEM_ROLE_DEFINITIONS[role],
    userCount,
    inactiveCount,
    createdAt:     null,
    updatedAt:     null,
  };

  return NextResponse.json(result);
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

export async function PATCH() {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session.user.role)) {
    return NextResponse.json({ error: "Forbidden. Only Owners and Admins can modify roles." }, { status: 403 });
  }
  return NextResponse.json(
    { error: "System roles are managed by FINOS and cannot be modified." },
    { status: 403 }
  );
}

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session.user.role)) {
    return NextResponse.json({ error: "Forbidden. Only Owners and Admins can delete roles." }, { status: 403 });
  }
  return NextResponse.json(
    { error: "System roles are managed by FINOS and cannot be deleted." },
    { status: 403 }
  );
}
