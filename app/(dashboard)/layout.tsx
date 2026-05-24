import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Header } from "@/components/dashboard/header";
import { isBettywhytOrg } from "@/lib/integrations/bettywhyt/guard";
import { prisma } from "@/lib/prisma";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!session.user?.tenantId) redirect("/register");

  const tenantId = session.user.tenantId;

  const [showBettywhyt, finosPosConn] = await Promise.all([
    Promise.resolve(isBettywhytOrg(tenantId)),
    prisma.integrationConnection.findUnique({
      where: { tenantId_sourceApp: { tenantId, sourceApp: "finos_pos" } },
      select: { status: true },
    }),
  ]);
  const showFinosPos = finosPosConn?.status === "CONNECTED" || finosPosConn?.status === "CONNECTING";

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <Sidebar
        orgName={session.user.tenantName ?? "Your workspace"}
        showBettywhyt={showBettywhyt}
        showFinosPos={showFinosPos}
      />

      <div className="flex flex-col flex-1 min-w-0">
        <Header
          userName={session.user.name}
          userImage={session.user.image}
          orgName={session.user.tenantName}
        />
        <main className="flex-1 overflow-auto">
          <div className="p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
