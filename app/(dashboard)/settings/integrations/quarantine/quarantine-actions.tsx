"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, CheckCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

type QuarantineRecord = {
  id: string;
  sourceApp: string;
  sourceTable: string;
  sourceId: string;
  errorReason: string;
  retryCount: number;
  createdAt: string;
};

export function QuarantineTable({
  initialRecords,
  total,
}: {
  initialRecords: QuarantineRecord[];
  total: number;
}) {
  const [records, setRecords] = useState<QuarantineRecord[]>(initialRecords);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<"retry" | "resolve" | null>(null);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === records.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(records.map((r) => r.id)));
    }
  }

  async function handleAction(action: "retry" | "resolve") {
    const ids = Array.from(selected);
    if (ids.length === 0) return;

    // For retry, all selected must have the same sourceApp
    const apps = Array.from(new Set(ids.map((id) => records.find((r) => r.id === id)?.sourceApp)));
    if (action === "retry" && apps.length > 1) {
      toast.error("Select records from one integration at a time for retry");
      return;
    }

    setLoading(action);
    try {
      const body =
        action === "retry"
          ? { action, sourceApp: apps[0], quarantineIds: ids }
          : { action, quarantineIds: ids };

      const res = await fetch("/api/settings/integrations/quarantine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();

      if (action === "resolve") {
        setRecords((prev) => prev.filter((r) => !selected.has(r.id)));
      } else {
        // Update retryCount in place
        setRecords((prev) =>
          prev.map((r) =>
            selected.has(r.id) ? { ...r, retryCount: r.retryCount + 1 } : r
          )
        );
      }
      setSelected(new Set());
      toast.success(
        action === "retry"
          ? `Queued ${ids.length} record${ids.length !== 1 ? "s" : ""} for retry`
          : `Resolved ${ids.length} record${ids.length !== 1 ? "s" : ""}`
      );
    } catch {
      toast.error(`Failed to ${action} records`);
    } finally {
      setLoading(null);
    }
  }

  if (records.length === 0) {
    return (
      <div className="rounded-lg border bg-white px-6 py-12 text-center text-slate-400">
        <CheckCircle size={32} className="mx-auto mb-2 text-emerald-400" />
        <p className="font-medium">No quarantined records</p>
        <p className="text-sm mt-1">All sync records processed successfully</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border bg-blue-50 border-blue-200 px-4 py-2">
          <span className="text-sm text-blue-700 font-medium">
            {selected.size} selected
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => handleAction("retry")}
            disabled={loading !== null}
          >
            {loading === "retry" ? (
              <Loader2 size={13} className="mr-1 animate-spin" />
            ) : (
              <RefreshCw size={13} className="mr-1" />
            )}
            Retry
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => handleAction("resolve")}
            disabled={loading !== null}
          >
            {loading === "resolve" ? (
              <Loader2 size={13} className="mr-1 animate-spin" />
            ) : (
              <CheckCircle size={13} className="mr-1" />
            )}
            Mark resolved
          </Button>
          <button
            className="ml-auto text-xs text-blue-500 hover:underline"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </button>
        </div>
      )}

      <div className="rounded-lg border bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-slate-50">
              <th className="px-4 py-3 w-10">
                <input
                  type="checkbox"
                  checked={selected.size === records.length && records.length > 0}
                  onChange={toggleAll}
                  className="rounded"
                />
              </th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">Integration</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">Table</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">Source ID</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">Error</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600">Retries</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600">Date</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr
                key={r.id}
                className={`border-b last:border-b-0 transition-colors ${
                  selected.has(r.id) ? "bg-blue-50" : "hover:bg-slate-50"
                }`}
              >
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => toggleSelect(r.id)}
                    className="rounded"
                  />
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 capitalize">
                    {r.sourceApp}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-600">{r.sourceTable}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-500 max-w-[140px] truncate">
                  {r.sourceId}
                </td>
                <td className="px-4 py-3 text-red-600 text-xs max-w-[260px]">
                  <span title={r.errorReason} className="line-clamp-2">
                    {r.errorReason}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-slate-600">{r.retryCount}</td>
                <td className="px-4 py-3 text-right text-slate-400 text-xs whitespace-nowrap">
                  {new Date(r.createdAt).toLocaleDateString("en-GB", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400 text-right">
        Showing {records.length} of {total} unresolved records
      </p>
    </div>
  );
}
