import { redirect }               from "next/navigation";
import { auth }                   from "@/lib/auth";
import { prisma }                 from "@/lib/prisma";
import RolesClient                from "./roles-client";
import { SYSTEM_ROLE_DEFINITIONS } from "@/lib/roles/service";
import type { UserRole, RoleWithStats } from "@/lib/roles/service";

export const metadata = { title: "Roles — FINOS" };

const ROLE_ORDER: UserRole[] = ["OWNER", "ADMIN", "ACCOUNTANT", "MEMBER", "VIEWER"];

export default async function RolesSettingsPage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");

  const tenantId  = session.user.tenantId;
  const userRole  = session.user.role as UserRole | null;
  const canManage = userRole === "OWNER" || userRole === "ADMIN";

  // Only fetch role data for OWNER/ADMIN — non-managers see Access Restricted
  // and must not receive the role data embedded in their page HTML.
  let roles: RoleWithStats[] = [];

  if (canManage) {
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

    roles = ROLE_ORDER.map((role, i) => ({
      id:            role,
      ...SYSTEM_ROLE_DEFINITIONS[role],
      userCount:     activeCounts[i],
      inactiveCount: inactiveCounts[i],
      createdAt:     null,
      updatedAt:     null,
    }));
  }

  return (
    <RolesClient
      roles={roles}
      canManage={canManage}
      orgName={session.user.tenantName ?? "Organisation"}
    />
  );
}
