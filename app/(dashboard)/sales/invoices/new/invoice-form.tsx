"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createInvoice } from "../actions";
import { formatCurrency } from "@/lib/utils";
import { SUPPORTED_CURRENCIES } from "@/lib/fx";
import {
  InvoiceLineItemsEditor,
  type LineItemData,
  type TaxRateOption,
  computeLineAmount,
  computeLineTax,
  buildTaxBreakdown,
  emptyLine,
} from "@/components/invoices/invoice-line-items-editor";

interface Customer { id: string; companyName: string; customerCode: string; paymentTerms: number; }
interface Item { id: string; itemCode: string; name: string; salesPrice: number | null; type: string; }
interface Account { id: string; code: string; name: string; }

function today() { return new Date().toISOString().split("T")[0]; }
function addDays(d: string, n: number) { const dt = new Date(d); dt.setDate(dt.getDate() + n); return dt.toISOString().split("T")[0]; }
function getMonthPeriod(d: string) { const dt = new Date(d); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`; }

export function InvoiceForm({
  customers,
  items,
  accounts: _accounts,
  taxRates,
}: {
  customers: Customer[];
  items: Item[];
  accounts: Account[];
  taxRates: TaxRateOption[];
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [issueDate, setIssueDate] = useState(today());
  const [dueDate, setDueDate] = useState(addDays(today(), 30));
  const [discountAmount, setDiscountAmount] = useState(0);
  const [recognitionPeriod, setRecognitionPeriod] = useState(getMonthPeriod(today()));
  const [currency, setCurrency] = useState("NGN");
  const [exchangeRate, setExchangeRate] = useState(1);
  const [rateLoading, setRateLoading] = useState(false);
  const [rateFetched, setRateFetched] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceNumberTouched, setInvoiceNumberTouched] = useState(false);
  const [numberLoading, setNumberLoading] = useState(true);
  const [numberConfig, setNumberConfig] = useState<{
    suggestedNumber: string | null;
    allowManualOverride: boolean;
    preventDuplicates: boolean;
    isEnabled: boolean;
    helperText: string;
  } | null>(null);
  const [lines, setLines] = useState<LineItemData[]>(() => [emptyLine(taxRates)]);

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

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/invoices/next-number");
        const json = await res.json() as {
          data: { suggestedNumber: string | null; allowManualOverride: boolean;
                  preventDuplicates: boolean; isEnabled: boolean; helperText: string; };
        };
        setNumberConfig(json.data);
        if (json.data.suggestedNumber) setInvoiceNumber(json.data.suggestedNumber);
      } catch { /* silently ignore */ }
      finally { setNumberLoading(false); }
    }
    load();
  }, []);

  function handleCurrencyChange(val: string) {
    setCurrency(val);
    setExchangeRate(1);
    setRateFetched(false);
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

  // ── Totals (live, client-side) ────────────────────────────────────────────
  const subtotal          = lines.reduce((s, l) => s + l.quantity * l.rate, 0);
  const lineDiscountTotal = lines.reduce((s, l) => s + (computeLineAmount(l) - l.quantity * l.rate + (
    // disc = gross - net
    l.quantity * l.rate - computeLineAmount(l)
  )), 0);
  // Simpler: just sum up discounts directly
  const lineDiscountSum = lines.reduce((s, l) => {
    const gross = l.quantity * l.rate;
    const net   = computeLineAmount(l);
    return s + (gross - net);
  }, 0);
  const taxBreakdown = buildTaxBreakdown(lines, taxRates);
  const taxTotal     = taxBreakdown.reduce((s, r) => s + r.amount, 0);
  const maxDiscount  = Math.max(0, subtotal - lineDiscountSum);
  const clampedDiscount = Math.min(Math.max(0, discountAmount), maxDiscount);
  const total        = subtotal - lineDiscountSum - clampedDiscount + taxTotal;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!customerId) { setError("Please select a customer"); return; }
    if (!isNGN && exchangeRate <= 0) { setError("Please enter a valid exchange rate"); return; }
    setLoading(true);
    setError(null);
    const fd = new FormData(e.currentTarget as HTMLFormElement);
    const result = await createInvoice({
      customerId,
      invoiceNumber: invoiceNumberTouched ? (invoiceNumber.trim() || undefined) : undefined,
      reference: String(fd.get("reference") || ""),
      issueDate,
      dueDate,
      discountAmount,
      recognitionPeriod,
      currency,
      exchangeRate: isNGN ? 1 : exchangeRate,
      lines: lines.map((l) => ({
        itemId:        l.itemId || undefined,
        description:   l.description,
        quantity:      l.quantity,
        rate:          l.rate,
        taxRateId:     l.taxRateId || undefined,
        discountType:  l.discountType,
        discountValue: l.discountValue,
      })),
    });
    setLoading(false);
    if (result?.error) { setError(result.error); return; }
    toast.success("Invoice created");
    router.push(`/sales/invoices/${result.id}`);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Header */}
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
            <Input id="reference" name="reference" placeholder="PO-12345" />
          </div>
        </div>

        {/* Invoice Number */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="invoiceNumber">Invoice Number</Label>
            {numberLoading ? (
              <div className="h-9 flex items-center text-sm text-slate-400 animate-pulse">Loading…</div>
            ) : !numberConfig?.isEnabled ? (
              <>
                <Input
                  id="invoiceNumber"
                  value={invoiceNumber}
                  onChange={(e) => { setInvoiceNumber(e.target.value); setInvoiceNumberTouched(true); }}
                  placeholder="Enter invoice number"
                  className="font-mono"
                />
                <p className="text-xs text-amber-600 mt-1">
                  {numberConfig?.helperText ?? "Invoice numbering is not configured."}
                </p>
              </>
            ) : !numberConfig.allowManualOverride ? (
              <>
                <Input id="invoiceNumber" value={invoiceNumber} readOnly className="font-mono bg-slate-50 text-slate-600 cursor-not-allowed" />
                <p className="text-xs text-slate-500 mt-1">{numberConfig.helperText}</p>
              </>
            ) : (
              <>
                <Input
                  id="invoiceNumber"
                  value={invoiceNumber}
                  onChange={(e) => { setInvoiceNumber(e.target.value); setInvoiceNumberTouched(true); }}
                  placeholder="e.g. INV-00001"
                  className="font-mono"
                />
                <p className="text-xs text-slate-500 mt-1">{numberConfig.helperText}</p>
                {!numberConfig.preventDuplicates && (
                  <p className="text-xs text-amber-600 mt-0.5">Duplicate invoice numbers are allowed by your current settings.</p>
                )}
              </>
            )}
          </div>
        </div>

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
            <Input value={recognitionPeriod} onChange={(e) => setRecognitionPeriod(e.target.value)} placeholder="YYYY-MM" />
          </div>
        </div>
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

      {/* FX Rate */}
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
              className="font-mono" placeholder="e.g. 1580.50"
            />
            <span className="text-sm text-amber-800">NGN</span>
            <Button
              type="button" variant="outline" size="sm"
              onClick={() => fetchRate(currency)} disabled={rateLoading}
              className="whitespace-nowrap border-amber-300 text-amber-700 hover:bg-amber-100"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${rateLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
          <p className="text-xs text-amber-600">Auto-fetched from Frankfurter. Override with your contracted rate.</p>
        </div>
      )}

      {/* Line Items Editor */}
      <InvoiceLineItemsEditor
        currency={currency}
        items={items}
        taxRates={taxRates}
        lines={lines}
        onChange={setLines}
      />

      {/* Totals */}
      <div className="border border-slate-200 rounded-xl p-4 bg-slate-50">
        <div className="flex flex-col items-end gap-1.5 text-sm">
          <div className="flex gap-8">
            <span className="text-slate-500">Subtotal</span>
            <span className="font-mono w-36 text-right">{formatCurrency(subtotal, currency)}</span>
          </div>
          {lineDiscountSum > 0 && (
            <div className="flex gap-8">
              <span className="text-slate-500">Line Discounts</span>
              <span className="font-mono w-36 text-right text-slate-600">-{formatCurrency(lineDiscountSum, currency)}</span>
            </div>
          )}
          <div className="flex gap-8 items-center">
            <span className="text-slate-500">Additional Invoice Discount</span>
            <Input
              type="number" min="0" step="0.01"
              value={discountAmount}
              onChange={(e) => setDiscountAmount(parseFloat(e.target.value) || 0)}
              className="h-6 w-36 text-xs text-right font-mono"
            />
          </div>
          {taxBreakdown.map((row) => (
            <div key={row.label} className="flex gap-8">
              <span className="text-slate-500">{row.label}</span>
              <span className="font-mono w-36 text-right">{formatCurrency(row.amount, currency)}</span>
            </div>
          ))}
          <div className="flex gap-8 pt-1 border-t border-slate-300 mt-1">
            <span className="font-semibold text-slate-900">Total ({currency})</span>
            <span className="font-bold font-mono w-36 text-right text-slate-900">{formatCurrency(total, currency)}</span>
          </div>
          {!isNGN && exchangeRate > 0 && (
            <div className="flex gap-8 text-xs text-slate-400 border-t border-dashed border-slate-200 pt-1 mt-0.5">
              <span>≈ NGN equivalent</span>
              <span className="font-mono w-36 text-right">{formatCurrency(total * exchangeRate)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes</Label>
        <Input id="notes" name="notes" placeholder="Payment instructions, terms, etc." />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-3">
        <Button type="submit" disabled={loading || (!isNGN && rateLoading)}>
          {loading ? "Creating…" : "Create Invoice"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
