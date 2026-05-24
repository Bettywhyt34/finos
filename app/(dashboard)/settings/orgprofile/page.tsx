import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { OrgProfileClient } from "./org-profile-client";

export const metadata = { title: "Organisation Profile" };

export default async function OrgProfilePage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");

  const tenant = await prisma.tenant.findUnique({
    where: { id: session.user.tenantId },
    select: {
      id:              true,
      name:            true,
      currency:        true,
      countryCode:     true,
      fiscalYearStart: true,
      timezone:        true,
      industryCode:    true,
    },
  });

  if (!tenant) redirect("/login");

  return (
    <OrgProfileClient
      tenant={tenant}
      orgName={session.user.tenantName ?? tenant.name}
    />
  );
}
