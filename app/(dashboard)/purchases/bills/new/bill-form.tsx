"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createBill } from "../actions";
import { formatCurrency } from "@/lib/utils";
import { SUPPORTED_CURRENCIES } from "@/lib/fx";

interface Vendor { id: string; companyName: string; vendorCode: string; paymentTerms: number; }
interface Item { id: string; itemCode: string; name: string; costPrice: number | null; }
interface Account { id: string; code: string; name: string; type: string; }
interface LineItem { id: string; itemId: string; description: string; quantity: number; rate: number; accountId: string; }

function today() { return new Date().toISOString().split("T")[0]; }
function addDays(d: string, n: number) { const dt = new Date(d); dt.setDate(dt.getDate() + n); return dt.toISOString().split("T")[0]; }

export function BillForm({ vendors, items, accounts }: { vendors: Vendor[]; items: Item[]; accounts: Account[]; }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vendorId, setVendorId] = useState("");
  const [billDate, setBillDate] = useState(today());
  const [dueDate, setDueDate] = useState(addDays(today(), 30));
  const [currency, setCurrency] = useState("NGN");
  const [exchangeRate, setExchangeRate] = useState(1);
  const [rateLoading, setRateLoading] = useState(false);
  const [rateFetched, setRateFetched] = useState(false);
  const [lines, setLines] = useState<LineItem[]>([
    { id: crypto.randomUUID(), itemId: "", description: "", quantity: 1, rate: 0, accountId: "" },
  ]);

  const isNGN = currency === "NGN";

  const fetchRate = useCallback(async (from: string) => {
    if (from === "NGN") { setExchangeRate(1); setRateFetched(false); return; }
    setRateLoading(true);
    setRateFetched(false);
    try {
      const res = await fetch(`https://api.frankfurter.app/latest?from=${from}&to=NGN`);
      const json = await res.json() as { rates?: Record<string, number> };
      const rate = json.rates?.NGN;
      if (rate) { setExchangeRate(rate); setRateFetched(true); }
    } catch {
      toast.error("Could not fetch live rate — enter manually");
    } finally {
      setRateLoading(false);
    }
  }, []);

  useEffect(() => { fetchRate(currency); }, [currency, fetchRate]);

  function handleVendorChange(id: string) {
    setVendorId(id);
    const v = vendors.find((v) => v.id === id);
    if (v) setDueDate(addDays(billDate, v.paymentTerms));
  }

  function handleItemSelect(lineId: string, itemId: string) {
    const item = items.find((i) => i.id === itemId);
    setLines((prev) => prev.map((l) => l.id === lineId
      ? { ...l, itemId, description: item?.name || "", rate: item?.costPrice ?? 0 }
      : l
    ));
  }

  function updateLine(lineId: string, field: keyof LineItem, value: string | number) {
    setLines((prev) => prev.map((l) => l.id === lineId ? { ...l, [field]: value } : l));
  }

  const subtotal = lines.reduce((s, l) => s + l.quantity * l.rate, 0);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!vendorId) { setError("Please select a vendor"); return; }
    if (lines.some((l) => !l.accountId)) { setError("Each line must have an expense account"); return; }
    if (!isNGN && exchangeRate <= 0) { setError("Please enter a valid exchange rate"); return; }
    setLoading(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const result = await createBill({
      vendorId,
      vendorRef: String(fd.get("vendorRef") || ""),
      billDate,
      dueDate,
      notes: String(fd.get("notes") || ""),
      currency,
      exchangeRate: isNGN ? 1 : exchangeRate,
      lines: lines.map((l) => ({
        itemId: l.itemId || undefined,
        description: l.description,
        quantity: l.quantity,
        rate: l.rate,
        accountId: l.accountId,
      })),
    });
    setLoading(false);
    if (result?.error) { setError(result.error); return; }
    toast.success("Bill created");
    router.push(`/purchases/bills/${result.id}`);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Vendor *</Label>
            <Select value={vendorId} onValueChange={(v) => handleVendorChange(v ?? "")}>
              <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
              <SelectContent>
                {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.companyName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vendorRef">Vendor Reference</Label>
            <Input id="vendorRef" name="vendorRef" placeholder="Vendor invoice number" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label>Bill Date</Label>
            <Input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Due Date</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Currency</Label>
            <Select value={currency} onValueChange={(v) => setCurrency(v ?? "NGN")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SUPPORTED_CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* FX Rate */}
      {!isNGN && (
        <div className="border border-amber-200 bg-amber-50 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-amber-900">Exchange Rate</h2>
            <div className="flex items-center gap-2">
              {rateLoading && <span className="text-xs text-amber-600 animate-pulse">Fetching…</span>}
              {rateFetched && !rateLoading && <span className="text-xs text-green-600 font-medium">✓ Live rate</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-amber-800 whitespace-nowrap">1 {currency} =</span>
            <Input type="number" min="0.0001" step="0.0001" value={exchangeRate}
              onChange={(e) => setExchangeRate(parseFloat(e.target.value) || 1)} className="font-mono" />
            <span className="text-sm text-amber-800">NGN</span>
            <Button type="button" variant="outline" size="sm" onClick={() => fetchRate(currency)}
              disabled={rateLoading} className="whitespace-nowrap border-amber-300 text-amber-700 hover:bg-amber-100">
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${rateLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
          {exchangeRate > 0 && subtotal > 0 && (
            <div className="bg-white rounded-lg px-4 py-3 text-xs border border-amber-100">
              <div className="flex justify-between font-semibold text-slate-900">
                <span>Total (NGN equivalent)</span>
                <span className="font-mono">{formatCurrency(subtotal * exchangeRate)}</span>
              </div>
              <p className="text-slate-400 mt-1">Journals will post at this NGN equivalent.</p>
            </div>
          )}
        </div>
      )}

      {/* Line items */}
      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
          <span className="font-medium text-sm text-slate-700">
            Line Items <span className="text-slate-400 font-normal">(amounts in {currency})</span>
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={() =>
            setLines((p) => [...p, { id: crypto.randomUUID(), itemId: "", description: "", quantity: 1, rate: 0, accountId: "" }])
          }>
            <Plus className="h-3.5 w-3.5 mr-1" />Add line
          </Button>
        </div>
        <div className="divide-y divide-slate-100">
          {lines.map((line, idx) => (
            <div key={line.id} className="p-4 grid grid-cols-12 gap-3 items-start">
              <div className="col-span-2">
                {idx === 0 && <Label className="block mb-1.5 text-xs">Item</Label>}
                <Select value={line.itemId} onValueChange={(v) => handleItemSelect(line.id, v ?? "")}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Item" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Custom</SelectItem>
                    {items.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-3">
                {idx === 0 && <Label className="block mb-1.5 text-xs">Description</Label>}
                <Input className="h-8 text-xs" value={line.description}
                  onChange={(e) => updateLine(line.id, "description", e.target.value)} />
              </div>
              <div className="col-span-1">
                {idx === 0 && <Label className="block mb-1.5 text-xs">Qty</Label>}
                <Input className="h-8 text-xs" type="number" min="0" step="0.01" value={line.quantity}
                  onChange={(e) => updateLine(line.id, "quantity", parseFloat(e.target.value) || 0)} />
              </div>
              <div className="col-span-2">
                {idx === 0 && <Label className="block mb-1.5 text-xs">Rate ({currency})</Label>}
                <Input className="h-8 text-xs font-mono" type="number" min="0" step="0.01" value={line.rate}
                  onChange={(e) => updateLine(line.id, "rate", parseFloat(e.target.value) || 0)} />
              </div>
              <div className="col-span-3">
                {idx === 0 && <Label className="block mb-1.5 text-xs">Expense Account</Label>}
                <Select value={line.accountId} onValueChange={(v) => updateLine(line.id, "accountId", v ?? "")}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Account" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-1 flex items-end">
                <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-400 hover:text-red-500"
                  onClick={() => lines.length > 1 && setLines((p) => p.filter((l) => l.id !== line.id))}
                  disabled={lines.length === 1}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-slate-200 p-4 bg-slate-50">
          <div className="flex flex-col items-end gap-1.5 text-sm">
            <div className="flex gap-8 font-semibold">
              <span>Total</span>
              <span className="font-mono w-32 text-right">{formatCurrency(subtotal, currency)}</span>
            </div>
            {!isNGN && exchangeRate > 0 && (
              <div className="flex gap-8 text-xs text-slate-400">
                <span>≈ NGN equivalent</span>
                <span className="font-mono w-32 text-right">{formatCurrency(subtotal * exchangeRate)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes</Label>
        <Input id="notes" name="notes" />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-3">
        <Button type="submit" disabled={loading || (!isNGN && rateLoading)}>
          {loading ? "Creating…" : "Create Bill"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
