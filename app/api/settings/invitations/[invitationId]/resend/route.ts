/**
 * POST  /api/settings/invitations/[invitationId]/resend
 *
 * Regenerates the token, resets expiresAt (+48 h), and resends the invite email.
 * If the invitation is expired, it is also reactivated to PENDING.
 */
import { NextResponse }   from "next/server";
import { auth }           from "@/lib/auth";
import { prisma }         from "@/lib/prisma";
import { sendInviteEmail } from "@/lib/email";
import { randomUUID }     from "crypto";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://finos-app.com";

export async function POST(
  _req: Request,
  context: { params: Promise<{ invitationId: string }> },
) {
  const { invitationId } = await context.params;
  const session = await auth();
  if (!session?.user?.tenantId || !session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId    = session.user.tenantId;
  const callerId    = session.user.id;
  const callerName  = session.user.name ?? session.user.email ?? "A team member";

  // Caller must be OWNER or ADMIN
  const caller = await prisma.tenantMembership.findUnique({
    where:  { tenantId_userId: { tenantId, userId: callerId } },
    select: { role: true, status: true },
  });
  if (!caller || caller.status !== "ACTIVE" || (caller.role !== "OWNER" && caller.role !== "ADMIN")) {
    return NextResponse.json({ error: "Only admins can manage invitations." }, { status: 403 });
  }

  const invitation = await prisma.tenantInvitation.findFirst({
    where:   { id: invitationId, tenantId },
    include: { tenant: { select: { name: true } } },
  });
  if (!invitation) {
    return NextResponse.json({ error: "Invitation not found." }, { status: 404 });
  }
  if (invitation.status === "ACCEPTED" || invitation.status === "REVOKED") {
    return NextResponse.json({ error: `Cannot resend an invitation with status: ${invitation.status}.` }, { status: 409 });
  }

  // Check if the email now belongs to an existing user — if so, create membership
  const existingUser = await prisma.user.findUnique({ where: { email: invitation.email } });
  if (existingUser) {
    const alreadyMember = await prisma.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId, userId: existingUser.id } },
    });
    if (alreadyMember && alreadyMember.status === "ACTIVE") {
      return NextResponse.json({ error: "This user already has an active membership." }, { status: 409 });
    }
  }

  const newToken     = randomUUID();
  const newExpiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

  const updated = await prisma.tenantInvitation.update({
    where: { id: invitationId },
    data:  { token: newToken, expiresAt: newExpiresAt, status: "PENDING" },
  });

  let emailSent = false;
  try {
    await sendInviteEmail({
      to:          invitation.email,
      inviterName: callerName,
      orgName:     invitation.tenant.name,
      inviteUrl:   `${APP_URL}/accept-invite?token=${newToken}`,
    });
    emailSent = true;
  } catch (err) {
    console.error("[resend] email send failed:", err);
  }

  return NextResponse.json({
    type:      "invitation",
    id:        updated.id,
    role:      updated.role,
    status:    "PENDING",
    email:     invitation.email,
    createdAt: updated.createdAt.toISOString(),
    expiresAt: updated.expiresAt.toISOString(),
    emailSent,
  });
}
