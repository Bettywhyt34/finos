/**
 * PATCH  /api/settings/users/[membershipId]  — change role
 * DELETE /api/settings/users/[membershipId]  — remove member
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const patchSchema = z.object({
  role: z.enum(["ADMIN", "ACCOUNTANT", "MEMBER", "VIEWER"]),
});

async function getMembership(membershipId: string, tenantId: string) {
  return prisma.tenantMembership.findFirst({
    where: { id: membershipId, tenantId },
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: { membershipId: string } }
) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const membership = await getMembership(params.membershipId, session.user.tenantId);
  if (!membership) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }
  if (membership.role === "OWNER") {
    return NextResponse.json({ error: "Cannot change the Owner role" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await prisma.tenantMembership.update({
    where:   { id: params.membershipId },
    data:    { role: parsed.data.role },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: { membershipId: string } }
) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const membership = await getMembership(params.membershipId, session.user.tenantId);
  if (!membership) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }
  if (membership.role === "OWNER") {
    return NextResponse.json({ error: "Cannot remove the Owner" }, { status: 403 });
  }
  if (membership.userId === session.user.id) {
    return NextResponse.json({ error: "Cannot remove yourself" }, { status: 403 });
  }

  await prisma.tenantMembership.delete({ where: { id: params.membershipId } });
  return NextResponse.json({ ok: true });
}
