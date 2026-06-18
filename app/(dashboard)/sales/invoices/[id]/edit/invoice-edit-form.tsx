"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, RefreshCw, FileText, AlignLeft, Receipt } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { updateDraftInvoice } from "../../actions";
import { cn, formatCurrency } from "@/lib/utils";
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

/** Small accent bar used in section headings */
function AccentBar() {
  return (
    <div
      className="w-0.5 self-stretch rounded-full flex-shrink-0"
      style={{ backgroundColor: "var(--finos-accent)" }}
    />
  );
}

/** Red asterisk for required fields */
function Req() {
  return <span className="text-red-500 ml-0.5">*</span>;
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

  // Derived display labels (fixes @base-ui SelectValue not resolving label from item text)
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
          {/* Customer + Reference */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Customer<Req /></Label>
              {/*
                @base-ui SelectPrimitive.Value does not auto-resolve the label
                from child SelectItem text. We explicitly show the customer name
                derived from the customerId state; the Select still tracks and
                emits the UUID internally.
              */}
              <Select value={customerId} onValueChange={(v) => handleCustomerChange(v ?? "")}>
                <SelectTrigger className="w-full">
                  <span className={cn(
                    "flex-1 truncate text-left text-sm",
                    !selectedCustomerName && "text-muted-foreground"
                  )}>
                    {selectedCustomerName ?? "Select customer"}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reference">Reference <span className="text-slate-400 font-normal text-xs">(optional)</span></Label>
              <Input
                id="reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="PO-12345"
              />
            </div>
          </div>

          {/* Invoice Number + Currency */}
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
                  <p className="text-xs text-slate-400 mt-1">
                    Manual override is enabled. Editing this number will not advance the series counter.
                  </p>
                </>
              ) : (
                <>
                  <Input
                    id="invoiceNumber"
                    value={invoiceNumber}
                    readOnly
                    className="font-mono bg-slate-50 text-slate-500 cursor-not-allowed"
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    Invoice number is locked by your numbering settings.
                  </p>
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
                  {SUPPORTED_CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Issue Date + Due Date + Recognition Period */}
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
              <Input
                value={recognitionPeriod}
                onChange={(e) => setRecognitionPeriod(e.target.value)}
                placeholder="YYYY-MM"
                className="font-mono"
              />
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
              {rateLoading && (
                <span className="text-xs text-amber-600 animate-pulse">Fetching live rate…</span>
              )}
              {rateFetched && !rateLoading && (
                <span className="text-xs text-green-700 font-medium">✓ Live rate</span>
              )}
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
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", rateLoading && "animate-spin")} />
              Refresh
            </Button>
          </div>
          {exchangeRate > 0 && total > 0 && (
            <div className="bg-white rounded-lg px-4 py-3 text-xs border border-amber-100">
              <div className="flex justify-between text-slate-500">
                <span>Total (NGN equivalent)</span>
                <span className="font-mono font-semibold text-slate-700">
                  {formatCurrency(total * exchangeRate)}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 3. Line Items ──────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        {/* Section heading */}
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AccentBar />
            <Receipt className="h-4 w-4 text-slate-400 flex-shrink-0" />
            <span className="font-semibold text-slate-800 text-sm">
              Line Items
              <span className="ml-2 text-slate-400 font-normal text-xs">prices in {currency}</span>
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() =>
              setLines((p) => [
                ...p,
                { id: crypto.randomUUID(), itemId: "", description: "", quantity: 1, rate: 0, taxRate: 0 },
              ])
            }
          >
            <Plus className="h-3.5 w-3.5" /> Add Line
          </Button>
        </div>

        {/* Column headers */}
        <div
          className="grid grid-cols-12 gap-3 px-4 py-2 border-b border-slate-100 text-xs font-medium text-slate-500"
          style={{ backgroundColor: "color-mix(in srgb, var(--finos-accent) 5%, white)" }}
        >
          <div className="col-span-3">Item</div>
          <div className="col-span-3">Description<Req /></div>
          <div className="col-span-1 text-center">Qty<Req /></div>
          <div className="col-span-2">Rate ({currency})<Req /></div>
          <div className="col-span-1 text-center">Tax %</div>
          <div className="col-span-1 text-right">Amount</div>
          <div className="col-span-1" />
        </div>

        {/* Line rows */}
        <div className="divide-y divide-slate-50">
          {lines.map((line) => {
            const lineItemName = line.itemId
              ? (items.find((i) => i.id === line.itemId)?.name ?? "Custom")
              : null;

            return (
              <div key={line.id} className="grid grid-cols-12 gap-3 px-4 py-3 items-center hover:bg-slate-50/50 transition-colors">
                {/* Item select */}
                <div className="col-span-3">
                  <Select
                    value={line.itemId}
                    onValueChange={(v) => handleItemSelect(line.id, v ?? "")}
                  >
                    <SelectTrigger className="h-8 text-xs w-full">
                      <span className={cn(
                        "flex-1 truncate text-left",
                        !lineItemName && "text-muted-foreground"
                      )}>
                        {lineItemName ?? "Select item"}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Custom</SelectItem>
                      {items.map((i) => (
                        <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Description */}
                <div className="col-span-3">
                  <Input
                    className="h-8 text-xs"
                    value={line.description}
                    onChange={(e) => updateLine(line.id, "description", e.target.value)}
                    placeholder="Description"
                  />
                </div>

                {/* Quantity */}
                <div className="col-span-1">
                  <Input
                    className="h-8 text-xs text-center"
                    type="number" min="0" step="0.01"
                    value={line.quantity}
                    onChange={(e) => updateLine(line.id, "quantity", parseFloat(e.target.value) || 0)}
                  />
                </div>

                {/* Rate */}
                <div className="col-span-2">
                  <Input
                    className="h-8 text-xs font-mono"
                    type="number" min="0" step="0.01"
                    value={line.rate}
                    onChange={(e) => updateLine(line.id, "rate", parseFloat(e.target.value) || 0)}
                  />
                </div>

                {/* Tax % */}
                <div className="col-span-1">
                  <Input
                    className="h-8 text-xs text-center"
                    type="number" min="0" max="100" step="0.5"
                    value={line.taxRate}
                    onChange={(e) => updateLine(line.id, "taxRate", parseFloat(e.target.value) || 0)}
                  />
                </div>

                {/* Amount */}
                <div className="col-span-1 text-right font-mono text-xs text-slate-600 tabular-nums">
                  {formatCurrency(line.quantity * line.rate, currency)}
                </div>

                {/* Delete */}
                <div className="col-span-1 flex justify-center">
                  <button
                    type="button"
                    className={cn(
                      "h-7 w-7 flex items-center justify-center rounded-md text-slate-300 transition-colors",
                      lines.length > 1
                        ? "hover:text-red-500 hover:bg-red-50 cursor-pointer"
                        : "opacity-30 cursor-not-allowed"
                    )}
                    onClick={() => lines.length > 1 && setLines((p) => p.filter((l) => l.id !== line.id))}
                    disabled={lines.length === 1}
                    aria-label="Remove line"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Totals */}
        <div className="border-t border-slate-200 bg-slate-50/60 px-5 py-4">
          <div className="flex flex-col items-end gap-2 text-sm">
            <div className="flex items-center gap-6">
              <span className="text-slate-500 w-28 text-right">Subtotal</span>
              <span className="font-mono w-36 text-right tabular-nums">
                {formatCurrency(subtotal, currency)}
              </span>
            </div>
            <div className="flex items-center gap-6">
              <span className="text-slate-500 w-28 text-right">Discount</span>
              <Input
                type="number" min="0" step="0.01"
                value={discountAmount}
                onChange={(e) => setDiscountAmount(parseFloat(e.target.value) || 0)}
                className="h-6 w-36 text-xs text-right font-mono"
              />
            </div>
            {taxAmount > 0 && (
              <div className="flex items-center gap-6">
                <span className="text-slate-500 w-28 text-right">Tax</span>
                <span className="font-mono w-36 text-right tabular-nums">
                  {formatCurrency(taxAmount, currency)}
                </span>
              </div>
            )}
            {/* Total row — accent colour */}
            <div className="flex items-center gap-6 pt-2 border-t border-slate-200 mt-1">
              <span
                className="font-semibold w-28 text-right"
                style={{ color: "var(--finos-accent)" }}
              >
                Total
              </span>
              <span
                className="font-bold font-mono w-36 text-right tabular-nums"
                style={{ color: "var(--finos-accent)" }}
              >
                {formatCurrency(total, currency)}
              </span>
            </div>
            {!isNGN && exchangeRate > 0 && (
              <div className="flex items-center gap-6 text-xs text-slate-400 border-t border-dashed border-slate-200 pt-1.5 mt-0.5">
                <span className="w-28 text-right">≈ NGN equivalent</span>
                <span className="font-mono w-36 text-right tabular-nums">
                  {formatCurrency(total * exchangeRate)}
                </span>
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
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5">
          {error}
        </p>
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
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push(`/sales/invoices/${invoiceId}`)}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
