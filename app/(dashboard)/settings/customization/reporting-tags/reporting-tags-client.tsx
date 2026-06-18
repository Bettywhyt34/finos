"use client";

import { useState }                                from "react";
import {
  Plus, X, Pencil, Trash2, Tag, Info, AlertTriangle,
  ChevronDown, ChevronUp, Circle,
} from "lucide-react";
import { toast }                                   from "sonner";
import { cn }                                      from "@/lib/utils";
import {
  SCOPE_LABELS,
  ALL_SCOPES,
  type ReportingTagRow,
  type ReportingTagOptionRow,
} from "@/lib/customization/reporting-tags-types";
import type { ReportingTagEntityScope }            from "@prisma/client";

// ─── Types ────────────────────────────────────────────────────────────────────

type DrawerMode = "view" | "new" | "edit" | null;

interface Props {
  initialTags: ReportingTagRow[];
}

// ─── Colour swatch palette ────────────────────────────────────────────────────

const COLOR_SWATCHES = [
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#14b8a6", "#3b82f6", "#8b5cf6", "#ec4899",
  "#64748b", "#0f172a",
];

function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (c: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {COLOR_SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={cn(
            "w-6 h-6 rounded-full border-2 transition-transform",
            value === c ? "border-slate-900 scale-110" : "border-transparent hover:scale-105",
          )}
          style={{ backgroundColor: c }}
        />
      ))}
      <button
        type="button"
        onClick={() => onChange("")}
        className="w-6 h-6 rounded-full border-2 border-slate-200 bg-white flex items-center justify-center text-slate-400 hover:border-slate-400 transition-colors"
        title="No colour"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

// ─── Scope badge ──────────────────────────────────────────────────────────────

function ScopeBadge({ scope }: { scope: ReportingTagEntityScope }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600">
      {SCOPE_LABELS[scope]}
    </span>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ isActive }: { isActive: boolean }) {
  return isActive ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700">
      <Circle className="h-1.5 w-1.5 fill-emerald-500" />
      Active
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-500">
      <Circle className="h-1.5 w-1.5 fill-slate-400" />
      Inactive
    </span>
  );
}

// ─── Option chip (inline display) ─────────────────────────────────────────────

function OptionChip({ option }: { option: ReportingTagOptionRow }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border",
        option.isActive
          ? "bg-white border-slate-200 text-slate-700"
          : "bg-slate-50 border-slate-100 text-slate-400 line-through",
      )}
    >
      {option.color && (
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: option.color }}
        />
      )}
      {option.name}
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ReportingTagsClient({ initialTags }: Props) {
  const [tags, setTags]               = useState<ReportingTagRow[]>(initialTags);
  const [drawerMode, setDrawerMode]   = useState<DrawerMode>(null);
  const [selected, setSelected]       = useState<ReportingTagRow | null>(null);
  const [saving, setSaving]           = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // ── New / Edit form state ──────────────────────────────────────────────────
  const [formName, setFormName]           = useState("");
  const [formDesc, setFormDesc]           = useState("");
  const [formColor, setFormColor]         = useState("");
  const [formActive, setFormActive]       = useState(true);
  const [formScopes, setFormScopes]       = useState<ReportingTagEntityScope[]>([]);

  // Options within the drawer
  const [drawerOptions, setDrawerOptions]       = useState<ReportingTagOptionRow[]>([]);
  const [newOptName, setNewOptName]             = useState("");
  const [newOptColor, setNewOptColor]           = useState("");
  const [addingOpt, setAddingOpt]               = useState(false);
  const [editOptId, setEditOptId]               = useState<string | null>(null);
  const [editOptName, setEditOptName]           = useState("");
  const [editOptColor, setEditOptColor]         = useState("");

  // ── Helpers ───────────────────────────────────────────────────────────────

  function resetForm(tag?: ReportingTagRow) {
    setFormName(tag?.name ?? "");
    setFormDesc(tag?.description ?? "");
    setFormColor(tag?.color ?? "");
    setFormActive(tag?.isActive ?? true);
    setFormScopes(tag?.appliesTo ?? []);
    setDrawerOptions(tag?.options ?? []);
    setNewOptName("");
    setNewOptColor("");
    setAddingOpt(false);
    setEditOptId(null);
    setDrawerError(null);
  }

  function openNew() {
    resetForm();
    setSelected(null);
    setDrawerMode("new");
  }

  function openEdit(tag: ReportingTagRow) {
    resetForm(tag);
    setSelected(tag);
    setDrawerMode("edit");
  }

  function openView(tag: ReportingTagRow) {
    resetForm(tag);
    setSelected(tag);
    setDrawerMode("view");
  }

  function closeDrawer() {
    setDrawerMode(null);
    setSelected(null);
    setDrawerError(null);
  }

  function toggleScope(scope: ReportingTagEntityScope) {
    setFormScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  }

  // ── API actions ───────────────────────────────────────────────────────────

  async function handleCreate() {
    if (!formName.trim()) { setDrawerError("Tag name is required."); return; }
    setSaving(true); setDrawerError(null);
    try {
      const res = await fetch("/api/settings/customization/reporting-tags", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:        formName.trim(),
          description: formDesc.trim() || undefined,
          color:       formColor || undefined,
          isActive:    formActive,
          appliesTo:   formScopes,
        }),
      });
      const json = await res.json() as { data?: ReportingTagRow; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to create tag.");

      setTags((prev) => [...prev, json.data!].sort((a, b) => a.name.localeCompare(b.name)));
      toast.success(`"${json.data!.name}" created.`);
      closeDrawer();
    } catch (e) {
      setDrawerError(e instanceof Error ? e.message : "Unexpected error.");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate() {
    if (!selected) return;
    if (!formName.trim()) { setDrawerError("Tag name is required."); return; }
    setSaving(true); setDrawerError(null);
    try {
      const res = await fetch(`/api/settings/customization/reporting-tags/${selected.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:        formName.trim(),
          description: formDesc.trim() || undefined,
          color:       formColor || undefined,
          isActive:    formActive,
          appliesTo:   formScopes,
        }),
      });
      const json = await res.json() as { data?: ReportingTagRow; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to update tag.");

      setTags((prev) =>
        prev.map((t) => (t.id === selected.id ? json.data! : t))
            .sort((a, b) => a.name.localeCompare(b.name)),
      );
      toast.success(`"${json.data!.name}" updated.`);
      closeDrawer();
    } catch (e) {
      setDrawerError(e instanceof Error ? e.message : "Unexpected error.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(tagId: string) {
    setActionLoading(tagId);
    try {
      const res = await fetch(`/api/settings/customization/reporting-tags/${tagId}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      });
      const json = await res.json() as { data?: ReportingTagRow; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed.");

      setTags((prev) => prev.map((t) => (t.id === tagId ? json.data! : t)));
      toast.success("Tag deactivated.");
      if (drawerMode !== null && selected?.id === tagId) closeDrawer();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to deactivate.");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDelete(tagId: string) {
    const tag = tags.find((t) => t.id === tagId);
    if (!window.confirm(
      tag?.options?.length
        ? `"${tag.name}" has ${tag.options.length} option(s). Deleting is blocked — deactivate instead.`
        : `Permanently delete "${tag?.name}"? This cannot be undone.`,
    )) return;

    setActionLoading(tagId);
    try {
      const res = await fetch(`/api/settings/customization/reporting-tags/${tagId}`, {
        method: "DELETE",
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed.");

      setTags((prev) => prev.filter((t) => t.id !== tagId));
      toast.success("Tag deleted.");
      if (drawerMode !== null && selected?.id === tagId) closeDrawer();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete.");
    } finally {
      setActionLoading(null);
    }
  }

  // ── Option actions (within drawer) ────────────────────────────────────────

  async function handleAddOption() {
    if (!selected && drawerMode === "view") return;
    const tagId = selected?.id;
    if (!tagId) return;
    if (!newOptName.trim()) { setDrawerError("Option name is required."); return; }
    setDrawerError(null);
    try {
      const res = await fetch(`/api/settings/customization/reporting-tags/${tagId}/options`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newOptName.trim(), color: newOptColor || undefined }),
      });
      const json = await res.json() as { data?: ReportingTagOptionRow; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed.");

      setDrawerOptions((prev) => [...prev, json.data!]);
      setTags((prev) =>
        prev.map((t) =>
          t.id === tagId ? { ...t, options: [...t.options, json.data!] } : t,
        ),
      );
      setNewOptName(""); setNewOptColor(""); setAddingOpt(false);
      toast.success(`Option "${json.data!.name}" added.`);
    } catch (e) {
      setDrawerError(e instanceof Error ? e.message : "Unexpected error.");
    }
  }

  async function handleSaveEditOption(tagId: string) {
    if (!editOptId) return;
    if (!editOptName.trim()) { setDrawerError("Option name is required."); return; }
    setDrawerError(null);
    try {
      const res = await fetch(
        `/api/settings/customization/reporting-tags/${tagId}/options/${editOptId}`,
        {
          method:  "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: editOptName.trim(), color: editOptColor || undefined }),
        },
      );
      const json = await res.json() as { data?: ReportingTagOptionRow; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed.");

      setDrawerOptions((prev) =>
        prev.map((o) => (o.id === editOptId ? json.data! : o)),
      );
      setTags((prev) =>
        prev.map((t) =>
          t.id === tagId
            ? { ...t, options: t.options.map((o) => (o.id === editOptId ? json.data! : o)) }
            : t,
        ),
      );
      setEditOptId(null); setEditOptName(""); setEditOptColor("");
      toast.success("Option updated.");
    } catch (e) {
      setDrawerError(e instanceof Error ? e.message : "Unexpected error.");
    }
  }

  async function handleDeactivateOption(tagId: string, optId: string) {
    try {
      const res = await fetch(
        `/api/settings/customization/reporting-tags/${tagId}/options/${optId}`,
        {
          method:  "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: false }),
        },
      );
      const json = await res.json() as { data?: ReportingTagOptionRow; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed.");

      setDrawerOptions((prev) => prev.map((o) => (o.id === optId ? json.data! : o)));
      setTags((prev) =>
        prev.map((t) =>
          t.id === tagId
            ? { ...t, options: t.options.map((o) => (o.id === optId ? json.data! : o)) }
            : t,
        ),
      );
      toast.success("Option deactivated.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed.");
    }
  }

  async function handleDeleteOption(tagId: string, optId: string, optName: string) {
    if (!window.confirm(`Delete option "${optName}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(
        `/api/settings/customization/reporting-tags/${tagId}/options/${optId}`,
        { method: "DELETE" },
      );
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed.");

      setDrawerOptions((prev) => prev.filter((o) => o.id !== optId));
      setTags((prev) =>
        prev.map((t) =>
          t.id === tagId ? { ...t, options: t.options.filter((o) => o.id !== optId) } : t,
        ),
      );
      toast.success("Option deleted.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed.");
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const isDrawerOpen = drawerMode !== null;

  return (
    <div className="flex min-h-full bg-[var(--app-bg)]">
      <main className="flex-1 px-8 py-8 min-w-0">

        {/* Page header */}
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Reporting Tags</h1>
            <p className="mt-1 text-sm text-slate-500 max-w-xl">
              Create custom tags to classify transactions and analyse performance by department,
              branch, project, cost centre, or any reporting dimension your organisation needs.
            </p>
          </div>
          <button
            type="button"
            onClick={openNew}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-white bg-[var(--finos-accent)] rounded-lg hover:opacity-90 transition-opacity shrink-0"
          >
            <Plus className="h-4 w-4" />
            New Reporting Tag
          </button>
        </div>

        {/* Info banner */}
        <div className="flex items-start gap-3 p-3.5 bg-amber-50 border border-amber-100 rounded-lg mb-6">
          <Info className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-700">
            Reporting tags are ready for setup. Transaction-form assignment and report filtering
            will be connected in a later stage.
          </p>
        </div>

        {/* Empty state */}
        {tags.length === 0 ? (
          <div className="text-center py-16 bg-white border border-dashed border-slate-200 rounded-xl">
            <Tag className="h-9 w-9 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-semibold text-slate-700">No reporting tags yet</p>
            <p className="text-xs text-slate-400 mt-1 mb-4">
              Create your first reporting tag to start classifying transactions for future reporting.
            </p>
            <button
              type="button"
              onClick={openNew}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-[var(--finos-accent)] rounded-lg hover:opacity-90 transition-opacity"
            >
              <Plus className="h-4 w-4" />
              New Reporting Tag
            </button>
          </div>
        ) : (
          /* Tags table */
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-4 py-3 font-medium text-slate-500 text-xs uppercase tracking-wide">
                    Tag Name
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500 text-xs uppercase tracking-wide">
                    Applies To
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500 text-xs uppercase tracking-wide">
                    Options
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500 text-xs uppercase tracking-wide">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500 text-xs uppercase tracking-wide">
                    Connected
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500 text-xs uppercase tracking-wide">
                    Last Updated
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tags.map((tag) => (
                  <tr
                    key={tag.id}
                    className="hover:bg-slate-50 transition-colors cursor-pointer"
                    onClick={() => openView(tag)}
                  >
                    {/* Name + color dot */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {tag.color ? (
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: tag.color }}
                          />
                        ) : (
                          <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-slate-200" />
                        )}
                        <span className="font-medium text-slate-800">{tag.name}</span>
                        {tag.isSystem && (
                          <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-medium">
                            System
                          </span>
                        )}
                      </div>
                      {tag.description && (
                        <p className="ml-4 mt-0.5 text-xs text-slate-400 truncate max-w-xs">
                          {tag.description}
                        </p>
                      )}
                    </td>

                    {/* Applies To */}
                    <td className="px-4 py-3">
                      {tag.appliesTo.length === 0 ? (
                        <span className="text-xs text-slate-400">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {tag.appliesTo.slice(0, 3).map((s) => (
                            <ScopeBadge key={s} scope={s} />
                          ))}
                          {tag.appliesTo.length > 3 && (
                            <span className="text-[11px] text-slate-400">
                              +{tag.appliesTo.length - 3}
                            </span>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Options count */}
                    <td className="px-4 py-3">
                      <span className="text-slate-600">
                        {tag.options.length === 0 ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          `${tag.options.filter((o) => o.isActive).length} active` +
                          (tag.options.some((o) => !o.isActive)
                            ? ` / ${tag.options.filter((o) => !o.isActive).length} inactive`
                            : "")
                        )}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <StatusBadge isActive={tag.isActive} />
                    </td>

                    {/* Connected */}
                    <td className="px-4 py-3">
                      <span className="text-xs text-slate-400">Not connected yet</span>
                    </td>

                    {/* Last updated */}
                    <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                      {new Date(tag.updatedAt).toLocaleDateString("en-GB", {
                        day: "2-digit", month: "short", year: "numeric",
                      })}
                    </td>

                    {/* Row actions */}
                    <td
                      className="px-4 py-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          type="button"
                          title="Edit"
                          disabled={!!actionLoading}
                          onClick={() => openEdit(tag)}
                          className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors disabled:opacity-50"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        {tag.isActive && (
                          <button
                            type="button"
                            title="Deactivate"
                            disabled={!!actionLoading}
                            onClick={() => handleDeactivate(tag.id)}
                            className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded transition-colors disabled:opacity-50"
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {tag.options.length === 0 && (
                          <button
                            type="button"
                            title="Delete"
                            disabled={!!actionLoading}
                            onClick={() => handleDelete(tag.id)}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* ── VIEW DRAWER ─────────────────────────────────────────────────────── */}
      {drawerMode === "view" && selected && (
        <DrawerOverlay onClose={closeDrawer}>
          <DrawerHeader
            title={selected.name}
            subtitle="Reporting Tag"
            onClose={closeDrawer}
          />

          <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
            {/* Color + name */}
            <div className="flex items-center gap-3">
              {selected.color && (
                <span
                  className="w-5 h-5 rounded-full shrink-0 border border-white shadow-sm"
                  style={{ backgroundColor: selected.color }}
                />
              )}
              <div>
                <p className="font-semibold text-slate-900">{selected.name}</p>
                {selected.description && (
                  <p className="text-sm text-slate-500 mt-0.5">{selected.description}</p>
                )}
              </div>
            </div>

            {/* Badges */}
            <div className="flex flex-wrap gap-2">
              <StatusBadge isActive={selected.isActive} />
              {selected.isSystem && (
                <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-500">
                  System
                </span>
              )}
            </div>

            {/* Applies To */}
            <dl className="space-y-3">
              <div>
                <dt className="text-xs font-medium text-slate-500 mb-1.5">Applies To</dt>
                {selected.appliesTo.length === 0 ? (
                  <p className="text-sm text-slate-400">No scope selected</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {selected.appliesTo.map((s) => (
                      <ScopeBadge key={s} scope={s} />
                    ))}
                  </div>
                )}
              </div>

              <div>
                <dt className="text-xs font-medium text-slate-500 mb-1.5">Connected Status</dt>
                <dd className="text-sm text-slate-400">Not connected yet</dd>
              </div>

              <div>
                <dt className="text-xs font-medium text-slate-500 mb-1.5">Last Updated</dt>
                <dd className="text-sm text-slate-700">
                  {new Date(selected.updatedAt).toLocaleDateString("en-GB", {
                    day: "2-digit", month: "long", year: "numeric",
                  })}
                </dd>
              </div>
            </dl>

            {/* Options list */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-slate-500">
                  Options ({selected.options.length})
                </p>
                <button
                  type="button"
                  onClick={() => { openEdit(selected); }}
                  className="text-xs text-[var(--finos-accent)] hover:underline"
                >
                  Manage
                </button>
              </div>
              {selected.options.length === 0 ? (
                <p className="text-sm text-slate-400">No options yet.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {selected.options.map((o) => (
                    <OptionChip key={o.id} option={o} />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Footer actions */}
          <div className="px-6 py-4 border-t border-slate-200 space-y-2 shrink-0">
            <button
              type="button"
              onClick={() => openEdit(selected)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[var(--finos-accent)] rounded-lg hover:opacity-90 transition-opacity"
            >
              <Pencil className="h-4 w-4" />
              Edit Tag
            </button>
            {selected.isActive && (
              <button
                type="button"
                disabled={!!actionLoading}
                onClick={() => handleDeactivate(selected.id)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-50 transition-colors disabled:opacity-60"
              >
                Deactivate
              </button>
            )}
            {selected.options.length === 0 && (
              <button
                type="button"
                disabled={!!actionLoading}
                onClick={() => handleDelete(selected.id)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-red-600 border border-red-100 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-60"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            )}
          </div>
        </DrawerOverlay>
      )}

      {/* ── NEW / EDIT DRAWER ────────────────────────────────────────────────── */}
      {(drawerMode === "new" || drawerMode === "edit") && (
        <DrawerOverlay onClose={closeDrawer}>
          <DrawerHeader
            title={drawerMode === "new" ? "New Reporting Tag" : `Edit: ${selected?.name ?? ""}`}
            subtitle={drawerMode === "new" ? "Create a reporting dimension" : "Update tag settings"}
            onClose={closeDrawer}
          />

          <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">

            {drawerError && (
              <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm text-red-700">{drawerError}</p>
              </div>
            )}

            {/* Tag Name */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Tag Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                maxLength={100}
                placeholder="e.g. Department"
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Description <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <textarea
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                maxLength={300}
                rows={2}
                placeholder="What this tag is used for"
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25 resize-none"
              />
            </div>

            {/* Color */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Colour <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <ColorPicker value={formColor} onChange={setFormColor} />
            </div>

            {/* Applies To */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Applies To
              </label>
              <div className="flex flex-wrap gap-2">
                {ALL_SCOPES.map((scope) => (
                  <button
                    key={scope}
                    type="button"
                    onClick={() => toggleScope(scope)}
                    className={cn(
                      "px-3 py-1.5 text-sm rounded-lg border transition-colors",
                      formScopes.includes(scope)
                        ? "border-[var(--finos-accent)] bg-[var(--finos-accent)]/5 text-[var(--finos-accent)] font-medium"
                        : "border-slate-200 text-slate-600 hover:border-slate-300",
                    )}
                  >
                    {SCOPE_LABELS[scope]}
                  </button>
                ))}
              </div>
              {formScopes.length === 0 && (
                <p className="mt-1.5 text-xs text-slate-400">
                  If no scope is selected, this tag will be available only after a scope is chosen.
                </p>
              )}
            </div>

            {/* Active toggle */}
            <div className="flex items-center justify-between py-1">
              <div>
                <p className="text-sm font-medium text-slate-700">Active</p>
                <p className="text-xs text-slate-400">
                  Inactive tags cannot be selected on new transactions.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFormActive((v) => !v)}
                className={cn(
                  "relative w-10 h-6 rounded-full transition-colors",
                  formActive ? "bg-[var(--finos-accent)]" : "bg-slate-200",
                )}
              >
                <span
                  className={cn(
                    "absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform",
                    formActive ? "translate-x-5" : "translate-x-1",
                  )}
                />
              </button>
            </div>

            {/* Options section (only in edit mode — tag must exist) */}
            {drawerMode === "edit" && selected && (
              <div className="border-t border-slate-100 pt-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-medium text-slate-700">
                    Options ({drawerOptions.length})
                  </p>
                  {!addingOpt && (
                    <button
                      type="button"
                      onClick={() => { setAddingOpt(true); setDrawerError(null); }}
                      className="inline-flex items-center gap-1 text-xs font-medium text-[var(--finos-accent)] hover:underline"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Option
                    </button>
                  )}
                </div>

                {/* Add new option row */}
                {addingOpt && (
                  <div className="mb-3 p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
                    <input
                      type="text"
                      value={newOptName}
                      onChange={(e) => setNewOptName(e.target.value)}
                      placeholder="Option name"
                      maxLength={100}
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25"
                      autoFocus
                    />
                    <div>
                      <p className="text-xs text-slate-500 mb-1.5">Option colour</p>
                      <ColorPicker value={newOptColor} onChange={setNewOptColor} />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleAddOption}
                        className="px-3 py-1.5 text-xs font-medium text-white bg-[var(--finos-accent)] rounded-lg hover:opacity-90"
                      >
                        Add
                      </button>
                      <button
                        type="button"
                        onClick={() => { setAddingOpt(false); setNewOptName(""); setNewOptColor(""); }}
                        className="px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-100"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Options list */}
                {drawerOptions.length === 0 ? (
                  <p className="text-sm text-slate-400">No options yet. Add the first one above.</p>
                ) : (
                  <div className="space-y-1.5">
                    {drawerOptions.map((opt) => (
                      <div
                        key={opt.id}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white"
                      >
                        {editOptId === opt.id ? (
                          /* Inline edit */
                          <div className="flex-1 space-y-2">
                            <input
                              type="text"
                              value={editOptName}
                              onChange={(e) => setEditOptName(e.target.value)}
                              maxLength={100}
                              className="w-full text-sm border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25"
                              autoFocus
                            />
                            <ColorPicker value={editOptColor} onChange={setEditOptColor} />
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => handleSaveEditOption(selected.id)}
                                className="px-2 py-1 text-xs font-medium text-white bg-[var(--finos-accent)] rounded hover:opacity-90"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => { setEditOptId(null); setEditOptName(""); setEditOptColor(""); }}
                                className="px-2 py-1 text-xs font-medium text-slate-600 border border-slate-200 rounded hover:bg-slate-100"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            {opt.color && (
                              <span
                                className="w-3 h-3 rounded-full shrink-0"
                                style={{ backgroundColor: opt.color }}
                              />
                            )}
                            <span className={cn(
                              "flex-1 text-sm",
                              opt.isActive ? "text-slate-700" : "text-slate-400 line-through",
                            )}>
                              {opt.name}
                            </span>
                            {!opt.isActive && (
                              <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                                Inactive
                              </span>
                            )}
                            <button
                              type="button"
                              title="Edit option"
                              onClick={() => {
                                setEditOptId(opt.id);
                                setEditOptName(opt.name);
                                setEditOptColor(opt.color ?? "");
                              }}
                              className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            {opt.isActive && (
                              <button
                                type="button"
                                title="Deactivate option"
                                onClick={() => handleDeactivateOption(selected.id, opt.id)}
                                className="p-1 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded"
                              >
                                <ChevronDown className="h-3 w-3" />
                              </button>
                            )}
                            <button
                              type="button"
                              title="Delete option"
                              onClick={() => handleDeleteOption(selected.id, opt.id, opt.name)}
                              className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Note about options for new tags */}
            {drawerMode === "new" && (
              <div className="flex items-start gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <Info className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
                <p className="text-sm text-slate-500">
                  Save the tag first, then open it to add options.
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-3 shrink-0">
            <button
              type="button"
              onClick={closeDrawer}
              className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={drawerMode === "new" ? handleCreate : handleUpdate}
              className="px-4 py-2 text-sm font-medium text-white bg-[var(--finos-accent)] rounded-lg hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              {saving ? "Saving…" : drawerMode === "new" ? "Create Tag" : "Save Changes"}
            </button>
          </div>
        </DrawerOverlay>
      )}

      {/* Dim overlay filler to prevent background scroll shift */}
      {isDrawerOpen && <div className="pointer-events-none" />}
    </div>
  );
}

// ─── Shared drawer chrome ─────────────────────────────────────────────────────

function DrawerOverlay({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-[460px] bg-white h-full shadow-2xl flex flex-col">
        {children}
      </div>
    </div>
  );
}

function DrawerHeader({
  title,
  subtitle,
  onClose,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="text-slate-400 hover:text-slate-600 transition-colors"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}
