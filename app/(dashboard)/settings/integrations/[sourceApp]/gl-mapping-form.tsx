"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

type CoaOption = { id: string; code: string; name: string };

type GLMapping = {
  defaultRevenueAccount?: string;
  defaultExpenseAccount?: string;
  defaultBankAccount?: string;
};

export function GLMappingForm({
  sourceApp,
  initialMapping,
  coaOptions,
}: {
  sourceApp: string;
  initialMapping: GLMapping;
  coaOptions: CoaOption[];
}) {
  const [form, setForm] = useState<GLMapping>({
    defaultRevenueAccount: initialMapping.defaultRevenueAccount ?? "",
    defaultExpenseAccount: initialMapping.defaultExpenseAccount ?? "",
    defaultBankAccount:    initialMapping.defaultBankAccount    ?? "",
  });
  const [saving, setSaving] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/settings/integrations/${sourceApp}/gl-mapping`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success("GL mapping saved");
    } catch {
      toast.error("Failed to save GL mapping");
    } finally {
      setSaving(false);
    }
  }

  const fields: { key: keyof GLMapping; label: string; hint: string }[] = [
    {
      key:   "defaultRevenueAccount",
      label: "Default Revenue Account",
      hint:  "Used as the credit side for revenue entries (e.g. IN-001)",
    },
    {
      key:   "defaultExpenseAccount",
      label: "Default Expense Account",
      hint:  "Used as the debit side for expense/COGS entries (e.g. OE-001)",
    },
    {
      key:   "defaultBankAccount",
      label: "Default Bank / Cash Account",
      hint:  "Used as the debit side for cash receipts (e.g. CA-003)",
    },
  ];

  return (
    <form onSubmit={handleSave} className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-slate-800">Default GL Accounts</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          These defaults are used when a sync record has no specific account mapping.
        </p>
      </div>

      <div className="space-y-4">
        {fields.map(({ key, label, hint }) => (
          <div key={key}>
            <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
            <select
              value={form[key] ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            >
              <option value="">— None —</option>
              {coaOptions.map((c) => (
                <option key={c.id} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-400 mt-0.5">{hint}</p>
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? (
            <Loader2 size={13} className="mr-1 animate-spin" />
          ) : (
            <Save size={13} className="mr-1" />
          )}
          Save GL Mapping
        </Button>
      </div>
    </form>
  );
}
