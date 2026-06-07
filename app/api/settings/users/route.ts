/**
 * GET  /api/settings/users  — unified list: active/inactive members + pending invitations
 * POST /api/settings/users  — smart invite:
 *                              • email found → TenantMembership (ACTIVE)
 *                              • email not found → TenantInvitation (PENDING) + email
 */
import { NextResponse }   from "next/server";
import { z }              from "zod";
import { auth }           from "@/lib/auth";
import { prisma }         from "@/lib/prisma";
import { sendInviteEmail } from "@/lib/email";
import { randomUUID }     from "crypto";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://finos-app.com";

const inviteSchema = z.object({
  email: z.string().email(),
  role:  z.enum(["ADMIN", "ACCOUNTANT", "MEMBER", "VIEWER"]),
});

// ── Helper: check caller is OWNER or ADMIN ─────────────────────────────────

async function requireAdmin(tenantId: string, userId: string) {
  const m = await prisma.tenantMembership.findUnique({
    where:  { tenantId_userId: { tenantId, userId } },
    select: { role: true, status: true },
  });
  if (!m || m.status !== "ACTIVE") return false;
  return m.role === "OWNER" || m.role === "ADMIN";
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = session.user.tenantId;

  // Lazy-expire: mark any PENDING invitations that have passed their expiry time
  await prisma.tenantInvitation.updateMany({
    where: { tenantId, status: "PENDING", expiresAt: { lt: new Date() } },
    data:  { status: "EXPIRED" },
  });

  const [memberships, invitations] = await Promise.all([
    prisma.tenantMembership.findMany({
      where:   { tenantId },
      include: { user: { select: { id: true, name: true, email: true, image: true, emailVerified: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.tenantInvitation.findMany({
      where:   { tenantId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // Normalise into a unified array the frontend can consume
  const members = memberships.map((m) => ({
    type:      "member" as const,
    id:        m.id,
    role:      m.role,
    status:    m.status,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
    user: {
      id:            m.user.id,
      name:          m.user.name,
      email:         m.user.email,
      image:         m.user.image,
      emailVerified: m.user.emailVerified?.toISOString() ?? null,
    },
  }));

  const pendingInvites = invitations.map((inv) => ({
    type:      "invitation" as const,
    id:        inv.id,
    role:      inv.role,
    status:    "PENDING" as const,
    email:     inv.email,
    createdAt: inv.createdAt.toISOString(),
    expiresAt: inv.expiresAt.toISOString(),
  }));

  return NextResponse.json([...members, ...pendingInvites]);
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.tenantId || !session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId   = session.user.tenantId;
  const inviterId  = session.user.id;
  const inviterName = session.user.name ?? session.user.email ?? "A team member";

  if (!(await requireAdmin(tenantId, inviterId))) {
    return NextResponse.json({ error: "Only admins can invite users." }, { status: 403 });
  }

  const body   = await req.json().catch(() => null);
  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { email, role } = parsed.data;

  // ── Path A: user already has a FINOS account ────────────────────────────────
  const existingUser = await prisma.user.findUnique({ where: { email } });

  if (existingUser) {
    // Reject if already an active member
    const existing = await prisma.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId, userId: existingUser.id } },
    });
    if (existing && existing.status === "ACTIVE") {
      return NextResponse.json({ error: "User is already an active member." }, { status: 409 });
    }

    // If they're INACTIVE, reactivate
    if (existing && existing.status === "INACTIVE") {
      const reactivated = await prisma.tenantMembership.update({
        where:   { id: existing.id },
        data:    { role, status: "ACTIVE" },
        include: { user: { select: { id: true, name: true, email: true, image: true, emailVerified: true } } },
      });
      return NextResponse.json({
        type:      "member",
        id:        reactivated.id,
        role:      reactivated.role,
        status:    reactivated.status,
        createdAt: reactivated.createdAt.toISOString(),
        updatedAt: reactivated.updatedAt.toISOString(),
        user: {
          id:            reactivated.user.id,
          name:          reactivated.user.name,
          email:         reactivated.user.email,
          image:         reactivated.user.image,
          emailVerified: reactivated.user.emailVerified?.toISOString() ?? null,
        },
      }, { status: 200 });
    }

    // New membership
    const membership = await prisma.tenantMembership.create({
      data:    { tenantId, userId: existingUser.id, role, status: "ACTIVE" },
      include: { user: { select: { id: true, name: true, email: true, image: true, emailVerified: true } } },
    });

    // Revoke any outstanding pending invitation for this email
    await prisma.tenantInvitation.updateMany({
      where: { tenantId, email, status: "PENDING" },
      data:  { status: "ACCEPTED" },
    });

    return NextResponse.json({
      type:      "member",
      id:        membership.id,
      role:      membership.role,
      status:    membership.status,
      createdAt: membership.createdAt.toISOString(),
      updatedAt: membership.updatedAt.toISOString(),
      user: {
        id:            membership.user.id,
        name:          membership.user.name,
        email:         membership.user.email,
        image:         membership.user.image,
        emailVerified: membership.user.emailVerified?.toISOString() ?? null,
      },
    }, { status: 201 });
  }

  // ── Path B: no FINOS account — create invitation ────────────────────────────

  const token     = randomUUID();
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 h

  // Atomic: revoke any prior PENDING invitation and create the new one in one transaction.
  // Prevents duplicate invitations if two admins concurrently invite the same email.
  const [, invitation] = await prisma.$transaction([
    prisma.tenantInvitation.updateMany({
      where: { tenantId, email, status: "PENDING" },
      data:  { status: "REVOKED" },
    }),
    prisma.tenantInvitation.create({
      data: {
        tenantId,
        email,
        role,
        token,
        status:      "PENDING",
        invitedById: inviterId,
        expiresAt,
      },
      include: { tenant: { select: { name: true } } },
    }),
  ]);

  // Attempt email delivery; log failure but don't break the response
  let emailSent = false;
  try {
    const inviteUrl = `${APP_URL}/accept-invite?token=${token}`;
    await sendInviteEmail({
      to:          email,
      inviterName,
      orgName:     invitation.tenant.name,
      inviteUrl,
    });
    emailSent = true;
  } catch (err) {
    console.error("[invite] email send failed:", err);
  }

  return NextResponse.json({
    type:      "invitation",
    id:        invitation.id,
    role:      invitation.role,
    status:    "PENDING",
    email:     invitation.email,
    createdAt: invitation.createdAt.toISOString(),
    expiresAt: invitation.expiresAt.toISOString(),
    emailSent,
  }, { status: 201 });
}
