"use client";

import { useState, useTransition } from "react";
import { useRouter }               from "next/navigation";
import { toast }                   from "sonner";
import { Plus, Pencil, Trash2, Star, X, Check } from "lucide-react";
import { Button }  from "@/components/ui/button";
import { Input }   from "@/components/ui/input";
import { Label }   from "@/components/ui/label";
import { Badge }   from "@/components/ui/badge";
import { cn }      from "@/lib/utils";
import {
  TaxRate, TaxType,
  createTaxRate, updateTaxRate, deleteTaxRate,
} from "@/lib/taxes/service";

// ─── Type badge ───────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<TaxType, string> = {
  VAT:    "bg-blue-100 text-blue-700",
  WHT:    "bg-amber-100 text-amber-700",
  PAYE:   "bg-violet-100 text-violet-700",
  CUSTOM: "bg-slate-100 text-slate-600",
};

function TypeBadge({ type }: { type: TaxType }) {
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wide", TYPE_COLORS[type])}>
      {type}
    </span>
  );
}

// ─── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none",
        checked ? "bg-[var(--finos-accent)]" : "bg-slate-200",
      )}
    >
      <span className={cn("pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform", checked ? "translate-x-4" : "translate-x-0")} />
    </button>
  );
}

// ─── Drawer ───────────────────────────────────────────────────────────────────

interface DrawerProps {
  initial?: Partial<TaxRate>;
  onClose:  () => void;
  onSaved:  (rate: TaxRate) => void;
}

function TaxDrawer({ initial, onClose, onSaved }: DrawerProps) {
  const isEdit = !!initial?.id;
  const [name,      setName]      = useState(initial?.name      ?? "");
  const [type,      setType]      = useState<TaxType>(initial?.type ?? "VAT");
  const [rate,      setRate]      = useState(String(initial?.rate ?? ""));
  const [isDefault, setIsDefault] = useState(initial?.isDefault ?? false);
  const [saving,    setSaving]    = useState(false);

  async function handleSave() {
    const parsed = parseFloat(rate);
    if (!name.trim())            return toast.error("Name is required");
    if (isNaN(parsed) || parsed < 0 || parsed > 100)
      return toast.error("Rate must be 0–100");

    setSaving(true);
    try {
      const result = isEdit
        ? await updateTaxRate(initial!.id!, { name: name.trim(), type, rate: parsed, isDefault })
        : await createTaxRate({ name: name.trim(), type, rate: parsed, isDefault });
      onSaved(result);
      toast.success(isEdit ? "Tax rate updated" : "Tax rate created");
      onClose();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[60] bg-black/30" onClick={onClose} />

      {/* Panel */}
      <div className="fixed right-0 top-0 bottom-0 z-[70] w-[360px] bg-white shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 h-14 border-b border-slate-200 shrink-0">
          <h2 className="text-[15px] font-semibold text-slate-800">
            {isEdit ? "Edit Tax Rate" : "New Tax Rate"}
          </h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tax-name">Tax Name</Label>
            <Input
              id="tax-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. VAT Standard Rate"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tax-type">Type</Label>
            <select
              id="tax-type"
              value={type}
              onChange={(e) => setType(e.target.value as TaxType)}
              className="w-full h-9 px-3 text-sm border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25"
            >
              <option value="VAT">VAT</option>
              <option value="WHT">WHT</option>
              <option value="PAYE">PAYE</option>
              <option value="CUSTOM">Custom</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tax-rate">Rate (%)</Label>
            <Input
              id="tax-rate"
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="e.g. 7.5"
            />
          </div>

          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-medium text-slate-700">Set as Default</p>
              <p className="text-xs text-slate-400">Used as the default for this tax type</p>
            </div>
            <Toggle checked={isDefault} onChange={setIsDefault} />
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 px-5 py-4 border-t border-slate-200 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Save Changes" : "Create Rate"}
          </Button>
        </div>
      </div>
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  taxRates: TaxRate[];
}

export function RatesClient({ taxRates: initial }: Props) {
  const router                      = useRouter();
  const [rates, setRates]           = useState<TaxRate[]>(initial);
  const [drawer, setDrawer]         = useState<"new" | TaxRate | null>(null);
  const [deleting, setDeleting]     = useState<string | null>(null);
  const [, startTransition]         = useTransition();

  function handleSaved(rate: TaxRate) {
    setRates((prev) => {
      const idx = prev.findIndex((r) => r.id === rate.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = rate;
        return next;
      }
      return [...prev, rate];
    });
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await deleteTaxRate(id);
      setRates((prev) => prev.filter((r) => r.id !== id));
      toast.success("Tax rate deactivated");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="px-8 py-7 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-[17px] font-semibold text-slate-800">Active Taxes</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Manage VAT, WHT, PAYE, and custom tax rates for your organisation.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full font-medium">
            {rates.length} rate{rates.length !== 1 ? "s" : ""}
          </span>
          <Button size="sm" onClick={() => setDrawer("new")}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New Tax
          </Button>
        </div>
      </div>

      {/* Table */}
      {rates.length === 0 ? (
        <div className="border border-dashed border-slate-200 rounded-xl py-16 text-center">
          <p className="text-slate-500 text-sm">No tax rates found.</p>
          <p className="text-slate-400 text-xs mt-1">Create your first tax rate to get started.</p>
          <Button size="sm" className="mt-4" onClick={() => setDrawer("new")}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Create Tax Rate
          </Button>
        </div>
      ) : (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Tax Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Type</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Rate (%)</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Default</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rates.map((rate, idx) => (
                <tr
                  key={rate.id}
                  className={cn(
                    "border-b border-slate-100 last:border-0 transition-colors",
                    idx % 2 === 0 ? "bg-white" : "bg-slate-50/40",
                  )}
                >
                  <td className="px-4 py-3 font-medium text-slate-800">{rate.name}</td>
                  <td className="px-4 py-3"><TypeBadge type={rate.type} /></td>
                  <td className="px-4 py-3 text-right text-slate-700 font-mono">{rate.rate.toFixed(2)}%</td>
                  <td className="px-4 py-3 text-center">
                    {rate.isDefault && (
                      <Star className="h-3.5 w-3.5 text-amber-400 inline-block" />
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setDrawer(rate)}
                        className="p-1.5 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                        title="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(rate.id)}
                        disabled={deleting === rate.id}
                        className="p-1.5 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                        title="Deactivate"
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

      {/* Drawer */}
      {drawer && (
        <TaxDrawer
          initial={drawer === "new" ? undefined : drawer}
          onClose={() => setDrawer(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
