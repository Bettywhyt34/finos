import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getQuarantineRecords } from "@/lib/integrations/sync-engine";
import { ChevronLeft } from "lucide-react";
import { QuarantineTable } from "./quarantine-actions";

export default async function QuarantinePage() {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  if (!tenantId) redirect("/auth/signin");

  const { records, total } = await getQuarantineRecords(tenantId, undefined, 1, 100);

  // Group counts by source app for the summary
  const appCounts = records.reduce<Record<string, number>>((acc, r) => {
    acc[r.sourceApp] = (acc[r.sourceApp] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link
          href="/settings/integrations"
          className="flex items-center gap-1 hover:text-slate-800 transition-colors"
        >
          <ChevronLeft size={14} />
          Integrations
        </Link>
        <span>/</span>
        <span className="text-slate-800 font-medium">Quarantine Review</span>
      </div>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Sync Quarantine</h1>
        <p className="text-sm text-slate-500 mt-1">
          Records that failed to sync and require manual review. Retry to re-queue them, or resolve
          to dismiss.
        </p>
      </div>

      {/* Summary chips */}
      {Object.keys(appCounts).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(appCounts).map(([app, count]) => (
            <span
              key={app}
              className="inline-flex items-center gap-1 rounded-full border bg-white px-3 py-1 text-sm"
            >
              <span className="capitalize font-medium text-slate-700">{app}</span>
              <span className="rounded-full bg-red-100 text-red-700 px-1.5 py-px text-xs font-semibold">
                {count}
              </span>
            </span>
          ))}
        </div>
      )}

      <QuarantineTable
        initialRecords={records.map((r) => ({
          id:           r.id,
          sourceApp:    r.sourceApp,
          sourceTable:  r.sourceTable,
          sourceId:     r.sourceId,
          errorReason:  r.errorReason,
          retryCount:   r.retryCount,
          createdAt:    r.createdAt.toISOString(),
        }))}
        total={total}
      />
    </div>
  );
}
