"use client";

import { useState }             from "react";
import { Plus, X, Lock, AlertTriangle } from "lucide-react";
import { toast }                from "sonner";
import type { PaymentTermRow }  from "@/lib/setup-configurations/service";
import { cn }                   from "@/lib/utils";

// ─── Constants ────────────────────────────────────────────────────────────────

const DUE_TYPE_LABELS: Record<string, string> = {
  DUE_ON_RECEIPT:  "Due on Receipt",
  FIXED_DAYS:      "Fixed number of days",
  END_OF_MONTH:    "End of current month",
  END_OF_NEXT_MONTH: "End of next month",
};

const APPLIES_TO_LABELS: Record<string, string> = {
  CUSTOMERS: "Customers",
  VENDORS:   "Vendors",
  BOTH:      "Both",
};

function termSummary(row: PaymentTermRow): string {
  switch (row.dueType) {
    case "DUE_ON_RECEIPT":    return "Due immediately on receipt";
    case "FIXED_DAYS":        return `Net ${row.dueInDays ?? "?"} — payment due in ${row.dueInDays} day${row.dueInDays === 1 ? "" : "s"}`;
    case "END_OF_MONTH":      return "Due on the last day of the current month";
    case "END_OF_NEXT_MONTH": return "Due on the last day of next month";
    default:                  return row.dueType;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

type DrawerMode = "new" | "view" | "edit" | null;

interface Props {
  initialTerms: PaymentTermRow[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PaymentTermsClient({ initialTerms }: Props) {
  const [terms,      setTerms]      = useState<PaymentTermRow[]>(initialTerms);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>(null);
  const [selected,   setSelected]   = useState<PaymentTermRow | null>(null);
  const [saving,     setSaving]     = useState(false);
  const [drawerError,setDrawerError]= useState<string | null>(null);

  // Form fields
  const [fieldName,      setFieldName]      = useState("");
  const [fieldDueType,   setFieldDueType]   = useState("FIXED_DAYS");
  const [fieldDueInDays, setFieldDueInDays] = useState("");
  const [fieldAppliesTo, setFieldAppliesTo] = useState("BOTH");
  const [fieldIsActive,  setFieldIsActive]  = useState("active");
  const [fieldIsDefault, setFieldIsDefault] = useState(false);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function openNew() {
    setFieldName(""); setFieldDueType("FIXED_DAYS"); setFieldDueInDays("");
    setFieldAppliesTo("BOTH"); setFieldIsActive("active"); setFieldIsDefault(false);
    setDrawerError(null); setSelected(null); setDrawerMode("new");
  }

  function openTerm(row: PaymentTermRow) {
    setSelected(row);
    if (row.isSystem) {
      setDrawerMode("view");
    } else {
      setFieldName(row.name);
      setFieldDueType(row.dueType);
      setFieldDueInDays(row.dueInDays != null ? String(row.dueInDays) : "");
      setFieldAppliesTo(row.appliesTo);
      setFieldIsActive(row.isActive ? "active" : "inactive");
      setFieldIsDefault(row.isDefault);
      setDrawerMode("edit");
    }
    setDrawerError(null);
  }

  function closeDrawer() {
    setDrawerMode(null); setSelected(null); setDrawerError(null);
  }

  function buildPayload() {
    return {
      name:      fieldName.trim(),
      dueType:   fieldDueType,
      dueInDays: fieldDueType === "FIXED_DAYS" ? parseInt(fieldDueInDays, 10) : null,
      appliesTo: fieldAppliesTo,
      isDefault: fieldIsDefault,
      isActive:  fieldIsActive === "active",
    };
  }

  function validate(): string | null {
    if (!fieldName.trim())                                    return "Term name is required.";
    if (!fieldDueType)                                        return "Due type is required.";
    if (fieldDueType === "FIXED_DAYS") {
      const n = parseInt(fieldDueInDays, 10);
      if (isNaN(n) || n < 0)                                 return "Due In Days must be a non-negative number.";
      if (n > 365)                                           return "Due In Days cannot exceed 365.";
    }
    return null;
  }

  // ── Save new ────────────────────────────────────────────────────────────────

  async function handleCreate() {
    const err = validate();
    if (err) { setDrawerError(err); return; }

    setSaving(true); setDrawerError(null);
    try {
      const res = await fetch("/api/settings/setup-configurations/payment-terms", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(buildPayload()),
      });
      const json = await res.json() as { data?: PaymentTermRow; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to create payment term.");

      const newTerm = json.data!;

      // If new term is default, clear the flag on the previous default in local state
      setTerms((prev) => {
        const cleared = newTerm.isDefault
          ? prev.map((t) => ({ ...t, isDefault: false }))
          : [...prev];
        return [...cleared, newTerm].sort((a, b) => {
          if (a.isSystem !== b.isSystem) return a.isSystem ? -1 : 1;
          return (a.dueInDays ?? 999) - (b.dueInDays ?? 999) || a.name.localeCompare(b.name);
        });
      });
      toast.success("Payment term created.");
      closeDrawer();
    } catch (e) {
      setDrawerError(e instanceof Error ? e.message : "Unexpected error.");
    } finally {
      setSaving(false);
    }
  }

  // ── Save edit ───────────────────────────────────────────────────────────────

  async function handleUpdate() {
    if (!selected) return;
    const err = validate();
    if (err) { setDrawerError(err); return; }

    setSaving(true); setDrawerError(null);
    try {
      const payload = buildPayload();
      const res = await fetch(
        `/api/settings/setup-configurations/payment-terms/${selected.id}`,
        {
          method:  "PATCH",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(payload),
        },
      );
      const json = await res.json() as { data?: PaymentTermRow; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to update payment term.");

      const updated = json.data!;

      setTerms((prev) => {
        const cleared = updated.isDefault
          ? prev.map((t) => ({ ...t, isDefault: t.id === updated.id ? true : false }))
          : prev;
        return cleared.map((t) => (t.id === updated.id ? updated : t));
      });
      toast.success("Payment term updated.");
      closeDrawer();
    } catch (e) {
      setDrawerError(e instanceof Error ? e.message : "Unexpected error.");
    } finally {
      setSaving(false);
    }
  }

  // ── Set default (from system term view) ─────────────────────────────────────

  async function handleSetDefault(termId: string) {
    setSaving(true); setDrawerError(null);
    try {
      const res = await fetch(
        `/api/settings/setup-configurations/payment-terms/${termId}`,
        {
          method:  "PATCH",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ isDefault: true }),
        },
      );
      const json = await res.json() as { data?: PaymentTermRow; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to set default.");

      const updated = json.data!;
      setTerms((prev) =>
        prev.map((t) => ({
          ...t,
          isDefault: t.id === updated.id,
        }))
      );
      // Refresh selected
      setSelected(updated);
      toast.success(`"${updated.name}" is now the default payment term.`);
    } catch (e) {
      setDrawerError(e instanceof Error ? e.message : "Unexpected error.");
    } finally {
      setSaving(false);
    }
  }

  // ── Deactivate ──────────────────────────────────────────────────────────────

  async function handleDeactivate(termId: string) {
    setSaving(true); setDrawerError(null);
    try {
      const res = await fetch(
        `/api/settings/setup-configurations/payment-terms/${termId}`,
        { method: "DELETE" },
      );
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to deactivate payment term.");

      setTerms((prev) =>
        prev.map((t) => (t.id === termId ? { ...t, isActive: false } : t))
      );
      toast.success("Payment term deactivated.");
      closeDrawer();
    } catch (e) {
      setDrawerError(e instanceof Error ? e.message : "Unexpected error.");
    } finally {
      setSaving(false);
    }
  }

  // ── Visible terms ────────────────────────────────────────────────────────────
  // Show all terms; inactive ones are visually muted

  return (
    <div className="px-8 py-8">

      {/* ── Page header ── */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Payment Terms</h1>
          <p className="mt-1 text-sm text-slate-500 max-w-xl">
            Define standard payment terms used across customers, vendors, invoices, and bills.
          </p>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[var(--finos-accent)] rounded-md hover:opacity-90 transition-opacity shrink-0 ml-4"
        >
          <Plus className="h-4 w-4" />
          New Payment Term
        </button>
      </div>

      {/* ── Table ── */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[480px]">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide w-full">
                Terms
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {terms.length === 0 ? (
              <tr>
                <td colSpan={2} className="px-4 py-12 text-center text-sm text-slate-400">
                  No payment terms found. Create your first payment term to standardise due dates.
                </td>
              </tr>
            ) : (
              terms.map((row) => (
                <tr
                  key={row.id}
                  className={cn(
                    "border-b border-slate-50 last:border-0 hover:bg-slate-50/60 cursor-pointer",
                    !row.isActive && "opacity-50"
                  )}
                  onClick={() => openTerm(row)}
                >
                  {/* TERMS column */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[var(--finos-accent)] font-medium hover:underline">
                        {row.name}
                      </span>
                      {row.isSystem && (
                        <Lock className="h-3 w-3 text-slate-400 shrink-0" aria-label="System term" />
                      )}
                      {row.isDefault && (
                        <span className="px-1.5 py-0.5 text-[11px] font-medium bg-emerald-50 text-emerald-700 rounded-full border border-emerald-100">
                          Default
                        </span>
                      )}
                    </div>
                  </td>

                  {/* STATUS column */}
                  <td className="px-4 py-3">
                    <span className={cn(
                      "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
                      row.isActive
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-slate-100 text-slate-500"
                    )}>
                      {row.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </div>

      {/* ── Drawer ── */}
      {drawerMode && (
        <div className="fixed inset-0 z-[60] flex">
          {/* Backdrop */}
          <div className="flex-1 bg-black/30" onClick={closeDrawer} />

          {/* Panel */}
          <div className="w-[440px] bg-white h-full shadow-2xl flex flex-col">

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
              <h2 className="text-base font-semibold text-slate-900">
                {drawerMode === "new"  ? "New Payment Term"  :
                 drawerMode === "view" ? "Payment Term Details" :
                                        "Edit Payment Term"}
              </h2>
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

              {/* ── VIEW mode (system term) ── */}
              {drawerMode === "view" && selected && (
                <>
                  <div className="flex items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    <Lock className="h-4 w-4 text-slate-400 shrink-0" />
                    <p className="text-sm text-slate-500">
                      This is a system payment term and cannot be edited.
                    </p>
                  </div>

                  <DetailRow label="Term Name"  value={selected.name} />
                  <DetailRow label="Due Type"   value={DUE_TYPE_LABELS[selected.dueType] ?? selected.dueType} />
                  {selected.dueInDays != null && (
                    <DetailRow label="Due In Days" value={String(selected.dueInDays)} />
                  )}
                  <DetailRow label="Applies To" value={APPLIES_TO_LABELS[selected.appliesTo] ?? selected.appliesTo} />
                  <DetailRow label="Status"     value={selected.isActive ? "Active" : "Inactive"} />
                  <DetailRow label="Default"    value={selected.isDefault ? "Yes" : "No"} />

                  <div className="pt-1 border-t border-slate-100 text-xs text-slate-400 font-mono">
                    <p>Rule: {termSummary(selected)}</p>
                  </div>
                </>
              )}

              {/* ── NEW / EDIT mode ── */}
              {(drawerMode === "new" || drawerMode === "edit") && (
                <>
                  {/* Term Name */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      Term Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={fieldName}
                      onChange={(e) => setFieldName(e.target.value)}
                      placeholder="e.g. Net 30"
                      className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25"
                    />
                  </div>

                  {/* Due Type */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      Due Type <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={fieldDueType}
                      onChange={(e) => { setFieldDueType(e.target.value); setFieldDueInDays(""); }}
                      className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25"
                    >
                      <option value="DUE_ON_RECEIPT">Due on Receipt</option>
                      <option value="FIXED_DAYS">Fixed number of days</option>
                      <option value="END_OF_MONTH">End of current month</option>
                      <option value="END_OF_NEXT_MONTH">End of next month</option>
                    </select>
                  </div>

                  {/* Due In Days — conditional */}
                  {fieldDueType === "FIXED_DAYS" && (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">
                        Due In Days <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="number"
                        value={fieldDueInDays}
                        min={0}
                        max={365}
                        onChange={(e) => setFieldDueInDays(e.target.value)}
                        placeholder="e.g. 30"
                        className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25"
                      />
                      {fieldDueInDays && !isNaN(parseInt(fieldDueInDays, 10)) && parseInt(fieldDueInDays, 10) >= 0 && (
                        <p className="mt-1 text-xs text-slate-400">
                          Payment due in {fieldDueInDays} day{fieldDueInDays === "1" ? "" : "s"} from the transaction date.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Applies To */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      Applies To
                    </label>
                    <select
                      value={fieldAppliesTo}
                      onChange={(e) => setFieldAppliesTo(e.target.value)}
                      className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25"
                    >
                      <option value="BOTH">Both (Customers &amp; Vendors)</option>
                      <option value="CUSTOMERS">Customers only</option>
                      <option value="VENDORS">Vendors only</option>
                    </select>
                  </div>

                  {/* Status (edit mode only) */}
                  {drawerMode === "edit" && (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">
                        Status
                      </label>
                      <select
                        value={fieldIsActive}
                        onChange={(e) => setFieldIsActive(e.target.value)}
                        disabled={selected?.isDefault}
                        className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                      {selected?.isDefault && (
                        <p className="mt-1 text-xs text-slate-400">
                          Default terms cannot be deactivated. Set another term as default first.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Make Default */}
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={fieldIsDefault}
                      onChange={(e) => setFieldIsDefault(e.target.checked)}
                      className="mt-0.5 accent-[var(--finos-accent)]"
                    />
                    <span className="text-sm text-slate-700">
                      Make this the default payment term for new customers and vendors
                    </span>
                  </label>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">

              {/* Left side — deactivate (edit mode only, non-system, non-default) */}
              <div>
                {drawerMode === "edit" && selected && !selected.isSystem && !selected.isDefault && (
                  <button
                    type="button"
                    onClick={() => handleDeactivate(selected.id)}
                    disabled={saving}
                    className="text-sm text-slate-500 hover:text-red-600 transition-colors disabled:opacity-50"
                  >
                    Deactivate
                  </button>
                )}

                {/* Set as Default — view mode */}
                {drawerMode === "view" && selected && !selected.isDefault && (
                  <button
                    type="button"
                    onClick={() => handleSetDefault(selected.id)}
                    disabled={saving}
                    className="px-4 py-2 text-sm font-medium text-[var(--finos-accent)] border border-[var(--finos-accent)] rounded-md hover:bg-[var(--finos-accent)]/5 transition-colors disabled:opacity-50"
                  >
                    Set as Default
                  </button>
                )}
              </div>

              {/* Right side */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={closeDrawer}
                  className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-md hover:bg-slate-50 transition-colors"
                >
                  {drawerMode === "view" ? "Close" : "Cancel"}
                </button>

                {drawerMode !== "view" && (
                  <button
                    type="button"
                    onClick={drawerMode === "new" ? handleCreate : handleUpdate}
                    disabled={saving}
                    className="px-4 py-2 text-sm font-medium text-white bg-[var(--finos-accent)] rounded-md hover:opacity-90 transition-opacity disabled:opacity-60"
                  >
                    {saving ? "Saving…" : drawerMode === "new" ? "Create" : "Save Changes"}
                  </button>
                )}
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

// ─── Small helper for detail rows ─────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 border-b border-slate-50 last:border-0">
      <span className="text-sm text-slate-500 shrink-0">{label}</span>
      <span className="text-sm font-medium text-slate-800 text-right">{value}</span>
    </div>
  );
}
