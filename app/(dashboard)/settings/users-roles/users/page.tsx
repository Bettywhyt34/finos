import { redirect }   from "next/navigation";
import { auth }        from "@/lib/auth";
import { prisma }      from "@/lib/prisma";
import UsersClient     from "./users-client";
import type { UnifiedUser } from "@/lib/users/service";

export const metadata = { title: "Users & Roles — FINOS" };

export default async function UsersSettingsPage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");

  const tenantId = session.user.tenantId;

  // Lazy-expire: mark any PENDING invitations that have passed their expiry time
  await prisma.tenantInvitation.updateMany({
    where: { tenantId, status: "PENDING", expiresAt: { lt: new Date() } },
    data:  { status: "EXPIRED" },
  });

  const [memberships, invitations] = await Promise.all([
    prisma.tenantMembership.findMany({
      where:   { tenantId },
      include: {
        user: {
          select: { id: true, name: true, email: true, image: true, emailVerified: true },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.tenantInvitation.findMany({
      where:   { tenantId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const users: UnifiedUser[] = [
    ...memberships.map((m) => ({
      type:      "member" as const,
      id:        m.id,
      role:      m.role as UnifiedUser["role"],
      status:    m.status as "ACTIVE" | "INACTIVE",
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
      user: {
        id:            m.user.id,
        name:          m.user.name,
        email:         m.user.email,
        image:         m.user.image,
        emailVerified: m.user.emailVerified?.toISOString() ?? null,
      },
    })),
    ...invitations.map((inv) => ({
      type:      "invitation" as const,
      id:        inv.id,
      role:      inv.role as UnifiedUser["role"],
      status:    "PENDING" as const,
      email:     inv.email,
      createdAt: inv.createdAt.toISOString(),
      expiresAt: inv.expiresAt.toISOString(),
    })),
  ];

  return (
    <UsersClient
      users={users}
      currentUserId={session.user.id}
    />
  );
}
