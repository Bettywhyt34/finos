import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { isBettywhytOrg } from "@/lib/integrations/bettywhyt/guard";

export const dynamic = "force-dynamic";

const INTEGRATIONS = [
  {
    key:         "revflow" as const,
    name:        "Revflow",
    description: "Sync revenue campaigns, invoices, and payments into your FINOS ledger.",
    connectHref: "/integrations/revflow/connect",
    statusHref:  "/integrations/revflow/status",
    scopes:      ["Campaigns", "Invoices", "Payments"],
  },
  {
    key:         "xpenxflow" as const,
    name:        "XpenxFlow",
    description: "Sync expense claims, bills, and vendor payments from your procurement app.",
    connectHref: "/integrations/xpenxflow/connect",
    statusHref:  "/integrations/xpenxflow/status",
    scopes:      ["Expenses", "Bills", "Vendor Payments"],
  },
  {
    key:         "earnmark360" as const,
    name:        "EARNMARK360",
    description: "Sync payroll runs, employee records, and attendance data.",
    connectHref: "/integrations/earnmark360/connect",
    statusHref:  "/integrations/earnmark360/status",
    scopes:      ["Employees", "Payroll", "Attendance"],
  },
  {
    key:         "bettywhyt" as const,
    name:        "BettyWhyt",
    description: "Sync online orders, inventory, and COGS from BettyWhyt Perfumes e-commerce.",
    connectHref: "/integrations/bettywhyt/connect",
    statusHref:  "/integrations/bettywhyt/status",
    scopes:      ["Inventory", "Sales", "COGS"],
  },
] as const;

type SourceApp = typeof INTEGRATIONS[number]["key"];

const STATUS_COLORS: Record<string, string> = {
  CONNECTED:     "bg-emerald-100 text-emerald-800",
  CONNECTING:    "bg-amber-100 text-amber-800",
  ERROR:         "bg-red-100 text-red-800",
  TOKEN_EXPIRED: "bg-orange-100 text-orange-800",
  DISCONNECTED:  "bg-slate-100 text-slate-600",
};

export default async function IntegrationsPage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");
  const orgId = session.user.tenantId;

  const connections = await prisma.integrationConnection.findMany({
    where:  { tenantId: orgId },
    select: { sourceApp: true, status: true, lastSyncAt: true, sourceOrgName: true },
  });

  const connMap = new Map(connections.map((c) => [c.sourceApp, c]));

  const visibleIntegrations = INTEGRATIONS.filter(
    (i) => i.key !== "bettywhyt" || isBettywhytOrg(orgId),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Integrations</h1>
        <p className="text-sm text-slate-500 mt-1">
          Connect third-party apps to automatically sync data into FINOS via OAuth.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visibleIntegrations.map((integration) => {
          const conn = connMap.get(integration.key);
          const isConnected = conn && conn.status !== "DISCONNECTED";

          return (
            <div key={integration.key} className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col gap-4">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">{integration.name}</h2>
                  {conn?.sourceOrgName && (
                    <p className="text-xs text-slate-400 mt-0.5">{conn.sourceOrgName}</p>
                  )}
                </div>
                {conn && (
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded ${STATUS_COLORS[conn.status] ?? "bg-slate-100"}`}>
                    {conn.status === "TOKEN_EXPIRED" ? "EXPIRED" : conn.status}
                  </span>
                )}
              </div>

              <p className="text-sm text-slate-600 flex-1">{integration.description}</p>

              <div className="flex flex-wrap gap-1.5">
                {integration.scopes.map((s) => (
                  <span key={s} className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                    {s}
                  </span>
                ))}
              </div>

              {conn?.lastSyncAt && (
                <p className="text-xs text-slate-400">
                  Last synced {new Date(conn.lastSyncAt).toLocaleString("en-NG")}
                </p>
              )}

              <div className="flex gap-2 pt-1">
                {isConnected ? (
                  <>
                    <Link
                      href={integration.statusHref}
                      className="flex-1 text-center px-3 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                    >
                      View Status
                    </Link>
                    {conn?.status === "TOKEN_EXPIRED" && (
                      <Link
                        href={integration.connectHref}
                        className="flex-1 text-center px-3 py-2 text-sm font-semibold text-white bg-orange-600 hover:bg-orange-700 rounded-lg transition-colors"
                      >
                        Re-authorise
                      </Link>
                    )}
                  </>
                ) : (
                  <Link
                    href={integration.connectHref}
                    className="w-full text-center px-3 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-700 rounded-lg transition-colors"
                  >
                    Connect {integration.name}
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <p className="text-sm font-medium text-blue-800">Security</p>
        <p className="text-sm text-blue-700 mt-1">
          Revflow, XpenxFlow, and EARNMARK360 use OAuth 2.0 Authorization Code flow.
          BettyWhyt uses API key auth (internally owned platform).
          All credentials are stored encrypted with AES-256-GCM and never exposed to the browser.
        </p>
      </div>
    </div>
  );
}
