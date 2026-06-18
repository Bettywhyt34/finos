"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateDraftInvoice } from "../../actions";
import { formatCurrency } from "@/lib/utils";
import { SUPPORTED_CURRENCIES } from "@/lib/fx";

interface Customer { id: string; companyName: string; customerCode: string; paymentTerms: number; }
interface Item { id: string; itemCode: string; name: string; salesPrice: number | null; type: string; }
interface LineItem { id: string; itemId: string; description: string; quantity: number; rate: number; taxRate: number; }

interface InitialData {
  customerId:        string;
  invoiceNumber:     string;
  reference:         string;
  issueDate:         string;
  dueDate:           string;
  recognitionPeriod: string;
  currency:          string;
  exchangeRate:      number;
  discountAmount:    number;
  notes:             string;
  lines: { itemId: string; description: string; quantity: number; rate: number; taxRate: number; }[];
}

interface Props {
  invoiceId:           string;
  initialData:         InitialData;
  customers:           Customer[];
  items:               Item[];
  allowManualOverride: boolean;
}

function addDays(d: string, n: number) {
  const dt = new Date(d);
  dt.setDate(dt.getDate() + n);
  return dt.toISOString().split("T")[0];
}
function getMonthPeriod(d: string) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
}

export function InvoiceEditForm({ invoiceId, initialData, customers, items, allowManualOverride }: Props) {
  const router = useRouter();
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [customerId, setCustomerId]               = useState(initialData.customerId);
  const [invoiceNumber, setInvoiceNumber]         = useState(initialData.invoiceNumber);
  const [invoiceNumberTouched, setInvoiceNumberTouched] = useState(false);
  const [reference, setReference]                 = useState(initialData.reference);
  const [issueDate, setIssueDate]                 = useState(initialData.issueDate);
  const [dueDate, setDueDate]                     = useState(initialData.dueDate);
  const [recognitionPeriod, setRecognitionPeriod] = useState(initialData.recognitionPeriod);
  const [currency, setCurrency]                   = useState(initialData.currency);
  const [exchangeRate, setExchangeRate]           = useState(initialData.exchangeRate);
  const [rateLoading, setRateLoading]             = useState(false);
  const [rateFetched, setRateFetched]             = useState(false);
  const [discountAmount, setDiscountAmount]       = useState(initialData.discountAmount);
  const [notes, setNotes]                         = useState(initialData.notes);
  const [lines, setLines] = useState<LineItem[]>(
    initialData.lines.length > 0
      ? initialData.lines.map((l) => ({ ...l, id: crypto.randomUUID() }))
      : [{ id: crypto.randomUUID(), itemId: "", description: "", quantity: 1, rate: 0, taxRate: 0 }]
  );

  const isNGN = currency === "NGN";

  const fetchRate = useCallback(async (from: string) => {
    if (from === "NGN") { setExchangeRate(1); setRateFetched(false); return; }
    setRateLoading(true);
    setRateFetched(false);
    try {
      const res  = await fetch(`https://api.frankfurter.app/latest?from=${from}&to=NGN`);
      const json = await res.json() as { rates?: Record<string, number> };
      const rate = json.rates?.NGN;
      if (rate) { setExchangeRate(rate); setRateFetched(true); }
    } catch {
      toast.error("Could not fetch live rate — enter manually");
    } finally {
      setRateLoading(false);
    }
  }, []);

  function handleCurrencyChange(val: string) {
    setCurrency(val);
    if (val === "NGN") { setExchangeRate(1); setRateFetched(false); }
    else void fetchRate(val);
  }

  function handleCustomerChange(id: string) {
    setCustomerId(id);
    const cust = customers.find((c) => c.id === id);
    if (cust) setDueDate(addDays(issueDate, cust.paymentTerms));
  }

  function handleIssueDateChange(val: string) {
    setIssueDate(val);
    setRecognitionPeriod(getMonthPeriod(val));
    const cust = customers.find((c) => c.id === customerId);
    if (cust) setDueDate(addDays(val, cust.paymentTerms));
  }

  function handleItemSelect(lineId: string, itemId: string) {
    const item = items.find((i) => i.id === itemId);
    setLines((prev) => prev.map((l) => l.id === lineId
      ? { ...l, itemId, description: item?.name || "", rate: item?.salesPrice ?? 0 }
      : l
    ));
  }

  function updateLine(lineId: string, field: keyof LineItem, value: string | number) {
    setLines((prev) => prev.map((l) => (l.id === lineId ? { ...l, [field]: value } : l)));
  }

  const subtotal  = lines.reduce((s, l) => s + l.quantity * l.rate, 0);
  const taxAmount = lines.reduce((s, l) => s + l.quantity * l.rate * (l.taxRate / 100), 0);
  const total     = subtotal - discountAmount + taxAmount;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!customerId) { setError("Please select a customer"); return; }
    if (!isNGN && exchangeRate <= 0) { setError("Please enter a valid exchange rate"); return; }
    setLoading(true);
    setError(null);

    const result = await updateDraftInvoice(invoiceId, {
      customerId,
      // Only pass invoice number if manually overridden and changed
      invoiceNumber: invoiceNumberTouched ? invoiceNumber.trim() : undefined,
      reference:     reference || undefined,
      issueDate,
      dueDate,
      discountAmount,
      recognitionPeriod,
      currency,
      exchangeRate: isNGN ? 1 : exchangeRate,
      lines: lines.map((l) => ({
        itemId:      l.itemId || undefined,
        description: l.description,
        quantity:    l.quantity,
        rate:        l.rate,
        taxRate:     l.taxRate,
      })),
      notes: notes || undefined,
    });

    setLoading(false);
    if (result?.error) { setError(result.error); return; }
    toast.success("Draft invoice updated");
    router.push(`/sales/invoices/${invoiceId}`);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">

      {/* Header fields */}
      <div className="border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Customer *</Label>
            <Select value={customerId} onValueChange={(v) => handleCustomerChange(v ?? "")}>
              <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
              <SelectContent>
                {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reference">Reference (optional)</Label>
            <Input
              id="reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="PO-12345"
            />
          </div>
        </div>

        {/* Invoice Number */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="invoiceNumber">Invoice Number</Label>
            {allowManualOverride ? (
              <>
                <Input
                  id="invoiceNumber"
                  value={invoiceNumber}
                  onChange={(e) => { setInvoiceNumber(e.target.value); setInvoiceNumberTouched(true); }}
                  className="font-mono"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Manual override enabled. The series counter will not advance.
                </p>
              </>
            ) : (
              <>
                <Input
                  id="invoiceNumber"
                  value={invoiceNumber}
                  readOnly
                  className="font-mono bg-slate-50 text-slate-600 cursor-not-allowed"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Invoice number is fixed. Enable manual override in Settings to change it.
                </p>
              </>
            )}
          </div>
        </div>

        {/* Currency + Period */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Invoice Currency</Label>
            <Select value={currency} onValueChange={(v) => handleCurrencyChange(v ?? "NGN")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SUPPORTED_CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Recognition Period</Label>
            <Input
              value={recognitionPeriod}
              onChange={(e) => setRecognitionPeriod(e.target.value)}
              placeholder="YYYY-MM"
            />
          </div>
        </div>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Issue Date</Label>
            <Input type="date" value={issueDate} onChange={(e) => handleIssueDateChange(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Due Date</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
      </div>

      {/* FX Rate — shown only for non-NGN currency */}
      {!isNGN && (
        <div className="border border-amber-200 bg-amber-50 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-amber-900">Exchange Rate</h2>
            <div className="flex items-center gap-2">
              {rateLoading && <span className="text-xs text-amber-600 animate-pulse">Fetching live rate…</span>}
              {rateFetched && !rateLoading && <span className="text-xs text-green-600 font-medium">✓ Live rate</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-amber-800 whitespace-nowrap">1 {currency} =</span>
            <Input
              type="number" min="0.0001" step="0.0001"
              value={exchangeRate}
              onChange={(e) => setExchangeRate(parseFloat(e.target.value) || 1)}
              className="font-mono"
              placeholder="e.g. 1580.50"
            />
            <span className="text-sm text-amber-800">NGN</span>
            <Button
              type="button" variant="outline" size="sm"
              onClick={() => void fetchRate(currency)}
              disabled={rateLoading}
              className="whitespace-nowrap border-amber-300 text-amber-700 hover:bg-amber-100"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${rateLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
          {exchangeRate > 0 && total > 0 && (
            <div className="bg-white rounded-lg px-4 py-3 text-xs border border-amber-100 space-y-1">
              <div className="flex justify-between text-slate-500">
                <span>Total (NGN equivalent)</span>
                <span className="font-mono font-semibold text-slate-700">{formatCurrency(total * exchangeRate)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Line items */}
      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
          <span className="font-medium text-sm text-slate-700">
            Line Items <span className="text-slate-400 font-normal">(prices in {currency})</span>
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={() =>
            setLines((p) => [...p, { id: crypto.randomUUID(), itemId: "", description: "", quantity: 1, rate: 0, taxRate: 0 }])
          }>
            <Plus className="h-3.5 w-3.5 mr-1" />Add line
          </Button>
        </div>
        <div className="divide-y divide-slate-100">
          {lines.map((line, idx) => (
            <div key={line.id} className="p-4 grid grid-cols-12 gap-3 items-start">
              <div className="col-span-3">
                {idx === 0 && <Label className="block mb-1.5 text-xs">Item</Label>}
                <Select value={line.itemId} onValueChange={(v) => handleItemSelect(line.id, v ?? "")}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select item" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Custom</SelectItem>
                    {items.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-3">
                {idx === 0 && <Label className="block mb-1.5 text-xs">Description</Label>}
                <Input className="h-8 text-xs" value={line.description}
                  onChange={(e) => updateLine(line.id, "description", e.target.value)}
                  placeholder="Description" />
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
              <div className="col-span-1">
                {idx === 0 && <Label className="block mb-1.5 text-xs">Tax%</Label>}
                <Input className="h-8 text-xs" type="number" min="0" max="100" step="0.5" value={line.taxRate}
                  onChange={(e) => updateLine(line.id, "taxRate", parseFloat(e.target.value) || 0)} />
              </div>
              <div className="col-span-1">
                {idx === 0 && <Label className="block mb-1.5 text-xs">Amount</Label>}
                <div className="h-8 flex items-center text-xs font-mono text-slate-600">
                  {formatCurrency(line.quantity * line.rate, currency)}
                </div>
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

        {/* Totals */}
        <div className="border-t border-slate-200 p-4 bg-slate-50">
          <div className="flex flex-col items-end gap-1.5 text-sm">
            <div className="flex gap-8">
              <span className="text-slate-500">Subtotal</span>
              <span className="font-mono w-32 text-right">{formatCurrency(subtotal, currency)}</span>
            </div>
            <div className="flex gap-8 items-center">
              <span className="text-slate-500">Discount</span>
              <Input type="number" min="0" step="0.01" value={discountAmount}
                onChange={(e) => setDiscountAmount(parseFloat(e.target.value) || 0)}
                className="h-6 w-32 text-xs text-right font-mono" />
            </div>
            {taxAmount > 0 && (
              <div className="flex gap-8">
                <span className="text-slate-500">Tax</span>
                <span className="font-mono w-32 text-right">{formatCurrency(taxAmount, currency)}</span>
              </div>
            )}
            <div className="flex gap-8 pt-1 border-t border-slate-300 mt-1">
              <span className="font-semibold text-slate-900">Total</span>
              <span className="font-bold font-mono w-32 text-right text-slate-900">{formatCurrency(total, currency)}</span>
            </div>
            {!isNGN && exchangeRate > 0 && (
              <div className="flex gap-8 text-xs text-slate-400 border-t border-dashed border-slate-200 pt-1 mt-0.5">
                <span>≈ NGN equivalent</span>
                <span className="font-mono w-32 text-right">{formatCurrency(total * exchangeRate)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes</Label>
        <Input
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Payment instructions, terms, etc."
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-3">
        <Button type="submit" disabled={loading || (!isNGN && rateLoading)}>
          {loading ? "Saving…" : "Save Changes"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push(`/sales/invoices/${invoiceId}`)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
