import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getTenantIntegrations } from "@/lib/integrations/registry";
import type { IntegrationWithStatus } from "@/lib/integrations/registry";

// ── Helpers ──────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  revenue:   "Revenue",
  expense:   "Expense & Bills",
  payroll:   "Payroll",
  inventory: "Inventory",
  banking:   "Banking",
  all:       "General",
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  connected:    { label: "Connected",    cls: "bg-emerald-100 text-emerald-800" },
  disconnected: { label: "Disconnected", cls: "bg-slate-100 text-slate-600" },
  error:        { label: "Error",        cls: "bg-red-100 text-red-700" },
  paused:       { label: "Paused",       cls: "bg-amber-100 text-amber-700" },
};

function statusBadge(status: string | undefined) {
  const s = status ?? "disconnected";
  const { label, cls } = STATUS_BADGE[s] ?? STATUS_BADGE.disconnected;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

function connectHref(sourceApp: string): string {
  return `/integrations/${sourceApp}/connect`;
}

function statusHref(sourceApp: string): string {
  return `/integrations/${sourceApp}/status`;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function IntegrationSettingsPage() {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  if (!tenantId) redirect("/login");

  const integrations = await getTenantIntegrations(tenantId);

  // Group by category
  const groups = new Map<string, IntegrationWithStatus[]>();
  for (const integration of integrations) {
    const cat = integration.category;
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(integration);
  }

  const connectedCount = integrations.filter(
    (i) => i.tenantIntegration?.status === "connected",
  ).length;

  return (
    <div className="max-w-3xl space-y-8">
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Link href="/settings" className="hover:text-slate-700 transition-colors">
            Settings
          </Link>
          <span>/</span>
          <span>Integrations</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Integrations
        </h1>
        <p className="text-sm text-slate-500">
          Connect external apps to sync data automatically into FINOS.
          {connectedCount > 0 && (
            <span className="ml-1 font-medium text-emerald-700">
              {connectedCount} of {integrations.length} connected.
            </span>
          )}
        </p>
      </div>

      {/* Integration groups */}
      {Array.from(groups.entries()).map(([category, rows]) => (
        <section key={category} className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            {CATEGORY_LABELS[category] ?? category}
          </h2>

          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {rows.map((integration) => {
              const ti = integration.tenantIntegration;
              const isConnected = ti?.status === "connected";
              const caps = integration.capabilities as Record<string, boolean>;

              return (
                <div
                  key={integration.sourceApp}
                  className="flex items-center justify-between gap-4 px-5 py-4"
                >
                  {/* Left: name + capabilities */}
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900">
                        {integration.displayName}
                      </span>
                      {statusBadge(ti?.status)}
                    </div>

                    {/* Capability chips */}
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(caps)
                        .filter(([, v]) => v)
                        .map(([cap]) => (
                          <span
                            key={cap}
                            className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500"
                          >
                            {cap.replace(/_/g, " ")}
                          </span>
                        ))}
                    </div>

                    {/* Last sync time if connected */}
                    {isConnected && ti?.connectedAt && (
                      <p className="text-xs text-slate-400">
                        Connected{" "}
                        {new Date(ti.connectedAt).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </p>
                    )}
                  </div>

                  {/* Right: action button */}
                  <div className="flex-shrink-0">
                    {isConnected ? (
                      <Link
                        href={statusHref(integration.sourceApp)}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                      >
                        Manage
                      </Link>
                    ) : (
                      <Link
                        href={connectHref(integration.sourceApp)}
                        className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 transition-colors"
                      >
                        Connect
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {integrations.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 py-16 text-center text-sm text-slate-400">
          No integrations available. Contact support to enable integrations for your account.
        </div>
      )}

      {/* Info footer */}
      <p className="text-xs text-slate-400">
        All credentials are encrypted with AES-256-GCM. OAuth tokens are refreshed automatically.
        Connection data is tenant-isolated with row-level security.
      </p>
    </div>
  );
}
