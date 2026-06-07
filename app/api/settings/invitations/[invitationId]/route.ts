/**
 * PATCH  /api/settings/invitations/[invitationId]  — revoke a pending invitation
 */
import { NextResponse } from "next/server";
import { auth }         from "@/lib/auth";
import { prisma }       from "@/lib/prisma";

export async function PATCH(
  _req: Request,
  context: { params: Promise<{ invitationId: string }> },
) {
  const { invitationId } = await context.params;
  const session = await auth();
  if (!session?.user?.tenantId || !session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = session.user.tenantId;
  const callerId = session.user.id;

  // Caller must be OWNER or ADMIN
  const caller = await prisma.tenantMembership.findUnique({
    where:  { tenantId_userId: { tenantId, userId: callerId } },
    select: { role: true, status: true },
  });
  if (!caller || caller.status !== "ACTIVE" || (caller.role !== "OWNER" && caller.role !== "ADMIN")) {
    return NextResponse.json({ error: "Only admins can manage invitations." }, { status: 403 });
  }

  const invitation = await prisma.tenantInvitation.findFirst({
    where: { id: invitationId, tenantId },
  });
  if (!invitation) {
    return NextResponse.json({ error: "Invitation not found." }, { status: 404 });
  }
  if (invitation.status !== "PENDING") {
    return NextResponse.json({ error: `Cannot revoke an invitation with status: ${invitation.status}.` }, { status: 409 });
  }

  await prisma.tenantInvitation.update({
    where: { id: invitationId },
    data:  { status: "REVOKED" },
  });

  return NextResponse.json({ ok: true });
}
