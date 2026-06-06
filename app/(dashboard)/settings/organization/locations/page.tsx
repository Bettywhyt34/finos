import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LocationsClient } from "./locations-client";

export const metadata = { title: "Locations — FINOS Books" };

export default async function LocationsPage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");

  const tenant = await prisma.tenant.findUnique({
    where:  { id: session.user.tenantId },
    select: { name: true, locationsEnabled: true },
  });
  if (!tenant) redirect("/login");

  const locations = tenant.locationsEnabled
    ? await prisma.location.findMany({
        where:   { tenantId: session.user.tenantId },
        orderBy: [{ parentId: "asc" }, { name: "asc" }],
      })
    : [];

  return (
    <LocationsClient
      orgName={session.user.tenantName ?? tenant.name}
      locationsEnabled={tenant.locationsEnabled}
      locations={locations.map((l) => ({
        id:       l.id,
        name:     l.name,
        type:     l.type,
        parentId: l.parentId,
        address:  l.address,
        city:     l.city,
        state:    l.state,
        country:  l.country,
        status:   l.status,
      }))}
    />
  );
}
