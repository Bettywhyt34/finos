"use client";

import { useState }                         from "react";
import {
  Plus, X, Pencil, Trash2, Globe, Link2, Info, AlertTriangle,
  ExternalLink, Circle, ChevronDown,
} from "lucide-react";
import { toast }                            from "sonner";
import { cn }                               from "@/lib/utils";
import {
  TAB_TYPE_LABELS,
  PLACEMENT_LABELS,
  ALL_TAB_TYPES,
  ALL_PLACEMENTS,
  ALL_ROLES,
  type WebTabRow,
} from "@/lib/customization/web-tabs-types";
import type { WebTabType, WebTabPlacement } from "@prisma/client";

// ─── Types ────────────────────────────────────────────────────────────────────

type DrawerMode = "new" | "edit" | null;

interface Props {
  initialTabs: WebTabRow[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function TypeBadge({ type }: { type: WebTabType }) {
  return type === "EXTERNAL_URL" ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-blue-50 text-blue-700">
      <Globe className="h-2.5 w-2.5" />
      External
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600">
      <Link2 className="h-2.5 w-2.5" />
      Internal
    </span>
  );
}

// ─── Drawer sub-components ────────────────────────────────────────────────────

function DrawerOverlay({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div
        className="absolute inset-0 bg-black/20"
        onClick={onClose}
      />
      <aside className="relative z-50 w-[480px] bg-white shadow-2xl flex flex-col h-full">
        {children}
      </aside>
    </div>
  );
}

function DrawerHeader({
  title,
  subtitle,
  onClose,
}: {
  title:    string;
  subtitle: string;
  onClose:  () => void;
}) {
  return (
    <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
      <div>
        <p className="text-[15px] font-semibold text-slate-900">{title}</p>
        <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function WebTabsClient({ initialTabs }: Props) {
  const [tabs, setTabs]               = useState<WebTabRow[]>(initialTabs);
  const [drawerMode, setDrawerMode]   = useState<DrawerMode>(null);
  const [selected, setSelected]       = useState<WebTabRow | null>(null);
  const [saving, setSaving]           = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // ── Form state ─────────────────────────────────────────────────────────────
  const [formName,           setFormName]           = useState("");
  const [formDesc,           setFormDesc]           = useState("");
  const [formType,           setFormType]           = useState<WebTabType>("EXTERNAL_URL");
  const [formUrl,            setFormUrl]            = useState("");
  const [formPlacement,      setFormPlacement]      = useState<WebTabPlacement>("QUICK_LINKS");
  const [formIcon,           setFormIcon]           = useState("");
  const [formActive,         setFormActive]         = useState(true);
  const [formVisibleToRoles, setFormVisibleToRoles] = useState<string[]>([]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  function resetForm(tab?: WebTabRow) {
    setFormName(tab?.name ?? "");
    setFormDesc(tab?.description ?? "");
    setFormType(tab?.type ?? "EXTERNAL_URL");
    setFormUrl(tab?.url ?? "");
    setFormPlacement(tab?.placement ?? "QUICK_LINKS");
    setFormIcon(tab?.icon ?? "");
    setFormActive(tab?.isActive ?? true);
    setFormVisibleToRoles(tab?.visibleToRoles ?? []);
    setDrawerError(null);
  }

  function openNew() {
    resetForm();
    setSelected(null);
    setDrawerMode("new");
  }

  function openEdit(tab: WebTabRow) {
    resetForm(tab);
    setSelected(tab);
    setDrawerMode("edit");
  }

  function closeDrawer() {
    setDrawerMode(null);
    setSelected(null);
    setDrawerError(null);
  }

  function toggleRole(role: string) {
    setFormVisibleToRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  }

  // ── API actions ────────────────────────────────────────────────────────────

  async function handleCreate() {
    if (!formName.trim()) { setDrawerError("Tab name is required."); return; }
    if (!formUrl.trim())  { setDrawerError("URL or route is required."); return; }
    setSaving(true); setDrawerError(null);
    try {
      const res = await fetch("/api/settings/customization/web-tabs", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:           formName.trim(),
          description:    formDesc.trim() || undefined,
          type:           formType,
          url:            formUrl.trim(),
          placement:      formPlacement,
          icon:           formIcon.trim() || undefined,
          visibleToRoles: formVisibleToRoles,
          isActive:       formActive,
        }),
      });
      const json = await res.json() as { data?: WebTabRow; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to create tab.");

      setTabs((prev) =>
        [...prev, json.data!].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
      );
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
    if (!formName.trim()) { setDrawerError("Tab name is required."); return; }
    if (!formUrl.trim())  { setDrawerError("URL or route is required."); return; }
    setSaving(true); setDrawerError(null);
    try {
      const res = await fetch(`/api/settings/customization/web-tabs/${selected.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:           formName.trim(),
          description:    formDesc.trim() || undefined,
          type:           formType,
          url:            formUrl.trim(),
          placement:      formPlacement,
          icon:           formIcon.trim() || undefined,
          visibleToRoles: formVisibleToRoles,
          isActive:       formActive,
        }),
      });
      const json = await res.json() as { data?: WebTabRow; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to update tab.");

      setTabs((prev) =>
        prev.map((t) => (t.id === selected.id ? json.data! : t))
            .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
      );
      toast.success(`"${json.data!.name}" updated.`);
      closeDrawer();
    } catch (e) {
      setDrawerError(e instanceof Error ? e.message : "Unexpected error.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(tabId: string) {
    setActionLoading(tabId);
    try {
      const res = await fetch(`/api/settings/customization/web-tabs/${tabId}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      });
      const json = await res.json() as { data?: WebTabRow; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed.");

      setTabs((prev) => prev.map((t) => (t.id === tabId ? json.data! : t)));
      toast.success("Tab deactivated.");
      if (drawerMode !== null && selected?.id === tabId) closeDrawer();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to deactivate.");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDelete(tabId: string) {
    const tab = tabs.find((t) => t.id === tabId);
    if (!window.confirm(`Permanently delete "${tab?.name}"? This cannot be undone.`)) return;

    setActionLoading(tabId);
    try {
      const res = await fetch(`/api/settings/customization/web-tabs/${tabId}`, {
        method: "DELETE",
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed.");

      setTabs((prev) => prev.filter((t) => t.id !== tabId));
      toast.success("Tab deleted.");
      if (drawerMode !== null && selected?.id === tabId) closeDrawer();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete.");
    } finally {
      setActionLoading(null);
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
            <h1 className="text-xl font-semibold text-slate-900">Web Tabs</h1>
            <p className="mt-1 text-sm text-slate-500 max-w-xl">
              Create custom navigation tabs that link your team to approved FINOS pages or external
              business tools.
            </p>
          </div>
          <button
            type="button"
            onClick={openNew}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-white bg-[var(--finos-accent)] rounded-lg hover:opacity-90 transition-opacity shrink-0"
          >
            <Plus className="h-4 w-4" />
            New Web Tab
          </button>
        </div>

        {/* Info banner */}
        <div className="flex items-start gap-3 p-3.5 bg-amber-50 border border-amber-100 rounded-lg mb-6">
          <Info className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-700">
            Web Tabs are ready for setup. Navigation display will be connected in a later stage.
          </p>
        </div>

        {/* Empty state */}
        {tabs.length === 0 ? (
          <div className="text-center py-16 bg-white border border-dashed border-slate-200 rounded-xl">
            <Globe className="h-9 w-9 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-semibold text-slate-700">No web tabs yet</p>
            <p className="text-xs text-slate-400 mt-1 mb-4">
              Create your first web tab to give your team quick access to an approved internal page
              or external business tool.
            </p>
            <button
              type="button"
              onClick={openNew}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-[var(--finos-accent)] rounded-lg hover:opacity-90 transition-opacity"
            >
              <Plus className="h-4 w-4" />
              New Web Tab
            </button>
          </div>
        ) : (
          /* Tabs table */
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-4 py-3 font-medium text-slate-500 text-xs uppercase tracking-wide">
                    Tab Name
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500 text-xs uppercase tracking-wide">
                    Type
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500 text-xs uppercase tracking-wide">
                    URL / Route
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500 text-xs uppercase tracking-wide">
                    Placement
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500 text-xs uppercase tracking-wide">
                    Visible To
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
                {tabs.map((tab) => (
                  <tr
                    key={tab.id}
                    className="hover:bg-slate-50 transition-colors cursor-pointer"
                    onClick={() => openEdit(tab)}
                  >
                    {/* Name */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {tab.icon ? (
                          <span className="text-slate-500 text-sm">{tab.icon}</span>
                        ) : (
                          <Globe className="h-3.5 w-3.5 text-slate-300 shrink-0" />
                        )}
                        <span className="font-medium text-slate-800">{tab.name}</span>
                        {tab.isSystem && (
                          <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-medium">
                            System
                          </span>
                        )}
                      </div>
                      {tab.description && (
                        <p className="ml-5 mt-0.5 text-xs text-slate-400 truncate max-w-[220px]">
                          {tab.description}
                        </p>
                      )}
                    </td>

                    {/* Type */}
                    <td className="px-4 py-3">
                      <TypeBadge type={tab.type} />
                    </td>

                    {/* URL */}
                    <td className="px-4 py-3">
                      <span
                        className="text-xs text-slate-500 font-mono truncate max-w-[180px] block"
                        title={tab.url}
                      >
                        {tab.url}
                      </span>
                    </td>

                    {/* Placement */}
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {PLACEMENT_LABELS[tab.placement]}
                    </td>

                    {/* Visible To */}
                    <td className="px-4 py-3">
                      {tab.visibleToRoles.length === 0 ? (
                        <span className="text-xs text-slate-400">—</span>
                      ) : (
                        <span className="text-xs text-slate-600">
                          {tab.visibleToRoles.join(", ")}
                        </span>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <StatusBadge isActive={tab.isActive} />
                    </td>

                    {/* Connected */}
                    <td className="px-4 py-3">
                      <span className="text-xs text-slate-400">Not connected yet</span>
                    </td>

                    {/* Last updated */}
                    <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                      {new Date(tab.updatedAt).toLocaleDateString("en-GB", {
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
                          onClick={() => openEdit(tab)}
                          className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors disabled:opacity-50"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        {tab.isActive && (
                          <button
                            type="button"
                            title="Deactivate"
                            disabled={!!actionLoading}
                            onClick={() => handleDeactivate(tab.id)}
                            className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded transition-colors disabled:opacity-50"
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          title="Delete"
                          disabled={!!actionLoading}
                          onClick={() => handleDelete(tab.id)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* ── DRAWER ─────────────────────────────────────────────────────────── */}
      {isDrawerOpen && (
        <DrawerOverlay onClose={closeDrawer}>
          <DrawerHeader
            title={drawerMode === "new" ? "New Web Tab" : "Edit Web Tab"}
            subtitle="Web Tab"
            onClose={closeDrawer}
          />

          <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">

            {/* Tab Name */}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Tab Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                maxLength={100}
                placeholder="e.g. Company Website"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-transparent"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Description
              </label>
              <textarea
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                maxLength={300}
                rows={2}
                placeholder="Optional description for this tab"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300 resize-none"
              />
            </div>

            {/* Type */}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Type <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-2">
                {ALL_TAB_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setFormType(t)}
                    className={cn(
                      "flex-1 py-2 text-xs font-medium rounded-lg border transition-colors",
                      formType === t
                        ? "bg-slate-900 text-white border-slate-900"
                        : "bg-white text-slate-600 border-slate-200 hover:border-slate-300",
                    )}
                  >
                    {TAB_TYPE_LABELS[t]}
                  </button>
                ))}
              </div>
              {formType === "EXTERNAL_URL" && (
                <p className="mt-1.5 text-[11px] text-slate-400">
                  Must start with https://. Opens in a new tab.
                </p>
              )}
              {formType === "INTERNAL_ROUTE" && (
                <p className="mt-1.5 text-[11px] text-slate-400">
                  Must start with /. Points to a page inside this app.
                </p>
              )}
            </div>

            {/* URL / Route */}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                {formType === "EXTERNAL_URL" ? "URL" : "Route"}{" "}
                <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  placeholder={
                    formType === "EXTERNAL_URL"
                      ? "https://example.com"
                      : "/reports/profit-loss"
                  }
                  className="w-full px-3 py-2 pr-9 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300 font-mono"
                />
                {formUrl && formType === "EXTERNAL_URL" && (
                  <a
                    href={formUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    title="Test link"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </div>

            {/* Placement */}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Placement
              </label>
              <select
                value={formPlacement}
                onChange={(e) => setFormPlacement(e.target.value as WebTabPlacement)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white"
              >
                {ALL_PLACEMENTS.map((p) => (
                  <option key={p} value={p}>{PLACEMENT_LABELS[p]}</option>
                ))}
              </select>
            </div>

            {/* Icon */}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Icon (emoji or symbol, optional)
              </label>
              <input
                type="text"
                value={formIcon}
                onChange={(e) => setFormIcon(e.target.value)}
                maxLength={10}
                placeholder="e.g. 🌐 or ⚡"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300"
              />
            </div>

            {/* Visible To Roles */}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Visible To Roles
              </label>
              <div className="flex flex-wrap gap-2">
                {ALL_ROLES.map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => toggleRole(role)}
                    className={cn(
                      "px-3 py-1 text-xs font-medium rounded-full border transition-colors",
                      formVisibleToRoles.includes(role)
                        ? "bg-slate-900 text-white border-slate-900"
                        : "bg-white text-slate-600 border-slate-200 hover:border-slate-300",
                    )}
                  >
                    {role}
                  </button>
                ))}
              </div>
              {formVisibleToRoles.length === 0 && (
                <p className="mt-1.5 text-[11px] text-amber-600">
                  If no role is selected, the tab will be available only after visibility is
                  configured.
                </p>
              )}
            </div>

            {/* Active toggle */}
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-xs font-medium text-slate-700">Active</p>
                <p className="text-[11px] text-slate-400">Inactive tabs are hidden from users.</p>
              </div>
              <button
                type="button"
                onClick={() => setFormActive((v) => !v)}
                className={cn(
                  "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                  formActive ? "bg-emerald-500" : "bg-slate-200",
                )}
              >
                <span
                  className={cn(
                    "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition duration-200 ease-in-out",
                    formActive ? "translate-x-4" : "translate-x-0",
                  )}
                />
              </button>
            </div>

            {/* Error */}
            {drawerError && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-lg">
                <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                <p className="text-xs text-red-700">{drawerError}</p>
              </div>
            )}
          </div>

          {/* Drawer footer */}
          <div className="shrink-0 px-6 py-4 border-t border-slate-100 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={closeDrawer}
              className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={drawerMode === "new" ? handleCreate : handleUpdate}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-[var(--finos-accent)] rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? "Saving…" : drawerMode === "new" ? "Create Tab" : "Save Changes"}
            </button>
          </div>
        </DrawerOverlay>
      )}
    </div>
  );
}
