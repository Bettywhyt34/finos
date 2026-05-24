"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";

type CoaOption = { id: string; code: string; name: string };

type Mapping = {
  id: string;
  sourceAccountCode: string;
  sourceAccountName: string | null;
  finosAccountId: string;
  notes: string | null;
  finosAccount: { code: string; name: string };
};

export function MappingManager({
  sourceApp,
  initialMappings,
  coaOptions,
}: {
  sourceApp: string;
  initialMappings: Mapping[];
  coaOptions: CoaOption[];
}) {
  const [mappings, setMappings] = useState<Mapping[]>(initialMappings);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    sourceAccountCode: "",
    sourceAccountName: "",
    finosAccountId: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!form.sourceAccountCode || !form.finosAccountId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/settings/integrations/${sourceApp}/mappings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(await res.text());
      const created: Mapping = await res.json();
      setMappings((prev) => [...prev, created]);
      setForm({ sourceAccountCode: "", sourceAccountName: "", finosAccountId: "", notes: "" });
      setAdding(false);
      toast.success("Mapping saved");
    } catch {
      toast.error("Failed to save mapping");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(
        `/api/settings/integrations/${sourceApp}/mappings/${id}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error();
      setMappings((prev) => prev.filter((m) => m.id !== id));
      toast.success("Mapping removed");
    } catch {
      toast.error("Failed to remove mapping");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Existing mappings */}
      <div className="rounded-lg border bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-slate-50">
              <th className="px-4 py-3 text-left font-semibold text-slate-600">
                {sourceApp.charAt(0).toUpperCase() + sourceApp.slice(1)} Code
              </th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">External Name</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">FINOS Account</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">Notes</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {mappings.length === 0 && !adding && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  No mappings yet — add one below
                </td>
              </tr>
            )}
            {mappings.map((m) => (
              <tr key={m.id} className="border-b last:border-b-0 hover:bg-slate-50">
                <td className="px-4 py-3 font-mono text-xs text-slate-800">{m.sourceAccountCode}</td>
                <td className="px-4 py-3 text-slate-600">{m.sourceAccountName ?? "—"}</td>
                <td className="px-4 py-3">
                  <span className="font-mono text-xs text-slate-500 mr-1">{m.finosAccount.code}</span>
                  {m.finosAccount.name}
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs">{m.notes ?? "—"}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => handleDelete(m.id)}
                    disabled={deletingId === m.id}
                    className="text-slate-400 hover:text-red-500 transition-colors disabled:opacity-40"
                    aria-label="Remove mapping"
                  >
                    {deletingId === m.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Trash2 size={14} />
                    )}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add form */}
      {adding ? (
        <form onSubmit={handleAdd} className="rounded-lg border bg-white p-4 space-y-3">
          <p className="text-sm font-medium text-slate-700">New mapping</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">External account code *</label>
              <Input
                value={form.sourceAccountCode}
                onChange={(e) => setForm((f) => ({ ...f, sourceAccountCode: e.target.value }))}
                placeholder="e.g. 4100"
                required
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">External account name</label>
              <Input
                value={form.sourceAccountName}
                onChange={(e) => setForm((f) => ({ ...f, sourceAccountName: e.target.value }))}
                placeholder="e.g. Revenue"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">FINOS account *</label>
              <select
                value={form.finosAccountId}
                onChange={(e) => setForm((f) => ({ ...f, finosAccountId: e.target.value }))}
                required
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Select account…</option>
                {coaOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Notes</label>
              <Input
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Optional"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={saving}>
              {saving && <Loader2 size={13} className="mr-1 animate-spin" />}
              Save mapping
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setAdding(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setAdding(true)}
        >
          <Plus size={14} className="mr-1" />
          Add mapping
        </Button>
      )}
    </div>
  );
}
