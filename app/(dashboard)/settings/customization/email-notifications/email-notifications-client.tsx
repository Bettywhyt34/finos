"use client";

import { useState }  from "react";
import Link          from "next/link";
import {
  Pencil, Eye, RotateCcw, Info, AlertTriangle, X,
  ChevronRight, ChevronDown, Check, Mail,
} from "lucide-react";
import { toast }     from "sonner";
import { cn }        from "@/lib/utils";
import type { EmailNotificationTemplateRow } from "@/lib/email-notifications/template-renderer";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  EVENT_LABELS,
  listVariablesForEvent,
  validateTemplateVariables,
} from "@/lib/email-notifications/template-renderer";

// ─── Types ─────────────────────────────────────────────────────────────────────

type DrawerMode = "edit" | "preview" | null;

interface Props {
  initialTemplates: EmailNotificationTemplateRow[];
  initialCategory:  string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(d: Date): string {
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

// ─── Main component ────────────────────────────────────────────────────────────

export function EmailNotificationsClient({ initialTemplates, initialCategory }: Props) {
  const [templates, setTemplates]   = useState<EmailNotificationTemplateRow[]>(initialTemplates);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>(null);
  const [selected, setSelected]     = useState<EmailNotificationTemplateRow | null>(null);
  const [saving, setSaving]         = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Preview state
  const [preview, setPreview] = useState<{ subject: string; bodyHtml: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Edit form fields
  const [fieldSubject,  setFieldSubject]  = useState("");
  const [fieldBody,     setFieldBody]     = useState("");
  const [fieldEnabled,  setFieldEnabled]  = useState(true);
  const [varsOpen,      setVarsOpen]      = useState(false);

  const activeCategory = initialCategory;

  // ── Drawer helpers ───────────────────────────────────────────────────────────

  function openEdit(t: EmailNotificationTemplateRow) {
    setSelected(t);
    setFieldSubject(t.subject);
    setFieldBody(t.bodyHtml);
    setFieldEnabled(t.isEnabled);
    setDrawerError(null);
    setVarsOpen(false);
    setDrawerMode("edit");
  }

  async function openPreview(t: EmailNotificationTemplateRow) {
    setSelected(t);
    setPreview(null);
    setDrawerMode("preview");
    setPreviewLoading(true);
    try {
      const res  = await fetch(`/api/settings/customization/email-notifications/${t.id}/preview`, { method: "POST" });
      const json = await res.json() as { data?: { subject: string; bodyHtml: string }; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed.");
      setPreview(json.data!);
    } catch (e) {
      setPreview({ subject: "(preview failed)", bodyHtml: `<p>${e instanceof Error ? e.message : "Unexpected error."}</p>` });
    } finally {
      setPreviewLoading(false);
    }
  }

  function closeDrawer() {
    setDrawerMode(null);
    setSelected(null);
    setDrawerError(null);
    setPreview(null);
  }

  // ── Validation warnings ──────────────────────────────────────────────────────

  const editWarnings = selected
    ? validateTemplateVariables(fieldSubject, fieldBody, selected.event)
    : [];

  // ── Actions ──────────────────────────────────────────────────────────────────

  async function handleToggle(templateId: string) {
    setActionLoading(templateId);
    try {
      const res  = await fetch(`/api/settings/customization/email-notifications/${templateId}/toggle`, { method: "POST" });
      const json = await res.json() as { data?: EmailNotificationTemplateRow; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed.");

      setTemplates((prev) => prev.map((t) => t.id === templateId ? json.data! : t));
      toast.success(json.data!.isEnabled ? "Template enabled." : "Template disabled.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to toggle.");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleSave() {
    if (!selected) return;
    if (!fieldSubject.trim()) { setDrawerError("Subject is required."); return; }
    if (!fieldBody.trim())    { setDrawerError("Body is required.");    return; }

    setSaving(true); setDrawerError(null);
    try {
      const res  = await fetch(`/api/settings/customization/email-notifications/${selected.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ subject: fieldSubject.trim(), bodyHtml: fieldBody.trim(), isEnabled: fieldEnabled }),
      });
      const json = await res.json() as { data?: EmailNotificationTemplateRow; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed.");

      setTemplates((prev) => prev.map((t) => t.id === selected.id ? json.data! : t));
      toast.success("Template saved.");
      closeDrawer();
    } catch (e) {
      setDrawerError(e instanceof Error ? e.message : "Unexpected error.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRestore(templateId: string) {
    setActionLoading(templateId);
    try {
      const res  = await fetch(`/api/settings/customization/email-notifications/${templateId}/restore-default`, { method: "POST" });
      const json = await res.json() as { data?: EmailNotificationTemplateRow; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed.");

      setTemplates((prev) => prev.map((t) => t.id === templateId ? json.data! : t));
      toast.success("Template restored to system default.");
      closeDrawer();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to restore.");
    } finally {
      setActionLoading(null);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-full">

      {/* ── Category sidebar ── */}
      <aside className="w-48 shrink-0 border-r border-slate-200 bg-white pt-6 pb-8 overflow-y-auto">
        <p className="px-4 mb-3 text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
          Category
        </p>
        <nav className="px-2 space-y-0.5">
          {CATEGORY_ORDER.map((cat) => (
            <Link
              key={cat}
              href={`/settings/customization/email-notifications?category=${cat}`}
              className={cn(
                "flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                activeCategory === cat
                  ? "bg-[var(--finos-accent)]/10 text-[var(--finos-accent)]"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
              )}
            >
              <span>{CATEGORY_LABELS[cat]}</span>
              {activeCategory === cat && <ChevronRight className="h-3.5 w-3.5 opacity-60" />}
            </Link>
          ))}
        </nav>
      </aside>

      {/* ── Main panel ── */}
      <main className="flex-1 px-8 py-8 min-w-0 overflow-y-auto">

        {/* Header */}
        <div className="mb-4">
          <h1 className="text-xl font-semibold text-slate-900">Email Notifications</h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage default email messages FINOS uses for transaction and reminder communication.
          </p>
        </div>

        {/* Connection notice */}
        <div className="flex items-start gap-3 p-3.5 bg-amber-50 border border-amber-100 rounded-lg mb-6">
          <Info className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-700">
            Email templates are ready. Some transaction flows are not yet wired to send these emails automatically.
            Templates marked <strong>Not connected</strong> will be applied once the sending pipeline is integrated.
          </p>
        </div>

        {/* Template table */}
        {templates.length === 0 ? (
          <div className="mt-8 text-center py-12 bg-white border border-dashed border-slate-200 rounded-xl">
            <Mail className="h-8 w-8 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-600">No templates in this category</p>
            <p className="text-xs text-slate-400 mt-1">Run the backfill script to seed default templates.</p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left px-4 py-3 font-medium text-slate-500 w-[30%]">Notification</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500 w-[14%]">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500 w-[16%]">Connected</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500 w-[14%]">Last Updated</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {templates.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/50 transition-colors">

                    {/* Notification */}
                    <td className="px-4 py-3.5">
                      <div className="font-medium text-slate-800 leading-tight">{t.name}</div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        {EVENT_LABELS[t.event] ?? t.event}
                        {t.isCustomised && (
                          <span className="ml-1.5 inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-600">
                            Customised
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Status + toggle */}
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <ToggleSwitch
                          checked={t.isEnabled}
                          loading={actionLoading === t.id}
                          onChange={() => handleToggle(t.id)}
                        />
                        <span className={cn(
                          "text-xs font-medium",
                          t.isEnabled ? "text-emerald-600" : "text-slate-400",
                        )}>
                          {t.isEnabled ? "Enabled" : "Disabled"}
                        </span>
                      </div>
                    </td>

                    {/* Connected */}
                    <td className="px-4 py-3.5">
                      {t.isConnected ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-100">
                          <Check className="h-3 w-3" /> Connected
                        </span>
                      ) : (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-100">
                          Not connected
                        </span>
                      )}
                    </td>

                    {/* Last Updated */}
                    <td className="px-4 py-3.5 text-xs text-slate-400">
                      {formatDate(t.updatedAt)}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3.5">
                      <div className="flex items-center justify-end gap-1">
                        <ActionButton
                          title="Preview"
                          onClick={() => openPreview(t)}
                          disabled={!!actionLoading}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </ActionButton>
                        <ActionButton
                          title="Edit"
                          onClick={() => openEdit(t)}
                          disabled={!!actionLoading}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </ActionButton>
                        {t.isCustomised && (
                          <ActionButton
                            title="Restore Default"
                            onClick={() => handleRestore(t.id)}
                            disabled={!!actionLoading}
                            loading={actionLoading === t.id}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </ActionButton>
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

      {/* ── Edit drawer ── */}
      {drawerMode === "edit" && selected && (
        <div className="fixed inset-0 z-[60] flex">
          <div className="flex-1 bg-black/30" onClick={closeDrawer} />
          <div className="w-[520px] bg-white h-full shadow-2xl flex flex-col">

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Edit Template</h2>
                <p className="text-xs text-slate-500 mt-0.5">{selected.name}</p>
              </div>
              <button type="button" onClick={closeDrawer} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">

              {/* Read-only meta */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs font-medium text-slate-500 mb-1">Category</p>
                  <span className="inline-flex px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-600">
                    {CATEGORY_LABELS[selected.category]}
                  </span>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500 mb-1">Event</p>
                  <span className="inline-flex px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-600">
                    {EVENT_LABELS[selected.event] ?? selected.event}
                  </span>
                </div>
              </div>

              {/* Enabled toggle */}
              <div className="flex items-center justify-between py-2 border-y border-slate-100">
                <div>
                  <p className="text-sm font-medium text-slate-700">Enabled</p>
                  <p className="text-xs text-slate-400">Send this notification when the event occurs</p>
                </div>
                <ToggleSwitch checked={fieldEnabled} onChange={setFieldEnabled} />
              </div>

              {/* Subject */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Subject <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={fieldSubject}
                  onChange={(e) => setFieldSubject(e.target.value)}
                  maxLength={500}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25"
                />
              </div>

              {/* Body */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Body <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={fieldBody}
                  onChange={(e) => setFieldBody(e.target.value)}
                  rows={10}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-700 font-mono focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25 resize-y"
                />
                <p className="mt-1 text-xs text-slate-400">
                  HTML is supported. Use <code className="bg-slate-100 px-1 rounded">{'{{variable.field}}'}</code> placeholders.
                </p>
              </div>

              {/* Variable warnings */}
              {editWarnings.length > 0 && (
                <div className="space-y-1.5">
                  {editWarnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-2 p-2.5 bg-amber-50 border border-amber-100 rounded-lg">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                      <p className="text-xs text-amber-700">{w}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Available variables panel */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => setVarsOpen((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 transition-colors"
                >
                  <span>Available Variables</span>
                  {varsOpen
                    ? <ChevronDown className="h-4 w-4 text-slate-400" />
                    : <ChevronRight className="h-4 w-4 text-slate-400" />
                  }
                </button>
                {varsOpen && (
                  <div className="px-4 py-3 flex flex-wrap gap-1.5">
                    {listVariablesForEvent(selected.event).map((v) => (
                      <button
                        key={v}
                        type="button"
                        title="Click to copy"
                        onClick={() => { navigator.clipboard.writeText(v); toast.info(`Copied: ${v}`); }}
                        className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-slate-100 text-slate-600 hover:bg-[var(--finos-accent)]/10 hover:text-[var(--finos-accent)] transition-colors cursor-pointer"
                      >
                        {v}
                      </button>
                    ))}
                    {listVariablesForEvent(selected.event).length === 0 && (
                      <p className="text-xs text-slate-400">No variables defined for this event.</p>
                    )}
                  </div>
                )}
              </div>

              {/* Drawer-level error */}
              {drawerError && (
                <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                  <p className="text-sm text-red-700">{drawerError}</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
              <div>
                {selected.isCustomised && (
                  <button
                    type="button"
                    disabled={!!actionLoading}
                    onClick={() => handleRestore(selected.id)}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-60"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Restore Default
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={closeDrawer}
                  className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => openPreview(selected)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Preview
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 text-sm font-medium text-white bg-[var(--finos-accent)] rounded-lg hover:opacity-90 transition-opacity disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Preview drawer ── */}
      {drawerMode === "preview" && selected && (
        <div className="fixed inset-0 z-[60] flex">
          <div className="flex-1 bg-black/30" onClick={closeDrawer} />
          <div className="w-[560px] bg-white h-full shadow-2xl flex flex-col">

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Template Preview</h2>
                <p className="text-xs text-slate-500 mt-0.5">{selected.name}</p>
              </div>
              <button type="button" onClick={closeDrawer} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">

              {/* Sample data notice */}
              <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-100 rounded-lg">
                <Info className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                <p className="text-sm text-amber-700">
                  Preview only — sample data. Actual values are substituted when the email is sent.
                </p>
              </div>

              {previewLoading ? (
                <div className="py-12 text-center">
                  <p className="text-sm text-slate-400">Rendering preview…</p>
                </div>
              ) : preview ? (
                <>
                  {/* Subject */}
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Subject</p>
                    <div className="text-sm font-medium text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
                      {preview.subject}
                    </div>
                  </div>

                  {/* Body */}
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Body</p>
                    <div
                      className="text-sm text-slate-700 bg-white border border-slate-200 rounded-lg px-5 py-4 prose prose-sm max-w-none"
                      dangerouslySetInnerHTML={{ __html: preview.bodyHtml }}
                    />
                  </div>
                </>
              ) : null}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
              <button
                type="button"
                onClick={() => openEdit(selected)}
                className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Edit Template
              </button>
              <button
                type="button"
                onClick={closeDrawer}
                className="px-4 py-2 text-sm font-medium text-white bg-[var(--finos-accent)] rounded-lg hover:opacity-90 transition-opacity"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function ToggleSwitch({
  checked,
  onChange,
  loading,
}: {
  checked:   boolean;
  onChange:  (v: boolean) => void;
  loading?:  boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={loading}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)] focus:ring-offset-1 disabled:opacity-60",
        checked ? "bg-[var(--finos-accent)]" : "bg-slate-200",
      )}
    >
      <span className={cn(
        "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform",
        checked ? "translate-x-4" : "translate-x-0",
      )} />
    </button>
  );
}

function ActionButton({
  title,
  onClick,
  disabled,
  loading,
  children,
}: {
  title:     string;
  onClick:   () => void;
  disabled?: boolean;
  loading?:  boolean;
  children:  React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled || loading}
      onClick={onClick}
      className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-40"
    >
      {children}
    </button>
  );
}
