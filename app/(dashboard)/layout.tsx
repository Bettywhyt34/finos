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

  const [showBettywhyt, finosPosConn, tenant, connectedAppCount] = await Promise.all([
    Promise.resolve(isBettywhytOrg(tenantId)),
    prisma.integrationConnection.findUnique({
      where: { tenantId_sourceApp: { tenantId, sourceApp: "finos_pos" } },
      select: { status: true },
    }),
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { currency: true, additionalFields: true },
    }),
    prisma.integrationConnection.count({
      where: { tenantId, status: "CONNECTED" },
    }),
  ]);
  const memberships = await prisma.tenantMembership.findMany({ where: { userId: session.user.id, status: "ACTIVE", tenant: { status: "active" } }, include: { tenant: { select: { id: true, name: true, currency: true } } } });
  const showFinosPos = finosPosConn?.status === "CONNECTED" || finosPosConn?.status === "CONNECTING";

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--app-bg)]">
      <Sidebar
        userName={session.user.name}
        userRole={session.user.role}
        connectedAppCount={connectedAppCount}
        showBettywhyt={showBettywhyt}
        showFinosPos={showFinosPos}
      />

      <div className="flex flex-col flex-1 min-w-0">
        <Header tenantId={tenantId} entities={memberships.map(m => m.tenant)}
          orgName={session.user.tenantName}
          currency={tenant?.currency ?? "NGN"}
        />
        <main key={tenantId} className="flex-1 overflow-auto">
          <div className="p-6">{tenant?.additionalFields && typeof tenant.additionalFields === "object" && !Array.isArray(tenant.additionalFields) && tenant.additionalFields.finosDemo === true && <div role="status" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">Demo · Synthetic data. Fictional company and transactions for FINOS walkthroughs.</div>}{children}</div>
        </main>
      </div>
    </div>
  );
}
