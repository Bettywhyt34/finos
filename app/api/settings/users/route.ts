/**
 * GET  /api/settings/users  — list tenant members
 * POST /api/settings/users  — invite (add) a user by email
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const inviteSchema = z.object({
  email: z.string().email(),
  role:  z.enum(["ADMIN", "ACCOUNTANT", "MEMBER", "VIEWER"]),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const members = await prisma.tenantMembership.findMany({
    where:   { tenantId: session.user.tenantId },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(members);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { email, role } = parsed.data;
  const tenantId = session.user.tenantId;

  // Find user by email
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return NextResponse.json(
      { error: "No account found for that email. Ask them to register first." },
      { status: 404 }
    );
  }

  // Check not already a member
  const existing = await prisma.tenantMembership.findUnique({
    where: { tenantId_userId: { tenantId, userId: user.id } },
  });
  if (existing) {
    return NextResponse.json({ error: "User is already a member." }, { status: 409 });
  }

  const membership = await prisma.tenantMembership.create({
    data:    { tenantId, userId: user.id, role },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
  });

  return NextResponse.json(membership, { status: 201 });
}
