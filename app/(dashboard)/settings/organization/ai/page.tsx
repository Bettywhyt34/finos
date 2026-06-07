import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AIClient } from "./ai-client";

export const metadata = { title: "AI Preferences — FINOS Books" };

export default async function AIPreferencesPage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");

  const tenant = await prisma.tenant.findUnique({
    where:  { id: session.user.tenantId },
    select: { name: true },
  });

  if (!tenant) redirect("/login");

  return (
    <AIClient orgName={session.user.tenantName ?? tenant.name} />
  );
}
