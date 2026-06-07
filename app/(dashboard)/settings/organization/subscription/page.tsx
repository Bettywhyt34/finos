import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SubscriptionClient } from "./subscription-client";

export const metadata = { title: "Manage Subscription — FINOS Books" };

export default async function ManageSubscriptionPage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");

  const tenant = await prisma.tenant.findUnique({
    where:  { id: session.user.tenantId },
    select: { name: true },
  });

  if (!tenant) redirect("/login");

  return (
    <SubscriptionClient orgName={session.user.tenantName ?? tenant.name} />
  );
}
