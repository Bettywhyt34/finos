"use client";

import { useState }                                    from "react";
import { Pencil, X, AlertTriangle, Info }              from "lucide-react";
import { toast }                                       from "sonner";
import type { TransactionNumberSeriesRow }             from "@/lib/customization/service";
import { moduleDisplayLabel, MODULE_GROUPS, previewTransactionNumber } from "@/lib/customization/service";
import { cn }                                          from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type DrawerMode = "edit" | null;

interface Props {
  initialSeries: TransactionNumberSeriesRow[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const RESTART_FREQ_LABELS: Record<string, string> = {
  NEVER:   "Never",
  MONTHLY: "Monthly",
  YEARLY:  "Yearly",
};

// ─── Component ────────────────────────────────────────────────────────────────

export function TransactionNumberSeriesClient({ initialSeries }: Props) {
  const [series,      setSeries]      = useState<TransactionNumberSeriesRow[]>(initialSeries);
  const [drawerMode,  setDrawerMode]  = useState<DrawerMode>(null);
  const [selected,    setSelected]    = useState<TransactionNumberSeriesRow | null>(null);
  const [saving,      setSaving]      = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);

  // Drawer form fields
  const [fieldPrefix,      setFieldPrefix]      = useState("");
  const [fieldNextNumber,  setFieldNextNumber]  = useState("");
  const [fieldPadLength,   setFieldPadLength]   = useState("");
  const [fieldRestartFreq, setFieldRestartFreq] = useState("NEVER");
  const [fieldIsEnabled,   setFieldIsEnabled]   = useState(true);

  // ── Open / close ────────────────────────────────────────────────────────────

  function openEdit(row: TransactionNumberSeriesRow) {
    setSelected(row);
    setFieldPrefix(row.prefix);
    setFieldNextNumber(String(row.nextNumber));
    setFieldPadLength(String(row.padLength));
    setFieldRestartFreq(row.restartFreq);
    setFieldIsEnabled(row.isEnabled);
    setDrawerError(null);
    setDrawerMode("edit");
  }

  function closeDrawer() {
    setDrawerMode(null);
    setSelected(null);
    setDrawerError(null);
  }

  // ── Live preview in drawer ───────────────────────────────────────────────────

  const drawerPreview = previewTransactionNumber({
    prefix:     fieldPrefix.trim(),
    nextNumber: parseInt(fieldNextNumber, 10) || 1,
    padLength:  parseInt(fieldPadLength, 10)  || 5,
  });

  // ── Validation ──────────────────────────────────────────────────────────────

  function validate(): string | null {
    const next = parseInt(fieldNextNumber, 10);
    const pad  = parseInt(fieldPadLength, 10);
    if (isNaN(next) || next < 1)       return "Next number must be at least 1.";
    if (isNaN(pad) || pad < 1 || pad > 10) return "Pad length must be between 1 and 10.";
    if (fieldPrefix.trim().length > 20) return "Prefix must be 20 characters or fewer.";
    return null;
  }

  // ── Save ────────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!selected) return;
    const err = validate();
    if (err) { setDrawerError(err); return; }

    setSaving(true); setDrawerError(null);
    try {
      const res = await fetch(
        `/api/settings/customization/transaction-number-series/${selected.id}`,
        {
          method:  "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prefix:      fieldPrefix.trim(),
            nextNumber:  parseInt(fieldNextNumber, 10),
            padLength:   parseInt(fieldPadLength, 10),
            restartFreq: fieldRestartFreq,
            isEnabled:   fieldIsEnabled,
          }),
        },
      );
      const json = await res.json() as { data?: TransactionNumberSeriesRow; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to update series.");

      setSeries((prev) =>
        prev.map((s) => (s.id === json.data!.id ? json.data! : s))
      );
      toast.success(`${moduleDisplayLabel(selected.module)} series updated.`);
      closeDrawer();
    } catch (e) {
      setDrawerError(e instanceof Error ? e.message : "Unexpected error.");
    } finally {
      setSaving(false);
    }
  }

  // ── Ordered series with group structure ─────────────────────────────────────

  const byModule = Object.fromEntries(series.map((s) => [s.module, s]));

  return (
    <div className="px-8 py-8">

      {/* ── Page header ── */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Transaction Number Series</h1>
        <p className="mt-1 text-sm text-slate-500 max-w-xl">
          Configure the prefix and sequence for transaction numbers across all modules.
          Changes take effect for the next transaction created.
        </p>
      </div>

      {/* ── Info callout ── */}
      <div className="flex items-start gap-3 p-3.5 bg-blue-50 border border-blue-100 rounded-lg mb-6">
        <Info className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
        <p className="text-sm text-blue-700">
          Existing transactions are not renumbered when you change the series.
          Set the <span className="font-medium">Next Number</span> to a value
          higher than your current highest transaction number to avoid collisions.
        </p>
      </div>

      {/* ── Tables by group ── */}
      <div className="space-y-8">
        {MODULE_GROUPS.map((group) => {
          const rows = group.modules.map((m) => byModule[m]).filter(Boolean) as TransactionNumberSeriesRow[];
          if (rows.length === 0) return null;
          return (
            <div key={group.label}>
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
                {group.label}
              </h2>
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[560px]">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Transaction
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                          Prefix
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                          Next No.
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Example
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Status
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr
                          key={row.id}
                          className={cn(
                            "border-b border-slate-50 last:border-0 hover:bg-slate-50/60 transition-colors",
                            !row.isEnabled && "opacity-50"
                          )}
                        >
                          <td className="px-4 py-3 font-medium text-slate-800">
                            {moduleDisplayLabel(row.module)}
                          </td>
                          <td className="px-4 py-3">
                            <code className="text-xs bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-mono">
                              {row.prefix || "—"}
                            </code>
                          </td>
                          <td className="px-4 py-3 text-slate-600 tabular-nums">
                            {row.nextNumber.toLocaleString()}
                          </td>
                          <td className="px-4 py-3">
                            <code className="text-xs text-[var(--finos-accent)] font-mono font-medium">
                              {previewTransactionNumber(row)}
                            </code>
                          </td>
                          <td className="px-4 py-3">
                            <span className={cn(
                              "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
                              row.isEnabled
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-slate-100 text-slate-500"
                            )}>
                              {row.isEnabled ? "Enabled" : "Disabled"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => openEdit(row)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-md hover:bg-slate-50 transition-colors"
                            >
                              <Pencil className="h-3 w-3" />
                              Edit
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Edit Drawer ── */}
      {drawerMode === "edit" && selected && (
        <div className="fixed inset-0 z-[60] flex">
          {/* Backdrop */}
          <div className="flex-1 bg-black/30" onClick={closeDrawer} />

          {/* Panel */}
          <div className="w-[440px] bg-white h-full shadow-2xl flex flex-col">

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Edit Number Series
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {moduleDisplayLabel(selected.module)}
                </p>
              </div>
              <button type="button" onClick={closeDrawer} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">

              {/* Error banner */}
              {drawerError && (
                <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                  <p className="text-sm text-red-700">{drawerError}</p>
                </div>
              )}

              {/* Live preview */}
              <div className="flex items-center justify-between p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
                <span className="text-sm text-slate-500">Example number:</span>
                <code className="text-sm font-mono font-semibold text-[var(--finos-accent)]">
                  {drawerPreview}
                </code>
              </div>

              {/* Prefix */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Prefix
                </label>
                <input
                  type="text"
                  value={fieldPrefix}
                  onChange={(e) => setFieldPrefix(e.target.value)}
                  maxLength={20}
                  placeholder="e.g. INV"
                  className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25"
                />
                <p className="mt-1 text-xs text-slate-400">
                  Leave blank to use numbers only. Max 20 characters.
                </p>
              </div>

              {/* Next Number */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Next Number <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  value={fieldNextNumber}
                  onChange={(e) => setFieldNextNumber(e.target.value)}
                  min={1}
                  className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25"
                />
                <p className="mt-1 text-xs text-slate-400">
                  The next transaction will receive this number. Must be ≥ 1.
                </p>
              </div>

              {/* Pad Length */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Pad Length <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  value={fieldPadLength}
                  onChange={(e) => setFieldPadLength(e.target.value)}
                  min={1}
                  max={10}
                  className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25"
                />
                <p className="mt-1 text-xs text-slate-400">
                  Zero-pad the number to this many digits (1–10). e.g. pad 5 → 00001.
                </p>
              </div>

              {/* Restart Frequency */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Reset Sequence
                </label>
                <select
                  value={fieldRestartFreq}
                  onChange={(e) => setFieldRestartFreq(e.target.value)}
                  className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25"
                >
                  <option value="NEVER">Never reset</option>
                  <option value="MONTHLY">Reset monthly</option>
                  <option value="YEARLY">Reset yearly</option>
                </select>
              </div>

              {/* Enabled toggle */}
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={fieldIsEnabled}
                  onChange={(e) => setFieldIsEnabled(e.target.checked)}
                  className="mt-0.5 accent-[var(--finos-accent)]"
                />
                <span className="text-sm text-slate-700">
                  Enable auto-numbering for this module
                </span>
              </label>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-3 shrink-0">
              <button
                type="button"
                onClick={closeDrawer}
                className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-md hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-white bg-[var(--finos-accent)] rounded-md hover:opacity-90 transition-opacity disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
