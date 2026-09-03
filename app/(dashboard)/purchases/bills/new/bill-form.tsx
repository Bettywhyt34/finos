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
interface TaxRate { id: string; name: string; rate: number; }
interface LineItem {
  id: string;
  itemId: string;
  description: string;
  quantity: number;
  rate: number;
  accountId: string;
  taxRateId: string;
  recogniseCostOnBillDate: boolean;
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function today() { return localDateString(); }
function addDays(d: string, n: number) {
  const [year, month, day] = d.split("-").map(Number);
  const dt = new Date(year, month - 1, day);
  dt.setDate(dt.getDate() + n);
  return localDateString(dt);
}
function emptyLine(): LineItem {
  return { id: crypto.randomUUID(), itemId: "", description: "", quantity: 1, rate: 0, accountId: "", taxRateId: "", recogniseCostOnBillDate: true };
}

export function BillForm({
  baseCurrency,
  vendors,
  items,
  accounts,
  taxRates,
}: {
  baseCurrency: string;
  vendors: Vendor[];
  items: Item[];
  accounts: Account[];
  taxRates: TaxRate[];
}) {
  const router = useRouter();
  const normalBaseCurrency = baseCurrency.trim().toUpperCase();
  const currencies = Array.from(new Set([normalBaseCurrency, ...SUPPORTED_CURRENCIES]));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vendorId, setVendorId] = useState("");
  const [billDate, setBillDate] = useState(today());
  const [dueDate, setDueDate] = useState(addDays(today(), 30));
  const [currency, setCurrency] = useState(normalBaseCurrency);
  const [exchangeRate, setExchangeRate] = useState(1);
  const [rateLoading, setRateLoading] = useState(false);
  const [rateFetched, setRateFetched] = useState(false);
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);

  const isBaseCurrency = currency === normalBaseCurrency;

  const fetchRate = useCallback(async (from: string) => {
    if (from === normalBaseCurrency) {
      setExchangeRate(1);
      setRateFetched(false);
      return;
    }
    setRateLoading(true);
    setRateFetched(false);
    try {
      const res = await fetch(`https://api.frankfurter.app/latest?from=${encodeURIComponent(from)}&to=${encodeURIComponent(normalBaseCurrency)}`);
      if (!res.ok) throw new Error("Rate provider did not return a rate");
      const json = await res.json() as { rates?: Record<string, number> };
      const rate = json.rates?.[normalBaseCurrency];
      if (!rate || !Number.isFinite(rate) || rate <= 0) throw new Error("Rate unavailable");
      setExchangeRate(rate);
      setRateFetched(true);
    } catch {
      toast.error(`Could not fetch a live ${from}/${normalBaseCurrency} rate — enter the actual rate manually`);
    } finally {
      setRateLoading(false);
    }
  }, [normalBaseCurrency]);

  useEffect(() => { void fetchRate(currency); }, [currency, fetchRate]);

  function handleVendorChange(id: string) {
    setVendorId(id);
    const v = vendors.find((vendor) => vendor.id === id);
    if (v) setDueDate(addDays(billDate, v.paymentTerms));
  }

  function handleItemSelect(lineId: string, itemId: string) {
    const item = items.find((candidate) => candidate.id === itemId);
    setLines((prev) => prev.map((line) => line.id === lineId
      ? { ...line, itemId, description: item?.name || "", rate: item?.costPrice ?? 0 }
      : line
    ));
  }

  function updateLine(lineId: string, field: keyof LineItem, value: string | number | boolean) {
    setLines((prev) => prev.map((line) => line.id === lineId ? { ...line, [field]: value } : line));
  }

  function handleAccountChange(lineId: string, accountId: string) {
    const account = accounts.find((item) => item.id === accountId);
    setLines((prev) => prev.map((line) => line.id === lineId
      ? { ...line, accountId, recogniseCostOnBillDate: account?.type === "EXPENSE" ? line.recogniseCostOnBillDate : true }
      : line));
  }

  function lineTax(line: LineItem) {
    const tax = taxRates.find((rate) => rate.id === line.taxRateId);
    const base = line.quantity * line.rate;
    return tax ? base * tax.rate / 100 : 0;
  }

  const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.rate, 0);
  const taxTotal = lines.reduce((sum, line) => sum + lineTax(line), 0);
  const total = subtotal + taxTotal;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!vendorId) { setError("Please select a vendor"); return; }
    if (lines.some((line) => !line.accountId)) { setError("Each line must have an expense or asset account"); return; }
    if (lines.some((line) => !line.description.trim() || line.quantity <= 0 || line.rate < 0)) {
      setError("Each line needs a description, positive quantity and valid rate");
      return;
    }
    if (!isBaseCurrency && (!Number.isFinite(exchangeRate) || exchangeRate <= 0)) {
      setError("Please enter a valid exchange rate");
      return;
    }
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
      exchangeRate: isBaseCurrency ? 1 : exchangeRate,
      lines: lines.map((line) => ({
        itemId: line.itemId || undefined,
        description: line.description,
        quantity: line.quantity,
        rate: line.rate,
        accountId: line.accountId,
        taxRateId: line.taxRateId || undefined,
        costRecognitionMode: line.recogniseCostOnBillDate ? "IMMEDIATE" : "PREPAID",
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
            <Select value={vendorId} onValueChange={(value) => handleVendorChange(value ?? "")}>
              <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
              <SelectContent>
                {vendors.map((vendor) => <SelectItem key={vendor.id} value={vendor.id}>{vendor.companyName}</SelectItem>)}
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
            <Select value={currency} onValueChange={(value) => setCurrency(value ?? normalBaseCurrency)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {currencies.map((code) => <SelectItem key={code} value={code}>{code}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {!isBaseCurrency && (
        <div className="border border-amber-200 bg-amber-50 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-amber-900">Exchange Rate</h2>
            <div className="flex items-center gap-2">
              {rateLoading && <span className="text-xs text-amber-600 animate-pulse">Fetching…</span>}
              {rateFetched && !rateLoading && <span className="text-xs text-green-600 font-medium">✓ Suggested live rate</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-amber-800 whitespace-nowrap">1 {currency} =</span>
            <Input type="number" min="0.000001" step="0.000001" value={exchangeRate}
              onChange={(e) => setExchangeRate(parseFloat(e.target.value) || 0)} className="font-mono" />
            <span className="text-sm text-amber-800">{normalBaseCurrency}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void fetchRate(currency)}
              disabled={rateLoading} className="whitespace-nowrap border-amber-300 text-amber-700 hover:bg-amber-100">
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${rateLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
          <p className="text-xs text-amber-700">The suggested rate is editable. Enter the actual transaction rate if it differs.</p>
          {exchangeRate > 0 && total > 0 && (
            <div className="bg-white rounded-lg px-4 py-3 text-xs border border-amber-100">
              <div className="flex justify-between font-semibold text-slate-900">
                <span>Gross total ({normalBaseCurrency} equivalent)</span>
                <span className="font-mono">{formatCurrency(total * exchangeRate, normalBaseCurrency)}</span>
              </div>
              <p className="text-slate-400 mt-1">The Bill journal uses the rate saved with this transaction.</p>
            </div>
          )}
        </div>
      )}

      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
          <span className="font-medium text-sm text-slate-700">
            Line Items <span className="text-slate-400 font-normal">(amounts in {currency})</span>
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={() => setLines((previous) => [...previous, emptyLine()])}>
            <Plus className="h-3.5 w-3.5 mr-1" />Add line
          </Button>
        </div>
        <div className="divide-y divide-slate-100">
          {lines.map((line, idx) => {
            const selectedAccount = accounts.find((account) => account.id === line.accountId);
            const canDefer = selectedAccount?.type === "EXPENSE";
            return (
            <div key={line.id} className="p-4 grid grid-cols-12 gap-3 items-start">
              <div className="col-span-2">
                {idx === 0 && <Label className="block mb-1.5 text-xs">Item</Label>}
                <Select value={line.itemId} onValueChange={(value) => handleItemSelect(line.id, value ?? "")}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Item" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Custom</SelectItem>
                    {items.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                {idx === 0 && <Label className="block mb-1.5 text-xs">Description</Label>}
                <Input className="h-8 text-xs" value={line.description}
                  onChange={(e) => updateLine(line.id, "description", e.target.value)} />
              </div>
              <div className="col-span-1">
                {idx === 0 && <Label className="block mb-1.5 text-xs">Qty</Label>}
                <Input className="h-8 text-xs" type="number" min="0.01" step="0.01" value={line.quantity}
                  onChange={(e) => updateLine(line.id, "quantity", parseFloat(e.target.value) || 0)} />
              </div>
              <div className="col-span-2">
                {idx === 0 && <Label className="block mb-1.5 text-xs">Rate ({currency})</Label>}
                <Input className="h-8 text-xs font-mono" type="number" min="0" step="0.01" value={line.rate}
                  onChange={(e) => updateLine(line.id, "rate", parseFloat(e.target.value) || 0)} />
              </div>
              <div className="col-span-2">
                {idx === 0 && <Label className="block mb-1.5 text-xs">VAT</Label>}
                <Select value={line.taxRateId || "NONE"} onValueChange={(value) => updateLine(line.id, "taxRateId", value === "NONE" ? "" : (value ?? ""))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="No VAT" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">No VAT</SelectItem>
                    {taxRates.map((tax) => (
                      <SelectItem key={tax.id} value={tax.id}>{tax.name} ({tax.rate}%)</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                {idx === 0 && <Label className="block mb-1.5 text-xs">Expense / Asset</Label>}
                <Select value={line.accountId} onValueChange={(value) => handleAccountChange(line.id, value ?? "")}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Account" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.code} — {account.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-1 flex items-end">
                <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-400 hover:text-red-500"
                  onClick={() => lines.length > 1 && setLines((previous) => previous.filter((item) => item.id !== line.id))}
                  disabled={lines.length === 1}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              {canDefer && (
                <label className="col-span-12 flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <input type="checkbox" checked={line.recogniseCostOnBillDate} onChange={(e) => updateLine(line.id, "recogniseCostOnBillDate", e.target.checked)} />
                  <span><span className="font-medium text-slate-800">Recognise cost on Bill date</span> — uncheck if this is a prepaid cost to recognise later.</span>
                </label>
              )}
            </div>
          );})}
        </div>
        <div className="border-t border-slate-200 p-4 bg-slate-50">
          <div className="ml-auto max-w-sm space-y-1.5 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal</span>
              <span className="font-mono">{formatCurrency(subtotal, currency)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>VAT</span>
              <span className="font-mono">{formatCurrency(taxTotal, currency)}</span>
            </div>
            <div className="flex justify-between font-semibold border-t border-slate-200 pt-1.5">
              <span>Total</span>
              <span className="font-mono">{formatCurrency(total, currency)}</span>
            </div>
            {!isBaseCurrency && exchangeRate > 0 && (
              <div className="flex justify-between text-xs text-slate-400">
                <span>≈ {normalBaseCurrency} gross total</span>
                <span className="font-mono">{formatCurrency(total * exchangeRate, normalBaseCurrency)}</span>
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
        <Button type="submit" disabled={loading || (!isBaseCurrency && rateLoading)}>
          {loading ? "Creating…" : "Create Bill"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
