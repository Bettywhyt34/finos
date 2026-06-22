"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, FileText, AlignLeft, Receipt } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { updateDraftInvoice } from "../../actions";
import { cn, formatCurrency } from "@/lib/utils";
import { SUPPORTED_CURRENCIES } from "@/lib/fx";
import {
  InvoiceLineItemsEditor,
  type LineItemData,
  type TaxRateOption,
  type IncomeAccountOption,
  computeLineAmount,
  buildTaxBreakdown,
  emptyLine,
} from "@/components/invoices/invoice-line-items-editor";

interface Customer { id: string; companyName: string; customerCode: string; paymentTerms: number; }
interface Item { id: string; itemCode: string; name: string; salesPrice: number | null; type: string; incomeAccountId: string | null; }

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
  lines: {
    itemId:          string;
    description:     string;
    quantity:        number;
    rate:            number;
    taxRateId:       string;
    discountType:    "PERCENT" | "FIXED";
    discountValue:   number;
    incomeAccountId: string;
  }[];
}

interface Props {
  invoiceId:           string;
  initialData:         InitialData;
  customers:           Customer[];
  items:               Item[];
  incomeAccounts:      IncomeAccountOption[];
  allowManualOverride: boolean;
  taxRates:            TaxRateOption[];
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

function AccentBar() {
  return (
    <div className="w-0.5 self-stretch rounded-full flex-shrink-0" style={{ backgroundColor: "var(--finos-accent)" }} />
  );
}
function Req() { return <span className="text-red-500 ml-0.5">*</span>; }

export function InvoiceEditForm({ invoiceId, initialData, customers, items, incomeAccounts, allowManualOverride, taxRates }: Props) {
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

  const defaultIncomeAccountId =
    incomeAccounts.find((a) => a.code === "IN-001")?.id ?? incomeAccounts[0]?.id ?? "";

  const [lines, setLines] = useState<LineItemData[]>(
    initialData.lines.length > 0
      ? initialData.lines.map((l) => ({ ...l, id: crypto.randomUUID() }))
      : [emptyLine(taxRates, defaultIncomeAccountId)]
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

  // ── Totals (live, client-side) ────────────────────────────────────────────
  const subtotal       = lines.reduce((s, l) => s + l.quantity * l.rate, 0);
  const lineDiscountSum = lines.reduce((s, l) => {
    const gross = l.quantity * l.rate;
    const net   = computeLineAmount(l);
    return s + (gross - net);
  }, 0);
  const taxBreakdown   = buildTaxBreakdown(lines, taxRates);
  const taxTotal       = taxBreakdown.reduce((s, r) => s + r.amount, 0);
  const maxDiscount    = Math.max(0, subtotal - lineDiscountSum);
  const clampedDiscount = Math.min(Math.max(0, discountAmount), maxDiscount);
  const total          = subtotal - lineDiscountSum - clampedDiscount + taxTotal;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!customerId) { setError("Please select a customer"); return; }
    if (!isNGN && exchangeRate <= 0) { setError("Please enter a valid exchange rate"); return; }
    setLoading(true);
    setError(null);

    const result = await updateDraftInvoice(invoiceId, {
      customerId,
      invoiceNumber: invoiceNumberTouched ? invoiceNumber.trim() : undefined,
      reference:     reference || undefined,
      issueDate,
      dueDate,
      discountAmount,
      recognitionPeriod,
      currency,
      exchangeRate: isNGN ? 1 : exchangeRate,
      lines: lines.map((l) => ({
        itemId:          l.itemId || undefined,
        description:     l.description,
        quantity:        l.quantity,
        rate:            l.rate,
        taxRateId:       l.taxRateId || undefined,
        discountType:    l.discountType,
        discountValue:   l.discountValue,
        incomeAccountId: l.incomeAccountId || undefined,
      })),
      notes: notes || undefined,
    });

    setLoading(false);
    if (result?.error) { setError(result.error); return; }
    toast.success("Draft invoice updated");
    router.push(`/sales/invoices/${invoiceId}`);
  }

  const selectedCustomerName = customerId
    ? (customers.find((c) => c.id === customerId)?.companyName ?? "Unknown customer")
    : null;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">

      {/* ── 1. Invoice Details ──────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-3">
          <AccentBar />
          <FileText className="h-4 w-4 text-slate-400 flex-shrink-0" />
          <span className="font-semibold text-slate-800 text-sm">Invoice Details</span>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Customer<Req /></Label>
              <Select value={customerId} onValueChange={(v) => handleCustomerChange(v ?? "")}>
                <SelectTrigger className="w-full">
                  <span className={cn("flex-1 truncate text-left text-sm", !selectedCustomerName && "text-muted-foreground")}>
                    {selectedCustomerName ?? "Select customer"}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reference">Reference <span className="text-slate-400 font-normal text-xs">(optional)</span></Label>
              <Input id="reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="PO-12345" />
            </div>
          </div>

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
                  <p className="text-xs text-slate-400 mt-1">Manual override is enabled. Editing this number will not advance the series counter.</p>
                </>
              ) : (
                <>
                  <Input id="invoiceNumber" value={invoiceNumber} readOnly className="font-mono bg-slate-50 text-slate-500 cursor-not-allowed" />
                  <p className="text-xs text-slate-400 mt-1">Invoice number is locked by your numbering settings.</p>
                </>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Currency<Req /></Label>
              <Select value={currency} onValueChange={(v) => handleCurrencyChange(v ?? "NGN")}>
                <SelectTrigger className="w-full">
                  <span className="flex-1 text-left text-sm">{currency}</span>
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>Issue Date<Req /></Label>
              <Input type="date" value={issueDate} onChange={(e) => handleIssueDateChange(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Due Date<Req /></Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Recognition Period<Req /></Label>
              <Input value={recognitionPeriod} onChange={(e) => setRecognitionPeriod(e.target.value)} placeholder="YYYY-MM" className="font-mono" />
            </div>
          </div>
        </div>
      </div>

      {/* ── 2. Exchange Rate (non-NGN only) ────────────────────────────── */}
      {!isNGN && (
        <div className="border border-amber-200 bg-amber-50 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-amber-900">Exchange Rate</h2>
            <div className="flex items-center gap-2">
              {rateLoading && <span className="text-xs text-amber-600 animate-pulse">Fetching live rate…</span>}
              {rateFetched && !rateLoading && <span className="text-xs text-green-700 font-medium">✓ Live rate</span>}
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
              onClick={() => void fetchRate(currency)} disabled={rateLoading}
              className="whitespace-nowrap border-amber-300 text-amber-700 hover:bg-amber-100"
            >
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", rateLoading && "animate-spin")} />
              Refresh
            </Button>
          </div>
          {exchangeRate > 0 && total > 0 && (
            <div className="bg-white rounded-lg px-4 py-3 text-xs border border-amber-100">
              <div className="flex justify-between text-slate-500">
                <span>Total (NGN equivalent)</span>
                <span className="font-mono font-semibold text-slate-700">{formatCurrency(total * exchangeRate)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 3. Line Items ──────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-3">
          <AccentBar />
          <Receipt className="h-4 w-4 text-slate-400 flex-shrink-0" />
          <span className="font-semibold text-slate-800 text-sm">Line Items</span>
        </div>
        <div className="p-4">
          {incomeAccounts.length === 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 mb-4">
              <strong>No active income accounts are configured.</strong> Create at least one income account in the{" "}
              <a href="/accounting/chart-of-accounts" className="underline font-medium">Chart of Accounts</a>{" "}
              before issuing invoices.
            </div>
          )}
          <InvoiceLineItemsEditor
            currency={currency}
            items={items}
            taxRates={taxRates}
            incomeAccounts={incomeAccounts}
            defaultIncomeAccountId={defaultIncomeAccountId}
            lines={lines}
            onChange={setLines}
          />
        </div>

        {/* Totals */}
        <div className="border-t border-slate-200 bg-slate-50/60 px-5 py-4">
          <div className="flex flex-col items-end gap-2 text-sm">
            <div className="flex items-center gap-6">
              <span className="text-slate-500 w-52 text-right">Subtotal</span>
              <span className="font-mono w-36 text-right tabular-nums">{formatCurrency(subtotal, currency)}</span>
            </div>
            {lineDiscountSum > 0 && (
              <div className="flex items-center gap-6">
                <span className="text-slate-500 w-52 text-right">Line Discounts</span>
                <span className="font-mono w-36 text-right tabular-nums text-slate-600">-{formatCurrency(lineDiscountSum, currency)}</span>
              </div>
            )}
            <div className="flex items-center gap-6">
              <span className="text-slate-500 w-52 text-right">Additional Invoice Discount</span>
              <Input
                type="number" min="0" step="0.01"
                value={discountAmount}
                onChange={(e) => setDiscountAmount(parseFloat(e.target.value) || 0)}
                className="h-6 w-36 text-xs text-right font-mono"
              />
            </div>
            {taxBreakdown.map((row) => (
              <div key={row.label} className="flex items-center gap-6">
                <span className="text-slate-500 w-52 text-right">{row.label}</span>
                <span className="font-mono w-36 text-right tabular-nums">{formatCurrency(row.amount, currency)}</span>
              </div>
            ))}
            <div className="flex items-center gap-6 pt-2 border-t border-slate-200 mt-1">
              <span className="font-semibold w-52 text-right" style={{ color: "var(--finos-accent)" }}>Total ({currency})</span>
              <span className="font-bold font-mono w-36 text-right tabular-nums" style={{ color: "var(--finos-accent)" }}>
                {formatCurrency(total, currency)}
              </span>
            </div>
            {!isNGN && exchangeRate > 0 && (
              <div className="flex items-center gap-6 text-xs text-slate-400 border-t border-dashed border-slate-200 pt-1.5 mt-0.5">
                <span className="w-52 text-right">≈ NGN equivalent</span>
                <span className="font-mono w-36 text-right tabular-nums">{formatCurrency(total * exchangeRate)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── 4. Notes ───────────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-3">
          <AccentBar />
          <AlignLeft className="h-4 w-4 text-slate-400 flex-shrink-0" />
          <span className="font-semibold text-slate-800 text-sm">Notes</span>
          <span className="text-slate-400 font-normal text-xs">(optional)</span>
        </div>
        <div className="p-5">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Payment instructions, terms, or any notes for the customer…"
            rows={3}
            className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-y min-h-[80px]"
          />
        </div>
      </div>

      {/* ── 5. Actions ─────────────────────────────────────────────────── */}
      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5">{error}</p>
      )}
      <div className="flex items-center gap-3 pb-2">
        <Button
          type="submit"
          disabled={loading || (!isNGN && rateLoading)}
          style={{ backgroundColor: "var(--finos-accent)", color: "white" }}
          className="hover:opacity-90 transition-opacity"
        >
          {loading ? "Saving…" : "Save Changes"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push(`/sales/invoices/${invoiceId}`)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
