import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import UsersClient from "./users-client";

export const metadata = { title: "User Management" };

export default async function UsersSettingsPage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");

  const members = await prisma.tenantMembership.findMany({
    where:   { tenantId: session.user.tenantId },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          User Management
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Manage who has access to your organisation and their roles.
        </p>
      </div>
      <UsersClient
        members={members.map((m) => ({
          id:        m.id,
          role:      m.role as "OWNER" | "ADMIN" | "ACCOUNTANT" | "MEMBER" | "VIEWER",
          createdAt: m.createdAt.toISOString(),
          user:      m.user,
        }))}
        currentUserId={session.user.id}
      />
    </div>
  );
}
