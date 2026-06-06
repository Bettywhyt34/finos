import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BrandingClient } from "./branding-client";

export const metadata = { title: "Branding — FINOS Books" };

export default async function BrandingPage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");

  const tenant = await prisma.tenant.findUnique({
    where: { id: session.user.tenantId },
    select: { name: true, logoUrl: true },
  });

  if (!tenant) redirect("/login");

  return (
    <BrandingClient
      orgName={session.user.tenantName ?? tenant.name}
      logoUrl={tenant.logoUrl ?? null}
    />
  );
}
