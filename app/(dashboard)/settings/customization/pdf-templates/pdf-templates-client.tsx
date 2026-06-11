"use client";

import { useState }                                       from "react";
import Link                                               from "next/link";
import {
  Plus, Pencil, Copy, Star, X, AlertTriangle, Info,
  ChevronRight, LayoutTemplate, Check, Trash2,
} from "lucide-react";
import { toast }                                          from "sonner";
import { cn }                                             from "@/lib/utils";
import type { PdfTemplateRow }                            from "@/lib/customization/pdf-utils";
import {
  PDF_DOC_TYPE_LABELS,
  PDF_DOC_TYPE_SINGULAR,
  PDF_DOC_TYPE_ORDER,
  LAYOUT_KEYS,
} from "@/lib/customization/pdf-utils";

// ─── Types ─────────────────────────────────────────────────────────────────────

type DrawerMode = "view" | "new" | "export-name" | null;

interface Props {
  initialTemplates: PdfTemplateRow[];
  initialType:      string;
}

// ─── Mini document preview ─────────────────────────────────────────────────────

/** Professional Branded Invoice — branded header band, structured sections. */
function MiniDocPreviewProfessional() {
  return (
    <div className="w-full aspect-[210/297] bg-white flex flex-col overflow-hidden select-none pointer-events-none text-[0px]">
      {/* Full-width brand header band */}
      <div
        className="shrink-0 px-2 py-2"
        style={{ backgroundColor: "var(--finos-accent)" }}
      >
        <div className="flex items-start justify-between gap-1">
          {/* Company name area */}
          <div className="space-y-[3px]">
            <div className="h-[6px] w-14 bg-white/70 rounded" />
            <div className="h-[3px] w-9 bg-white/40 rounded" />
            <div className="h-[3px] w-10 bg-white/30 rounded" />
          </div>
          {/* INVOICE title + ref */}
          <div className="text-right space-y-[3px]">
            <div className="h-[7px] w-12 bg-white/80 rounded" />
            <div className="h-[3px] w-8 bg-white/50 rounded ml-auto" />
          </div>
        </div>
        {/* Balance Due inside header */}
        <div className="mt-2 flex items-center justify-end gap-1.5">
          <div className="h-[3px] w-10 bg-white/40 rounded" />
          <div className="h-[5px] w-14 bg-white/65 rounded" />
        </div>
      </div>

      {/* Thin divider line */}
      <div className="h-[2px] bg-slate-100" />

      {/* Bill To + meta row */}
      <div className="px-2 py-1.5 flex gap-2">
        <div className="flex-1 space-y-[3px]">
          <div className="h-[3px] w-5 bg-slate-300 rounded" />
          <div className="h-[4px] w-12 bg-slate-400 rounded" />
        </div>
        <div className="space-y-[3px]">
          <div className="h-[3px] w-14 bg-slate-200 rounded" />
          <div className="h-[3px] w-14 bg-slate-200 rounded" />
          <div className="h-[3px] w-14 bg-slate-200 rounded" />
        </div>
      </div>

      {/* Subject line */}
      <div className="px-2 pb-1">
        <div className="h-[3px] w-20 bg-slate-100 rounded" />
      </div>

      <div className="border-t border-slate-100 mx-2" />

      {/* Table header — brand colour */}
      <div className="mx-2 mt-1">
        <div
          className="flex gap-[2px] rounded-t overflow-hidden"
          style={{ backgroundColor: "var(--finos-accent)" }}
        >
          <div className="h-[5px] w-2" />
          <div className="h-[5px] flex-1" />
          <div className="h-[5px] w-3" />
          <div className="h-[5px] w-4" />
          <div className="h-[5px] w-4" />
        </div>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={cn("flex gap-[2px]", i % 2 === 0 ? "bg-white" : "bg-[#EBF1FA]")}
          >
            <div className="h-[4px] w-2 bg-slate-200" />
            <div className="h-[4px] flex-1 bg-slate-100" />
            <div className="h-[4px] w-3 bg-slate-100" />
            <div className="h-[4px] w-4 bg-slate-100" />
            <div className="h-[4px] w-4 bg-slate-100" />
          </div>
        ))}
      </div>

      {/* Totals */}
      <div className="px-2 pt-1.5 border-t border-slate-100 mx-2 space-y-[3px]">
        {["w-5", "w-5"].map((w, i) => (
          <div key={i} className="flex justify-end gap-2">
            <div className="h-[3px] w-8 bg-slate-200 rounded" />
            <div className={cn("h-[3px] bg-slate-200 rounded", w)} />
          </div>
        ))}
        {/* Total row */}
        <div className="flex justify-end gap-2">
          <div className="h-[4px] w-8 rounded bg-[var(--finos-accent)]/30" />
          <div className="h-[4px] w-6 rounded bg-[var(--finos-accent)]/30" />
        </div>
      </div>

      {/* Notes + Payment Terms headings */}
      <div className="px-2 mt-1.5 space-y-2 flex-1">
        {["w-6", "w-10"].map((w, i) => (
          <div key={i}>
            <div
              className={cn("h-[4px] rounded mb-[3px]", w)}
              style={{ backgroundColor: "var(--finos-accent)", opacity: 0.7 }}
            />
            <div className="h-[3px] w-20 bg-slate-100 rounded mb-[2px]" />
            <div className="h-[3px] w-14 bg-slate-100 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Standard / compact / modern / classic layouts. */
function MiniDocPreviewGeneric({ layoutKey }: { layoutKey: string }) {
  const isModern  = layoutKey === "modern";
  const isCompact = layoutKey === "compact";
  return (
    <div className="w-full aspect-[210/297] bg-white flex flex-col gap-1.5 p-2 overflow-hidden select-none pointer-events-none">
      {/* Header */}
      <div className={cn("flex items-start gap-1.5", isCompact && "gap-1")}>
        <div className={cn(
          "shrink-0 rounded bg-slate-200",
          isModern  ? "h-5 w-5 rounded-full" : "h-4 w-4",
          isCompact && "h-3 w-3",
        )} />
        <div className="flex-1 space-y-[3px]">
          <div className={cn("bg-slate-300 rounded", isCompact ? "h-[5px]" : "h-[7px]")} />
          <div className={cn("bg-slate-200 rounded w-2/3", isCompact ? "h-[3px]" : "h-[5px]")} />
        </div>
      </div>

      {/* Doc title bar */}
      <div className={cn(
        "rounded bg-[var(--finos-accent)]/20",
        isModern  ? "h-[7px] rounded-full" : "h-[6px]",
        isCompact && "h-[5px]",
      )} />

      {/* Address / meta block */}
      <div className="space-y-[3px]">
        <div className="h-[4px] bg-slate-100 rounded" />
        <div className="h-[4px] bg-slate-100 rounded w-3/4" />
        <div className="h-[4px] bg-slate-100 rounded w-1/2" />
      </div>

      {/* Line items */}
      <div className="mt-1 border-t border-slate-100 pt-1 space-y-[3px] flex-1">
        <div className="flex gap-[3px]">
          <div className="h-[4px] bg-slate-200 rounded flex-1" />
          <div className="h-[4px] bg-slate-200 rounded w-4" />
          <div className="h-[4px] bg-slate-200 rounded w-4" />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-[3px]">
            <div className="h-[3px] bg-slate-100 rounded flex-1" />
            <div className="h-[3px] bg-slate-100 rounded w-4" />
            <div className="h-[3px] bg-slate-100 rounded w-4" />
          </div>
        ))}
      </div>

      {/* Totals */}
      <div className="border-t border-slate-100 pt-1 space-y-[3px]">
        <div className="flex justify-end gap-2">
          <div className="h-[3px] bg-slate-100 rounded w-7" />
          <div className="h-[3px] bg-slate-200 rounded w-5" />
        </div>
        <div className="flex justify-end gap-2">
          <div className="h-[5px] bg-[var(--finos-accent)]/25 rounded w-8" />
          <div className="h-[5px] bg-[var(--finos-accent)]/25 rounded w-6" />
        </div>
      </div>
    </div>
  );
}

function MiniDocPreview({ layoutKey }: { layoutKey: string }) {
  if (layoutKey === "professional_branded_invoice") {
    return <MiniDocPreviewProfessional />;
  }
  return <MiniDocPreviewGeneric layoutKey={layoutKey} />;
}

// ─── Template card ────────────────────────────────────────────────────────────

function TemplateCard({
  template,
  onClick,
}: {
  template: PdfTemplateRow;
  onClick:  () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group text-left flex flex-col focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--finos-accent)] rounded-xl"
    >
      {/* Card thumbnail */}
      <div className={cn(
        "w-full rounded-xl border-2 overflow-hidden shadow-sm transition-all duration-150",
        "group-hover:shadow-md group-hover:border-[var(--finos-accent)]/40",
        template.isDefault
          ? "border-[var(--finos-accent)]/60"
          : "border-slate-200",
      )}>
        <MiniDocPreview layoutKey={template.layoutKey} />
      </div>

      {/* Card label row */}
      <div className="mt-2 px-0.5 space-y-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-medium text-slate-800 leading-tight">
            {template.name}
          </span>
          {template.isDefault && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--finos-accent)]/10 text-[var(--finos-accent)]">
              <Star className="h-2.5 w-2.5" />
              Default
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {template.isSystem && (
            <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-500">
              System
            </span>
          )}
          <span className="text-xs text-slate-400 capitalize">{template.layoutKey}</span>
        </div>
      </div>
    </button>
  );
}

// ─── New template card ─────────────────────────────────────────────────────────

function NewTemplateCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group text-left flex flex-col focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--finos-accent)] rounded-xl"
    >
      <div className="w-full aspect-[210/297] rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 flex flex-col items-center justify-center gap-2 transition-all group-hover:border-[var(--finos-accent)]/40 group-hover:bg-[var(--finos-accent)]/5">
        <div className="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center shadow-sm group-hover:border-[var(--finos-accent)]/40 transition-colors">
          <Plus className="h-4 w-4 text-slate-400 group-hover:text-[var(--finos-accent)]" />
        </div>
        <span className="text-xs font-medium text-slate-400 group-hover:text-[var(--finos-accent)]">
          New Template
        </span>
      </div>
      <div className="mt-2 px-0.5">
        <span className="text-sm font-medium text-slate-400">New Template</span>
      </div>
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function PdfTemplatesClient({ initialTemplates, initialType }: Props) {
  const [templates, setTemplates]       = useState<PdfTemplateRow[]>(initialTemplates);
  const [drawerMode, setDrawerMode]     = useState<DrawerMode>(null);
  const [selected, setSelected]         = useState<PdfTemplateRow | null>(null);
  const [saving, setSaving]             = useState(false);
  const [drawerError, setDrawerError]   = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null); // template id

  // New template form
  const [newName,   setNewName]   = useState("");
  const [newLayout, setNewLayout] = useState("standard");

  const activeType  = initialType;
  const pluralLabel = PDF_DOC_TYPE_LABELS[activeType] ?? activeType;
  const singularLabel = PDF_DOC_TYPE_SINGULAR[activeType] ?? activeType;

  // ── Drawer helpers ────────────────────────────────────────────────────────

  function openView(t: PdfTemplateRow) {
    setSelected(t);
    setDrawerError(null);
    setDrawerMode("view");
  }

  function openNew() {
    setNewName("");
    setNewLayout("standard");
    setDrawerError(null);
    setDrawerMode("new");
  }

  function closeDrawer() {
    setDrawerMode(null);
    setSelected(null);
    setDrawerError(null);
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handleSetDefault(templateId: string) {
    setActionLoading(templateId);
    try {
      const res = await fetch(
        `/api/settings/customization/pdf-templates/${templateId}/set-default`,
        { method: "POST" },
      );
      const json = await res.json() as { data?: PdfTemplateRow; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed.");

      // Update state: unset old default, set new default
      setTemplates((prev) =>
        prev.map((t) =>
          t.documentType === json.data!.documentType
            ? { ...t, isDefault: t.id === templateId }
            : t
        )
      );
      if (selected?.id === templateId) {
        setSelected((prev) => prev ? { ...prev, isDefault: true } : prev);
      }
      toast.success("Default template updated.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to set default.");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDuplicate(templateId: string) {
    setActionLoading(templateId);
    try {
      const res = await fetch(
        `/api/settings/customization/pdf-templates/${templateId}/duplicate`,
        { method: "POST" },
      );
      const json = await res.json() as { data?: PdfTemplateRow; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed.");

      setTemplates((prev) => [...prev, json.data!]);
      toast.success(`Template duplicated as "${json.data!.name}".`);
      closeDrawer();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to duplicate.");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDeactivate(templateId: string) {
    setActionLoading(templateId);
    try {
      const res = await fetch(
        `/api/settings/customization/pdf-templates/${templateId}`,
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: false }) },
      );
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed.");

      setTemplates((prev) => prev.filter((t) => t.id !== templateId));
      toast.success("Template deactivated.");
      closeDrawer();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to deactivate.");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDelete(templateId: string) {
    if (!window.confirm("Permanently delete this template? This cannot be undone.")) return;
    setActionLoading(templateId);
    try {
      const res = await fetch(
        `/api/settings/customization/pdf-templates/${templateId}`,
        { method: "DELETE" },
      );
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed.");

      setTemplates((prev) => prev.filter((t) => t.id !== templateId));
      toast.success("Template deleted.");
      closeDrawer();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete.");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleCreate() {
    if (!newName.trim()) { setDrawerError("Template name is required."); return; }

    setSaving(true); setDrawerError(null);
    try {
      const res = await fetch("/api/settings/customization/pdf-templates", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentType: activeType,
          name:         newName.trim(),
          layoutKey:    newLayout,
        }),
      });
      const json = await res.json() as { data?: PdfTemplateRow; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed.");

      setTemplates((prev) => [...prev, json.data!]);
      toast.success(`"${json.data!.name}" created.`);
      closeDrawer();
    } catch (e) {
      setDrawerError(e instanceof Error ? e.message : "Unexpected error.");
    } finally {
      setSaving(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-full">

      {/* ── Secondary doc-type menu ── */}
      <aside className="w-52 shrink-0 border-r border-slate-200 bg-white pt-6 pb-8 overflow-y-auto">
        <p className="px-4 mb-3 text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
          Templates
        </p>
        <nav className="px-2 space-y-0.5">
          {PDF_DOC_TYPE_ORDER.map((type) => (
            <Link
              key={type}
              href={`/settings/customization/pdf-templates?type=${type}`}
              className={cn(
                "flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                activeType === type
                  ? "bg-[var(--finos-accent)]/10 text-[var(--finos-accent)]"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
              )}
            >
              <span>{PDF_DOC_TYPE_LABELS[type]}</span>
              {activeType === type && (
                <ChevronRight className="h-3.5 w-3.5 opacity-60" />
              )}
            </Link>
          ))}
        </nav>
      </aside>

      {/* ── Main panel ── */}
      <main className="flex-1 px-8 py-8 min-w-0">

        {/* Page header */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">
              All {singularLabel} Templates
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {templates.length} template{templates.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setDrawerMode("export-name")}
              className="px-3.5 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Configure Export File Name
            </button>
            <button
              type="button"
              onClick={openNew}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-white bg-[var(--finos-accent)] rounded-lg hover:opacity-90 transition-opacity"
            >
              <Plus className="h-4 w-4" />
              New Template
            </button>
          </div>
        </div>

        {/* PDF rendering notice */}
        <div className="flex items-start gap-3 p-3.5 bg-amber-50 border border-amber-100 rounded-lg mb-6">
          <Info className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-700">
            Template settings are ready. Actual PDF rendering integration is pending —
            select a default template now and it will be applied when PDF export is connected.
          </p>
        </div>

        {/* Template grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
          {templates.map((t) => (
            <TemplateCard key={t.id} template={t} onClick={() => openView(t)} />
          ))}
          <NewTemplateCard onClick={openNew} />
        </div>

        {templates.length === 0 && (
          <div className="mt-8 text-center py-12 bg-white border border-dashed border-slate-200 rounded-xl">
            <LayoutTemplate className="h-8 w-8 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-600">No templates yet</p>
            <p className="text-xs text-slate-400 mt-1">Create the first template for {pluralLabel}.</p>
          </div>
        )}
      </main>

      {/* ── View / detail drawer ── */}
      {drawerMode === "view" && selected && (
        <div className="fixed inset-0 z-[60] flex">
          <div className="flex-1 bg-black/30" onClick={closeDrawer} />
          <div className="w-[420px] bg-white h-full shadow-2xl flex flex-col">

            {/* Drawer header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Template Details</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {PDF_DOC_TYPE_SINGULAR[selected.documentType] ?? selected.documentType}
                </p>
              </div>
              <button type="button" onClick={closeDrawer} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Drawer body */}
            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">

              {/* Mini preview */}
              <div className="w-36 mx-auto rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                <MiniDocPreview layoutKey={selected.layoutKey} />
              </div>

              {/* Badges */}
              <div className="flex items-center gap-2 justify-center flex-wrap">
                {selected.isDefault && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-[var(--finos-accent)]/10 text-[var(--finos-accent)]">
                    <Star className="h-3 w-3" /> Default
                  </span>
                )}
                {selected.isSystem ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-500">
                    System
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-600">
                    Custom
                  </span>
                )}
              </div>

              {/* Details */}
              <dl className="space-y-3">
                <div className="flex justify-between text-sm">
                  <dt className="text-slate-500 font-medium">Name</dt>
                  <dd className="text-slate-800 font-semibold">{selected.name}</dd>
                </div>
                <div className="flex justify-between text-sm">
                  <dt className="text-slate-500 font-medium">Document type</dt>
                  <dd className="text-slate-800">{PDF_DOC_TYPE_SINGULAR[selected.documentType]}</dd>
                </div>
                <div className="flex justify-between text-sm">
                  <dt className="text-slate-500 font-medium">Layout</dt>
                  <dd className="text-slate-800 capitalize">{selected.layoutKey}</dd>
                </div>
                {selected.description && (
                  <div className="text-sm">
                    <dt className="text-slate-500 font-medium mb-1">Description</dt>
                    <dd className="text-slate-700">{selected.description}</dd>
                  </div>
                )}
              </dl>

              {/* System template notice */}
              {selected.isSystem && (
                <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-100 rounded-lg">
                  <Info className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                  <p className="text-sm text-blue-700">
                    This is a system template. Duplicate it to customise layout and settings.
                  </p>
                </div>
              )}

              {drawerError && (
                <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                  <p className="text-sm text-red-700">{drawerError}</p>
                </div>
              )}
            </div>

            {/* Drawer footer actions */}
            <div className="px-6 py-4 border-t border-slate-200 space-y-2 shrink-0">
              {!selected.isDefault && (
                <button
                  type="button"
                  disabled={!!actionLoading}
                  onClick={() => handleSetDefault(selected.id)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[var(--finos-accent)] rounded-lg hover:opacity-90 transition-opacity disabled:opacity-60"
                >
                  <Check className="h-4 w-4" />
                  {actionLoading === selected.id ? "Updating…" : "Set as Default"}
                </button>
              )}
              <button
                type="button"
                disabled={!!actionLoading}
                onClick={() => handleDuplicate(selected.id)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-60"
              >
                <Copy className="h-4 w-4" />
                {actionLoading === selected.id ? "Duplicating…" : "Duplicate"}
              </button>
              {!selected.isSystem && !selected.isDefault && (
                <button
                  type="button"
                  disabled={!!actionLoading}
                  onClick={() => handleDeactivate(selected.id)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-red-600 border border-red-100 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-60"
                >
                  <Trash2 className="h-4 w-4" />
                  Deactivate
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── New template drawer ── */}
      {drawerMode === "new" && (
        <div className="fixed inset-0 z-[60] flex">
          <div className="flex-1 bg-black/30" onClick={closeDrawer} />
          <div className="w-[440px] bg-white h-full shadow-2xl flex flex-col">

            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
              <div>
                <h2 className="text-base font-semibold text-slate-900">New Template</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {singularLabel} template
                </p>
              </div>
              <button type="button" onClick={closeDrawer} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">

              {drawerError && (
                <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                  <p className="text-sm text-red-700">{drawerError}</p>
                </div>
              )}

              {/* Template Name */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Template Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  maxLength={100}
                  placeholder="e.g. Professional Invoice"
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25"
                />
              </div>

              {/* Document Type (read-only, from active type) */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Document Type
                </label>
                <div className="w-full text-sm border border-slate-100 rounded-lg px-3 py-2 text-slate-500 bg-slate-50">
                  {singularLabel}
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  To create a template for another document type, select it in the left menu first.
                </p>
              </div>

              {/* Base Layout */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Base Layout
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {LAYOUT_KEYS.map((lk) => (
                    <button
                      key={lk.value}
                      type="button"
                      onClick={() => setNewLayout(lk.value)}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2.5 text-sm border rounded-lg transition-colors text-left",
                        newLayout === lk.value
                          ? "border-[var(--finos-accent)] bg-[var(--finos-accent)]/5 text-[var(--finos-accent)] font-medium"
                          : "border-slate-200 text-slate-600 hover:border-slate-300",
                      )}
                    >
                      <div className="w-6 h-8 rounded shrink-0 overflow-hidden border border-slate-200">
                        <MiniDocPreview layoutKey={lk.value} />
                      </div>
                      {lk.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Advanced editor notice */}
              <div className="flex items-start gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <Info className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
                <p className="text-sm text-slate-500">
                  Advanced template editor is not connected yet. The template will be created
                  with the selected base layout and can be customised once the editor is available.
                </p>
              </div>
            </div>

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
                onClick={handleCreate}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-white bg-[var(--finos-accent)] rounded-lg hover:opacity-90 transition-opacity disabled:opacity-60"
              >
                {saving ? "Creating…" : "Create Template"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Export file name drawer ── */}
      {drawerMode === "export-name" && (
        <div className="fixed inset-0 z-[60] flex">
          <div className="flex-1 bg-black/30" onClick={closeDrawer} />
          <div className="w-[440px] bg-white h-full shadow-2xl flex flex-col">

            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Configure Export File Name</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Set the file name pattern for exported PDFs
                </p>
              </div>
              <button type="button" onClick={closeDrawer} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
              <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-100 rounded-lg">
                <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-amber-800">Not connected yet</p>
                  <p className="text-sm text-amber-700">
                    Export file name settings are not connected yet. This feature will be available
                    in a future update once the PDF export pipeline is wired.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-sm font-medium text-slate-600">Planned pattern variables:</p>
                <div className="space-y-1.5">
                  {[
                    ["${DOCUMENT.TYPE}",    "Invoice, Bill, Estimate…"],
                    ["${DOCUMENT.NUMBER}",  "INV-00001"],
                    ["${CUSTOMER.NAME}",    "Customer or vendor name"],
                    ["${DOCUMENT.DATE}",    "e.g. 2026-06-11"],
                    ["${ORGANIZATION.NAME}","Your company name"],
                  ].map(([token, desc]) => (
                    <div key={token} className="flex items-baseline gap-3 text-sm">
                      <code className="text-xs bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-mono shrink-0">
                        {token}
                      </code>
                      <span className="text-slate-500">{desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 shrink-0">
              <button
                type="button"
                onClick={closeDrawer}
                className="w-full px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
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
