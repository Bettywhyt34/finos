/**
 * PATCH  /api/settings/users/[membershipId]  — update role and/or status
 * DELETE /api/settings/users/[membershipId]  — soft-deactivate (set status INACTIVE)
 *
 * Guards:
 *  - Caller must be OWNER or ADMIN with ACTIVE status
 *  - Cannot modify the tenant OWNER's role or status
 *  - Cannot leave the tenant with zero active administrators
 *  - A user cannot deactivate/remove themselves if they are the last active admin
 */
import { NextResponse } from "next/server";
import { z }            from "zod";
import { auth }         from "@/lib/auth";
import { prisma }       from "@/lib/prisma";

const patchSchema = z.object({
  role:   z.enum(["ADMIN", "ACCOUNTANT", "MEMBER", "VIEWER"]).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
}).refine((d) => d.role !== undefined || d.status !== undefined, {
  message: "Provide at least one of: role, status",
});

// ── Count active admins (OWNER or ADMIN with ACTIVE status) ──────────────────

async function activeAdminCount(tenantId: string): Promise<number> {
  return prisma.tenantMembership.count({
    where: {
      tenantId,
      status: "ACTIVE",
      role:   { in: ["OWNER", "ADMIN"] },
    },
  });
}

// ── Load & authorise the calling user ────────────────────────────────────────

async function getAuthorisedMembership(
  membershipId: string,
  tenantId: string,
  callerId: string,
) {
  const target = await prisma.tenantMembership.findFirst({
    where: { id: membershipId, tenantId },
  });
  if (!target) return { authError: "Member not found" as const, authStatus: 404 as const, target: null };

  const caller = await prisma.tenantMembership.findUnique({
    where:  { tenantId_userId: { tenantId, userId: callerId } },
    select: { role: true, status: true },
  });
  if (!caller || caller.status !== "ACTIVE" || (caller.role !== "OWNER" && caller.role !== "ADMIN")) {
    return { authError: "Only admins can manage users." as const, authStatus: 403 as const, target: null };
  }

  return { authError: null, authStatus: 200 as const, target };
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

export async function PATCH(
  req: Request,
  context: { params: Promise<{ membershipId: string }> },
) {
  const { membershipId } = await context.params;
  const session = await auth();
  if (!session?.user?.tenantId || !session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { tenantId, id: callerId } = session.user as { tenantId: string; id: string };

  const { authError, authStatus, target } = await getAuthorisedMembership(
    membershipId, tenantId, callerId,
  );
  if (authError || !target) {
    return NextResponse.json({ error: authError }, { status: authStatus });
  }

  // OWNER role is immutable
  if (target.role === "OWNER") {
    return NextResponse.json({ error: "Cannot change the Owner's role or status." }, { status: 403 });
  }

  const body   = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { role: newRole, status: newStatus } = parsed.data;

  // After the OWNER guard, target.role is "ADMIN" | "ACCOUNTANT" | "MEMBER" | "VIEWER"
  // Guard: prevent leaving zero active admins
  // Scenario A: deactivating an ADMIN
  // Scenario B: demoting an ADMIN to a non-admin role
  const currentRoleIsAdmin = target.role === "ADMIN";
  const deactivatingAdmin  = newStatus === "INACTIVE" && currentRoleIsAdmin;
  const demotingAdmin      = newRole !== undefined && newRole !== "ADMIN" && currentRoleIsAdmin;

  if (deactivatingAdmin || demotingAdmin) {
    const adminCount = await activeAdminCount(tenantId);
    if (adminCount <= 1) {
      return NextResponse.json(
        { error: "Cannot remove the last active administrator. Assign another admin first." },
        { status: 409 },
      );
    }
  }

  const updated = await prisma.tenantMembership.update({
    where: { id: membershipId },
    data: {
      ...(newRole   !== undefined && { role:   newRole }),
      ...(newStatus !== undefined && { status: newStatus }),
    },
    include: {
      user: { select: { id: true, name: true, email: true, image: true, emailVerified: true } },
    },
  });

  return NextResponse.json({
    type:      "member",
    id:        updated.id,
    role:      updated.role,
    status:    updated.status,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
    user: {
      id:            updated.user.id,
      name:          updated.user.name,
      email:         updated.user.email,
      image:         updated.user.image,
      emailVerified: updated.user.emailVerified?.toISOString() ?? null,
    },
  });
}

// ── DELETE (soft deactivate) ──────────────────────────────────────────────────

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ membershipId: string }> },
) {
  const { membershipId } = await context.params;
  const session = await auth();
  if (!session?.user?.tenantId || !session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { tenantId, id: callerId } = session.user as { tenantId: string; id: string };

  const { authError, authStatus, target } = await getAuthorisedMembership(
    membershipId, tenantId, callerId,
  );
  if (authError || !target) {
    return NextResponse.json({ error: authError }, { status: authStatus });
  }

  // OWNER cannot be removed
  if (target.role === "OWNER") {
    return NextResponse.json({ error: "Cannot remove the Owner." }, { status: 403 });
  }

  // After the OWNER guard, target.role is "ADMIN" | "ACCOUNTANT" | "MEMBER" | "VIEWER"

  // Last-admin guard: one query covers both self-removal and general case
  if (target.role === "ADMIN") {
    const adminCount = await activeAdminCount(tenantId);
    if (adminCount <= 1) {
      const msg = target.userId === callerId
        ? "Cannot remove yourself — you are the last active administrator."
        : "Cannot remove the last active administrator. Assign another admin first.";
      return NextResponse.json({ error: msg }, { status: 409 });
    }
  }

  // Soft deactivate — preserves audit trail
  await prisma.tenantMembership.update({
    where: { id: membershipId },
    data:  { status: "INACTIVE" },
  });

  return NextResponse.json({ ok: true });
}
