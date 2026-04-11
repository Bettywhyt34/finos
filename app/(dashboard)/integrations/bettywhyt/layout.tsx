import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isBettywhytOrg } from "@/lib/integrations/bettywhyt/guard";

export default async function BettywhytLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");
  if (!isBettywhytOrg(session.user.tenantId)) redirect("/integrations");
  return <>{children}</>;
}
