"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Pencil, Trash2, Plus, Check, X } from "lucide-react";

type TaxType = "VAT" | "WHT" | "PAYE" | "CUSTOM";

interface TaxRate {
  id: string;
  name: string;
  type: TaxType;
  rate: number;
  isDefault: boolean;
  isActive: boolean;
}

const TAX_TYPE_COLORS: Record<TaxType, string> = {
  VAT:    "bg-blue-100 text-blue-700",
  WHT:    "bg-orange-100 text-orange-700",
  PAYE:   "bg-violet-100 text-violet-700",
  CUSTOM: "bg-slate-100 text-slate-600",
};

const EMPTY_FORM = { name: "", type: "VAT" as TaxType, rate: "", isDefault: false };

interface EditRow {
  id: string;
  name: string;
  type: TaxType;
  rate: string;
  isDefault: boolean;
}

interface Props {
  taxRates: TaxRate[];
}

export default function TaxesClient({ taxRates: initial }: Props) {
  const [rates, setRates] = useState<TaxRate[]>(initial);
  const [form, setForm] = useState(EMPTY_FORM);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editRow, setEditRow] = useState<EditRow | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  function setF(key: string, val: string | boolean) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  async function handleAdd() {
    if (!form.name.trim() || !form.rate) return;
    setAdding(true);
    try {
      const res = await fetch("/api/settings/taxes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:      form.name.trim(),
          type:      form.type,
          rate:      parseFloat(form.rate),
          isDefault: form.isDefault,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create tax rate");

      // If new one is default, clear old defaults of same type in UI
      if (form.isDefault) {
        setRates((prev) =>
          prev
            .map((r) =>
              r.type === form.type && r.isDefault ? { ...r, isDefault: false } : r
            )
            .concat(data)
        );
      } else {
        setRates((prev) => [...prev, data]);
      }
      setForm(EMPTY_FORM);
      toast.success("Tax rate added.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Error adding tax rate.");
    } finally {
      setAdding(false);
    }
  }

  async function handleEdit() {
    if (!editRow) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/settings/taxes/${editRow.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:      editRow.name,
          type:      editRow.type,
          rate:      parseFloat(editRow.rate),
          isDefault: editRow.isDefault,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update");

      setRates((prev) =>
        prev.map((r) => {
          if (r.id === editRow.id) return { ...r, ...data };
          if (editRow.isDefault && r.type === editRow.type && r.isDefault)
            return { ...r, isDefault: false };
          return r;
        })
      );
      setEditRow(null);
      toast.success("Tax rate updated.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Error updating tax rate.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Deactivate this tax rate?")) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/settings/taxes/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to delete");
      setRates((prev) => prev.filter((r) => r.id !== id));
      toast.success("Tax rate removed.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Error removing tax rate.");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Add Form */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-700">
          Add Tax Rate
        </h2>
        <div className="grid gap-3 sm:grid-cols-[1fr_140px_120px_auto_auto]">
          <div className="space-y-1">
            <Label htmlFor="tax-name">Name</Label>
            <Input
              id="tax-name"
              placeholder="e.g. Standard VAT"
              value={form.name}
              onChange={(e) => setF("name", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="tax-type">Type</Label>
            <Select
              value={form.type}
              onValueChange={(v) => setF("type", v ?? "VAT")}
            >
              <SelectTrigger id="tax-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["VAT", "WHT", "PAYE", "CUSTOM"] as TaxType[]).map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="tax-rate">Rate (%)</Label>
            <Input
              id="tax-rate"
              type="number"
              min={0}
              max={100}
              step={0.01}
              placeholder="7.5"
              value={form.rate}
              onChange={(e) => setF("rate", e.target.value)}
            />
          </div>
          <div className="flex flex-col justify-end space-y-1 pb-0.5">
            <Label className="text-xs text-slate-500">Default</Label>
            <div className="flex items-center h-9">
              <Checkbox
                checked={form.isDefault}
                onCheckedChange={(v) => setF("isDefault", !!v)}
              />
            </div>
          </div>
          <div className="flex items-end">
            <Button
              onClick={handleAdd}
              disabled={adding || !form.name.trim() || !form.rate}
              className="w-full"
            >
              <Plus className="mr-1 h-4 w-4" />
              {adding ? "Adding…" : "Add"}
            </Button>
          </div>
        </div>
      </div>

      {/* Rates Table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Tax Rates ({rates.length})
          </h2>
        </div>
        {rates.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-slate-400">
            No tax rates yet. Add one above.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Rate</TableHead>
                <TableHead>Default</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rates.map((r) =>
                editRow?.id === r.id ? (
                  <TableRow key={r.id} className="bg-slate-50">
                    <TableCell>
                      <Input
                        value={editRow.name}
                        onChange={(e) =>
                          setEditRow({ ...editRow, name: e.target.value })
                        }
                        className="h-8 text-sm"
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={editRow.type}
                        onValueChange={(v) =>
                          setEditRow({ ...editRow, type: (v ?? editRow.type) as TaxType })
                        }
                      >
                        <SelectTrigger className="h-8 w-28 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(["VAT", "WHT", "PAYE", "CUSTOM"] as TaxType[]).map((t) => (
                            <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step={0.01}
                        value={editRow.rate}
                        onChange={(e) =>
                          setEditRow({ ...editRow, rate: e.target.value })
                        }
                        className="h-8 w-24 text-sm"
                      />
                    </TableCell>
                    <TableCell>
                      <Checkbox
                        checked={editRow.isDefault}
                        onCheckedChange={(v) =>
                          setEditRow({ ...editRow, isDefault: !!v })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-emerald-600"
                          disabled={saving}
                          onClick={handleEdit}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-slate-400"
                          onClick={() => setEditRow(null)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>
                      <Badge className={TAX_TYPE_COLORS[r.type]}>{r.type}</Badge>
                    </TableCell>
                    <TableCell>{Number(r.rate).toFixed(2)}%</TableCell>
                    <TableCell>
                      {r.isDefault && (
                        <Badge className="bg-emerald-100 text-emerald-700">Default</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-slate-400 hover:text-blue-600"
                          onClick={() =>
                            setEditRow({
                              id:        r.id,
                              name:      r.name,
                              type:      r.type,
                              rate:      String(r.rate),
                              isDefault: r.isDefault,
                            })
                          }
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-slate-400 hover:text-red-600"
                          disabled={deleting === r.id}
                          onClick={() => handleDelete(r.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              )}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
