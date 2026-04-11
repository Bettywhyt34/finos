import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { SyncNowButton } from "./sync-now-button";

export default async function XpenxFlowStatusPage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");
  const orgId = session.user.tenantId;

  const [connection, recentLogs, quarantineCount] = await Promise.all([
    prisma.integrationConnection.findUnique({
      where:  { tenantId_sourceApp: { tenantId: orgId, sourceApp: "xpenxflow" } },
      select: { status: true, lastSyncAt: true, lastError: true, syncEnabled: true, apiUrl: true, sourceOrgName: true },
    }),
    prisma.syncLog.findMany({
      where:   { tenantId: orgId, sourceApp: "xpenxflow" },
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
    prisma.syncQuarantine.count({
      where: { tenantId: orgId, sourceApp: "xpenxflow", resolved: false },
    }),
  ]);

  if (!connection) {
    return (
      <div className="max-w-lg space-y-4">
        <h1 className="text-2xl font-bold text-slate-900">XpenxFlow Integration</h1>
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto">
            <span className="text-2xl">🔌</span>
          </div>
          <div>
            <p className="font-semibold text-slate-800">Not connected</p>
            <p className="text-sm text-slate-500 mt-1">
              Connect XpenxFlow to sync expenses, bills, and vendor payments into FINOS.
            </p>
          </div>
          <Link
            href="/integrations/xpenxflow/connect"
            className="inline-flex items-center px-5 py-2.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-700 rounded-lg transition-colors"
          >
            Connect XpenxFlow
          </Link>
        </div>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    CONNECTED:    "bg-emerald-100 text-emerald-800",
    CONNECTING:   "bg-amber-100 text-amber-800",
    ERROR:        "bg-red-100 text-red-800",
    DISCONNECTED: "bg-slate-100 text-slate-600",
    TOKEN_EXPIRED:"bg-orange-100 text-orange-800",
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
          <h1 className="text-2xl font-bold text-slate-900">XpenxFlow Integration</h1>
          <p className="text-sm text-slate-500 mt-1">{connection.sourceOrgName ?? connection.apiUrl}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/integrations/xpenxflow/connect"
            className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            {connection.status === "TOKEN_EXPIRED" ? "Re-authorise" : "Edit Connection"}
          </Link>
          <SyncNowButton />
        </div>
      </div>

      {connection.status === "TOKEN_EXPIRED" && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-orange-800">Access token expired</p>
          <p className="text-sm text-orange-700 mt-1">
            Click <strong>Re-authorise</strong> to reconnect XpenxFlow. No data will be lost.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
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
          { label: "Sync", value: connection.syncEnabled ? "Enabled" : "Disabled" },
        ].map((card) => (
          <div key={card.label} className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500">{card.label}</p>
            <div className="mt-1 text-sm font-semibold text-slate-900">{card.value}</div>
          </div>
        ))}
      </div>

      {connection.status === "ERROR" && connection.lastError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-red-800">Last sync error</p>
          <p className="text-sm text-red-700 mt-1 font-mono">{connection.lastError}</p>
        </div>
      )}

      {quarantineCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-amber-800">
              {quarantineCount} quarantined record{quarantineCount !== 1 ? "s" : ""}
            </p>
            <p className="text-xs text-amber-700 mt-0.5">These records failed to sync. Review and retry.</p>
          </div>
        </div>
      )}

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
                {["Type", "Status", "Started", "Processed", "Created", "Updated", "Failed"].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-slate-500 uppercase whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {recentLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-600 uppercase">{log.syncType}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded ${logColors[log.status] ?? "bg-slate-100"}`}>
                      {log.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">
                    {new Date(log.startedAt).toLocaleString("en-NG")}
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-700">{log.recordsProcessed}</td>
                  <td className="px-4 py-2.5 text-right text-emerald-700">{log.recordsCreated}</td>
                  <td className="px-4 py-2.5 text-right text-blue-700">{log.recordsUpdated}</td>
                  <td className="px-4 py-2.5 text-right text-red-600">{log.recordsFailed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
