import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { SyncNowButton } from "./sync-now-button";

export default async function RevflowStatusPage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");
  const orgId = session.user.tenantId;

  const [connection, recentLogs, campaigns, invoices, quarantineCount] = await Promise.all([
    prisma.integrationConnection.findUnique({
      where:  { tenantId_sourceApp: { tenantId: orgId, sourceApp: "revflow" } },
      select: {
        status:        true,
        lastSyncAt:    true,
        lastError:     true,
        syncEnabled:   true,
        apiUrl:        true,
      },
    }),
    prisma.syncLog.findMany({
      where:   { tenantId: orgId, sourceApp: "revflow" },
      orderBy: { startedAt: "desc" },
      take:    10,
      select: {
        id: true, syncType: true, status: true,
        startedAt: true, completedAt: true,
        recordsProcessed: true, recordsCreated: true,
        recordsUpdated: true, recordsFailed: true, recordsQuarantined: true,
        errorMessage: true,
      },
    }),
    prisma.revflowCampaign.count({ where: { tenantId: orgId } }),
    prisma.revflowInvoice.count({ where: { tenantId: orgId } }),
    prisma.syncQuarantine.count({
      where: { tenantId: orgId, sourceApp: "revflow", resolved: false },
    }),
  ]);

  // ─── Not connected ──────────────────────────────────────────────────────────

  if (!connection) {
    return (
      <div className="max-w-lg space-y-4">
        <h1 className="text-2xl font-bold text-slate-900">Revflow Integration</h1>
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto">
            <span className="text-2xl">🔌</span>
          </div>
          <div>
            <p className="font-semibold text-slate-800">Not connected</p>
            <p className="text-sm text-slate-500 mt-1">
              Connect Revflow to sync revenue campaigns, invoices, and payments into FINOS.
            </p>
          </div>
          <Link
            href="/integrations/revflow/connect"
            className="inline-flex items-center px-5 py-2.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-700 rounded-lg transition-colors"
          >
            Connect Revflow
          </Link>
        </div>
      </div>
    );
  }

  // ─── Status badge helper ────────────────────────────────────────────────────

  const statusColors: Record<string, string> = {
    CONNECTED:    "bg-emerald-100 text-emerald-800",
    CONNECTING:   "bg-amber-100 text-amber-800",
    ERROR:        "bg-red-100 text-red-800",
    DISCONNECTED: "bg-slate-100 text-slate-600",
  };

  const logColors: Record<string, string> = {
    SUCCESS: "bg-emerald-100 text-emerald-800",
    PARTIAL: "bg-amber-100 text-amber-800",
    FAILED:  "bg-red-100 text-red-800",
    RUNNING: "bg-blue-100 text-blue-800",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Revflow Integration</h1>
          <p className="text-sm text-slate-500 mt-1">{connection.apiUrl}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/integrations/revflow/connect"
            className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Edit Connection
          </Link>
          <SyncNowButton />
        </div>
      </div>

      {/* Connection status + record counts */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          {
            label: "Status",
            value: (
              <span className={`text-xs font-semibold px-2 py-0.5 rounded ${statusColors[connection.status] ?? "bg-slate-100"}`}>
                {connection.status}
              </span>
            ),
          },
          {
            label: "Last Sync",
            value: connection.lastSyncAt
              ? new Date(connection.lastSyncAt).toLocaleString("en-NG")
              : "Never",
          },
          { label: "Campaigns",  value: campaigns.toLocaleString() },
          { label: "Invoices",   value: invoices.toLocaleString() },
        ].map((card) => (
          <div key={card.label} className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500">{card.label}</p>
            <div className="mt-1 text-sm font-semibold text-slate-900">{card.value}</div>
          </div>
        ))}
      </div>

      {/* Error banner */}
      {connection.status === "ERROR" && connection.lastError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-red-800">Last sync error</p>
          <p className="text-sm text-red-700 mt-1 font-mono">{connection.lastError}</p>
          <p className="text-xs text-red-600 mt-2">
            Run a <strong>Full Sync</strong> to reset the connection.
          </p>
        </div>
      )}

      {/* Quarantine alert */}
      {quarantineCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-amber-800">
              {quarantineCount} quarantined record{quarantineCount !== 1 ? "s" : ""}
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              These records failed to sync. Review and retry or resolve them.
            </p>
          </div>
          <Link
            href="/integrations/revflow/quarantine"
            className="text-sm font-medium text-amber-800 underline"
          >
            Review
          </Link>
        </div>
      )}

      {/* Sync log table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-3 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Recent Sync Jobs</h2>
          <SyncNowButton variant="full" />
        </div>

        {recentLogs.length === 0 ? (
          <p className="px-6 py-8 text-sm text-slate-500 text-center">No sync jobs yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                {["Type", "Status", "Started", "Duration", "Processed", "Created", "Updated", "Failed", "Quarantined"].map(
                  (h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-slate-500 uppercase whitespace-nowrap">
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {recentLogs.map((log) => {
                const durationMs =
                  log.completedAt && log.startedAt
                    ? new Date(log.completedAt).getTime() - new Date(log.startedAt).getTime()
                    : null;
                const duration = durationMs != null
                  ? durationMs < 60_000
                    ? `${(durationMs / 1000).toFixed(1)}s`
                    : `${(durationMs / 60_000).toFixed(1)}m`
                  : "—";

                return (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-600 uppercase">
                      {log.syncType}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded ${logColors[log.status] ?? "bg-slate-100"}`}>
                        {log.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">
                      {new Date(log.startedAt).toLocaleString("en-NG")}
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">{duration}</td>
                    <td className="px-4 py-2.5 text-right text-slate-700">{log.recordsProcessed}</td>
                    <td className="px-4 py-2.5 text-right text-emerald-700">{log.recordsCreated}</td>
                    <td className="px-4 py-2.5 text-right text-blue-700">{log.recordsUpdated}</td>
                    <td className="px-4 py-2.5 text-right text-red-600">{log.recordsFailed}</td>
                    <td className="px-4 py-2.5 text-right text-amber-700">{log.recordsQuarantined}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {recentLogs.some((l) => l.errorMessage) && (
          <div className="px-6 py-3 border-t border-slate-100 space-y-1">
            {recentLogs
              .filter((l) => l.errorMessage)
              .slice(0, 3)
              .map((l) => (
                <p key={l.id} className="text-xs text-red-600 font-mono">
                  [{new Date(l.startedAt).toLocaleString("en-NG")}] {l.errorMessage}
                </p>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
