import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isBettywhytOrg } from "@/lib/integrations/bettywhyt/guard";

export default async function BettywhytLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.organizationId) redirect("/login");
  if (!isBettywhytOrg(session.user.organizationId)) redirect("/integrations");
  return <>{children}</>;
}
