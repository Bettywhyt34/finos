"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Download, FileText, Loader2, Pencil, Plus, X } from "lucide-react";
import { toast } from "sonner";

export interface ProjectDocumentRow {
  id: string;
  title: string;
  category: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  uploadedAt: string;
  uploadedByName: string | null;
}

const CATEGORIES = [
  ["CONTRACT", "Contract"],
  ["PURCHASE_ORDER", "Purchase order"],
  ["DELIVERY_EVIDENCE", "Delivery evidence"],
  ["RECONCILIATION", "Reconciliation"],
  ["CLOSEOUT", "Close-out report"],
  ["OTHER", "Other"],
] as const;

export function ProjectDocuments({ projectId, documents, canManage }: { projectId: string; documents: ProjectDocumentRow[]; canManage: boolean }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function upload(formData: FormData) {
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/documents`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      toast.success("Document added to the Project");
      setAdding(false);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally { setSaving(false); }
  }

  async function update(documentId: string, formData: FormData) {
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: formData.get("title"), category: formData.get("category") }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");
      toast.success("Document details updated");
      setEditingId(null);
      router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Update failed"); }
    finally { setSaving(false); }
  }

  async function archive(document: ProjectDocumentRow) {
    if (!window.confirm(`Archive “${document.title}”? The audit history will be retained.`)) return;
    const res = await fetch(`/api/projects/${projectId}/documents/${document.id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) return toast.error(data.error || "Document could not be archived");
    toast.success("Document archived; Activity history retained");
    router.refresh();
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl font-medium text-[var(--text-primary)]">Project documents</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Private files linked to this Project and its financial trail.</p>
        </div>
        {canManage ? (
          <button onClick={() => setAdding((value) => !value)} className="inline-flex items-center gap-2 rounded-lg bg-[var(--finos-accent)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--finos-accent-hover)]">
            {adding ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{adding ? "Cancel" : "Add document"}
          </button>
        ) : null}
      </div>

      {adding ? (
        <form action={upload} className="grid gap-4 rounded-xl border border-[var(--app-border)] bg-white p-5 md:grid-cols-[1.2fr_0.8fr_1.2fr_auto] md:items-end">
          <Field label="Document title"><input name="title" required maxLength={160} className="finos-input" placeholder="e.g. Signed media contract" /></Field>
          <Field label="Category"><CategorySelect /></Field>
          <Field label="File"><input ref={fileRef} name="file" type="file" required accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.csv" className="finos-input file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium" /></Field>
          <button disabled={saving} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[var(--finos-foundation)] px-5 text-sm font-medium text-white disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Add
          </button>
          <p className="text-xs text-[var(--text-secondary)] md:col-span-4">PDF, image, Word, Excel or CSV · maximum 15 MB · stored privately</p>
        </form>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-[var(--app-border)] bg-white">
        {documents.length ? (
          <div className="divide-y divide-[var(--app-border)]">
            {documents.map((document) => editingId === document.id ? (
              <form key={document.id} action={(data) => update(document.id, data)} className="grid gap-3 bg-[var(--surface-muted)] p-5 md:grid-cols-[1fr_240px_auto] md:items-end">
                <Field label="Document title"><input name="title" defaultValue={document.title} required className="finos-input" /></Field>
                <Field label="Category"><CategorySelect defaultValue={document.category} /></Field>
                <div className="flex gap-2"><button disabled={saving} className="h-11 rounded-lg bg-[var(--finos-accent)] px-4 text-sm font-medium text-white">Save</button><button type="button" onClick={() => setEditingId(null)} className="h-11 rounded-lg border border-[var(--app-border)] bg-white px-4 text-sm font-medium">Cancel</button></div>
              </form>
            ) : (
              <article key={document.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[var(--surface-muted)] text-[var(--finos-accent)]"><FileText className="h-5 w-5" /></div>
                <div className="min-w-52 flex-1">
                  <p className="text-sm font-medium text-[var(--text-primary)]">{document.title}</p>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">{labelFor(document.category)} · {document.fileName} · {formatBytes(document.fileSize)}</p>
                </div>
                <p className="text-xs text-[var(--text-secondary)]">Added {formatDateTime(document.uploadedAt)}{document.uploadedByName ? ` by ${document.uploadedByName}` : ""}</p>
                <div className="flex items-center gap-1">
                  <a href={`/api/projects/${projectId}/documents/${document.id}/download`} target="_blank" rel="noreferrer" aria-label={`Open ${document.title}`} className="rounded-md p-2 text-[var(--text-secondary)] hover:bg-[var(--surface-muted)] hover:text-[var(--finos-accent)]"><Download className="h-4 w-4" /></a>
                  {canManage ? <><button onClick={() => setEditingId(document.id)} aria-label={`Edit ${document.title}`} className="rounded-md p-2 text-[var(--text-secondary)] hover:bg-[var(--surface-muted)]"><Pencil className="h-4 w-4" /></button><button onClick={() => archive(document)} aria-label={`Archive ${document.title}`} className="rounded-md p-2 text-[var(--text-secondary)] hover:bg-[#F8EAEA] hover:text-[var(--critical)]"><Archive className="h-4 w-4" /></button></> : null}
                </div>
              </article>
            ))}
          </div>
        ) : <div className="px-6 py-16 text-center"><FileText className="mx-auto h-6 w-6 text-[var(--finos-accent)]" /><h3 className="font-serif mt-4 text-lg font-medium">No documents added yet</h3><p className="mt-2 text-sm text-[var(--text-secondary)]">Contracts, purchase orders, delivery evidence and close-out reports will appear here.</p></div>}
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">{label}</span>{children}</label>; }
function CategorySelect({ defaultValue = "CONTRACT" }: { defaultValue?: string }) { return <select name="category" defaultValue={defaultValue} className="finos-input">{CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>; }
function labelFor(value: string) { return CATEGORIES.find(([key]) => key === value)?.[1] ?? value.replaceAll("_", " ").toLowerCase(); }
function formatBytes(value: number) { return value < 1024 * 1024 ? `${Math.ceil(value / 1024)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`; }
function formatDateTime(value: string) { return new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
