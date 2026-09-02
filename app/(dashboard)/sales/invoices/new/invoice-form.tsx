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
  type IncomeAccountOption,
  type ProjectOption,
  type ReportingTagDefinition,
  computeLineAmount,
  buildTaxBreakdown,
  emptyLine,
} from "@/components/invoices/invoice-line-items-editor";

interface Customer { id: string; companyName: string; customerCode: string; paymentTerms: number; }
interface Item { id: string; itemCode: string; name: string; salesPrice: number | null; type: string; incomeAccountId: string | null; }
interface PaymentTermOption { id: string; name: string; dueInDays: number | null; isDefault: boolean; }
interface InvoiceProjectOption extends ProjectOption { paymentTermsDays?: number | null; }

function today() { return new Date().toISOString().split("T")[0]; }
function addDays(date: string, days: number) { const value = new Date(`${date}T00:00:00`); value.setDate(value.getDate() + days); return value.toISOString().split("T")[0]; }
function getMonthPeriod(date: string) { const value = new Date(`${date}T00:00:00`); return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`; }

export function InvoiceForm({
  customers,
  items,
  incomeAccounts,
  taxRates,
  projects,
  paymentTerms,
  reportingTags,
  baseCurrency,
  canCustomDueDate,
}: {
  customers: Customer[];
  items: Item[];
  incomeAccounts: IncomeAccountOption[];
  taxRates: TaxRateOption[];
  projects: InvoiceProjectOption[];
  paymentTerms: PaymentTermOption[];
  reportingTags: ReportingTagDefinition[];
  baseCurrency: string;
  canCustomDueDate: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [issueDate, setIssueDate] = useState(today());
  const organisationDefaultDays = paymentTerms.find((term) => term.isDefault)?.dueInDays ?? 30;
  const [paymentTermsDays, setPaymentTermsDays] = useState(organisationDefaultDays);
  const [dueDate, setDueDate] = useState(addDays(today(), organisationDefaultDays));
  const [termsSource, setTermsSource] = useState("Organisation default");
  const [termsConflict, setTermsConflict] = useState(false);
  const [customDueDate, setCustomDueDate] = useState(false);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [recognitionPeriod, setRecognitionPeriod] = useState(getMonthPeriod(today()));
  const [currency, setCurrency] = useState(baseCurrency);
  const [exchangeRate, setExchangeRate] = useState(1);
  const [rateLoading, setRateLoading] = useState(false);
  const [rateFetched, setRateFetched] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceNumberTouched, setInvoiceNumberTouched] = useState(false);
  const [numberLoading, setNumberLoading] = useState(true);
  const [recogniseRevenue, setRecogniseRevenue] = useState(false);
  const [numberConfig, setNumberConfig] = useState<{
    suggestedNumber: string | null;
    allowManualOverride: boolean;
    preventDuplicates: boolean;
    isEnabled: boolean;
    helperText: string;
  } | null>(null);

  const defaultIncomeAccountId = incomeAccounts.find((account) => account.code === "IN-001")?.id ?? incomeAccounts[0]?.id ?? "";
  const [lines, setLines] = useState<LineItemData[]>(() => [emptyLine(taxRates, defaultIncomeAccountId)]);
  const isBaseCurrency = currency === baseCurrency;
  const selectedProjectKey = Array.from(new Set(lines.map((line) => line.projectId).filter(Boolean))).sort().join("|");

  const fetchRate = useCallback(async (from: string) => {
    if (from === baseCurrency) { setExchangeRate(1); setRateFetched(false); return; }
    setRateLoading(true);
    setRateFetched(false);
    try {
      const response = await fetch(`https://api.frankfurter.app/latest?from=${from}&to=${baseCurrency}`);
      const json = await response.json() as { rates?: Record<string, number> };
      const rate = json.rates?.[baseCurrency];
      if (rate) { setExchangeRate(rate); setRateFetched(true); }
      else toast.error(`Live ${from}/${baseCurrency} rate is unavailable — enter it manually`);
    } catch {
      toast.error("Could not fetch live rate — enter manually");
    } finally {
      setRateLoading(false);
    }
  }, [baseCurrency]);

  useEffect(() => { void fetchRate(currency); }, [currency, fetchRate]);

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch("/api/invoices/next-number");
        const json = await response.json() as { data: { suggestedNumber: string | null; allowManualOverride: boolean; preventDuplicates: boolean; isEnabled: boolean; helperText: string; } };
        setNumberConfig(json.data);
        if (json.data.suggestedNumber) setInvoiceNumber(json.data.suggestedNumber);
      } catch { /* numbering errors are shown by the server when creating */ }
      finally { setNumberLoading(false); }
    }
    void load();
  }, []);

  useEffect(() => {
    if (customDueDate) return;
    const selectedProjectIds = selectedProjectKey ? selectedProjectKey.split("|") : [];
    const overrides = selectedProjectIds
      .map((id) => projects.find((project) => project.id === id)?.paymentTermsDays)
      .filter((value): value is number => value != null);
    const uniqueOverrides = Array.from(new Set(overrides));
    let days: number;
    let source: string;
    let conflict = false;
    if (uniqueOverrides.length === 1) {
      days = uniqueOverrides[0];
      source = `Project override · ${days} day${days === 1 ? "" : "s"}`;
    } else {
      const customer = customers.find((item) => item.id === customerId);
      days = customer?.paymentTerms ?? organisationDefaultDays;
      source = customer ? `Customer terms · ${days} day${days === 1 ? "" : "s"}` : `Organisation default · ${days} day${days === 1 ? "" : "s"}`;
      if (uniqueOverrides.length > 1) {
        source = "Selected Projects have conflicting payment-term overrides — choose terms manually";
        conflict = true;
      }
    }
    setPaymentTermsDays(days);
    setDueDate(addDays(issueDate, days));
    setTermsSource(source);
    setTermsConflict(conflict);
  }, [customerId, selectedProjectKey, issueDate, customDueDate, customers, projects, organisationDefaultDays]);

  function handleCurrencyChange(value: string) {
    setCurrency(value);
    setExchangeRate(1);
    setRateFetched(false);
  }

  function handleCustomerChange(id: string) {
    setCustomerId(id);
    setLines((current) => current.map((line) => ({ ...line, projectId: "" })));
  }

  function handleIssueDateChange(value: string) {
    setIssueDate(value);
    setRecognitionPeriod(getMonthPeriod(value));
    if (!customDueDate) setDueDate(addDays(value, paymentTermsDays));
  }

  const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.rate, 0);
  const lineDiscountSum = lines.reduce((sum, line) => {
    const gross = line.quantity * line.rate;
    return sum + (gross - computeLineAmount(line));
  }, 0);
  const taxBreakdown = buildTaxBreakdown(lines, taxRates);
  const taxTotal = taxBreakdown.reduce((sum, row) => sum + row.amount, 0);
  const maxDiscount = Math.max(0, subtotal - lineDiscountSum);
  const clampedDiscount = Math.min(Math.max(0, discountAmount), maxDiscount);
  const total = subtotal - lineDiscountSum - clampedDiscount + taxTotal;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!customerId) { setError("Please select a customer"); return; }
    if (!isBaseCurrency && exchangeRate <= 0) { setError("Please enter a valid exchange rate"); return; }
    if (customDueDate && !canCustomDueDate) { setError("You do not have permission to set a custom due date"); return; }
    setLoading(true);
    setError(null);
    const formData = new FormData(event.currentTarget as HTMLFormElement);
    const result = await createInvoice({
      customerId,
      invoiceNumber: invoiceNumberTouched ? (invoiceNumber.trim() || undefined) : undefined,
      reference: String(formData.get("reference") || ""),
      orderNumber: String(formData.get("orderNumber") || ""),
      issueDate,
      dueDate,
      discountAmount,
      recognitionPeriod,
      currency,
      exchangeRate: isBaseCurrency ? 1 : exchangeRate,
      paymentTermsDays,
      recogniseRevenueOnInvoiceDate: recogniseRevenue,
      lines: lines.map((line) => ({
        itemId: line.itemId || undefined,
        description: line.description,
        quantity: line.quantity,
        rate: line.rate,
        taxRateId: line.taxRateId || undefined,
        discountType: line.discountType,
        discountValue: line.discountValue,
        incomeAccountId: line.incomeAccountId || undefined,
        projectId: line.projectId || undefined,
        reportingTags: line.reportingTags,
      })),
    });
    setLoading(false);
    if (result?.error) { setError(result.error); return; }
    toast.success("Invoice created");
    router.push(`/sales/invoices/${result.id}`);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Customer *</Label>
            <Select value={customerId} onValueChange={(value) => handleCustomerChange(value ?? "")}>
              <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
              <SelectContent>{customers.map((customer) => <SelectItem key={customer.id} value={customer.id}>{customer.companyName}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label htmlFor="orderNumber">Order Number</Label><Input id="orderNumber" name="orderNumber" placeholder="Customer PO or campaign order" /></div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="invoiceNumber">Invoice Number</Label>
            {numberLoading ? <div className="h-9 flex items-center text-sm text-slate-400 animate-pulse">Loading…</div>
              : !numberConfig?.isEnabled ? <><Input id="invoiceNumber" value={invoiceNumber} onChange={(event) => { setInvoiceNumber(event.target.value); setInvoiceNumberTouched(true); }} placeholder="Enter invoice number" className="font-mono" /><p className="text-xs text-amber-600 mt-1">{numberConfig?.helperText ?? "Invoice numbering is not configured."}</p></>
              : !numberConfig.allowManualOverride ? <><Input id="invoiceNumber" value={invoiceNumber} readOnly className="font-mono bg-slate-50 text-slate-600 cursor-not-allowed" /><p className="text-xs text-slate-500 mt-1">{numberConfig.helperText}</p></>
              : <><Input id="invoiceNumber" value={invoiceNumber} onChange={(event) => { setInvoiceNumber(event.target.value); setInvoiceNumberTouched(true); }} placeholder="e.g. INV-00001" className="font-mono" /><p className="text-xs text-slate-500 mt-1">{numberConfig.helperText}</p>{!numberConfig.preventDuplicates && <p className="text-xs text-amber-600 mt-0.5">Duplicate invoice numbers are allowed by your current settings.</p>}</>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Invoice Currency</Label>
            <Select value={currency} onValueChange={(value) => handleCurrencyChange(value ?? baseCurrency)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{SUPPORTED_CURRENCIES.map((code) => <SelectItem key={code} value={code}>{code}{code === baseCurrency ? " · Base" : ""}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="space-y-1.5"><Label htmlFor="reference">Reference / Subject</Label><Input id="reference" name="reference" placeholder="Invoice subject or internal reference" /></div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5"><Label>Issue Date</Label><Input type="date" value={issueDate} onChange={(event) => handleIssueDateChange(event.target.value)} /></div>
          <div className="space-y-1.5">
            <Label>Payment Terms</Label>
            <Select value={String(paymentTermsDays)} onValueChange={(value) => {
              const days = Number(value ?? 0);
              setPaymentTermsDays(days);
              setTermsSource(`Manual term selection · ${days} day${days === 1 ? "" : "s"}`);
              setTermsConflict(false);
              if (!customDueDate) setDueDate(addDays(issueDate, days));
            }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {paymentTerms.filter((term) => term.dueInDays != null).map((term) => <SelectItem key={term.id} value={String(term.dueInDays)}>{term.name}</SelectItem>)}
                {!paymentTerms.some((term) => term.dueInDays === paymentTermsDays) ? <SelectItem value={String(paymentTermsDays)}>Net {paymentTermsDays}</SelectItem> : null}
              </SelectContent>
            </Select>
            <p className={`text-xs ${termsConflict ? "text-amber-700" : "text-[var(--text-secondary)]"}`}>{termsSource}</p>
          </div>
        </div>

        <div className="rounded-lg border border-[var(--app-border)] bg-[var(--surface-muted)] px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div><p className="text-sm font-medium text-[var(--text-primary)]">Due date</p><p className="mt-0.5 text-xs text-[var(--text-secondary)]">{customDueDate ? "Custom due date" : `Calculated from ${paymentTermsDays}-day payment terms`}</p></div>
            {canCustomDueDate ? <label className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]"><input type="checkbox" checked={customDueDate} onChange={(event) => { const enabled = event.target.checked; setCustomDueDate(enabled); if (!enabled) setDueDate(addDays(issueDate, paymentTermsDays)); }} /> Custom due date</label> : null}
          </div>
          <Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} readOnly={!customDueDate} min={issueDate} className={`mt-3 ${!customDueDate ? "bg-slate-100 cursor-not-allowed" : ""}`} />
        </div>
      </div>

      {!isBaseCurrency && (
        <div className="border border-amber-200 bg-amber-50 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-amber-900">Exchange Rate</h2><div className="flex items-center gap-2">{rateLoading && <span className="text-xs text-amber-600 animate-pulse">Fetching live rate…</span>}{rateFetched && !rateLoading && <span className="text-xs text-green-600 font-medium">✓ Suggested live rate</span>}</div></div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-amber-800 whitespace-nowrap">1 {currency} =</span>
            <Input type="number" min="0.000001" step="0.000001" value={exchangeRate} onChange={(event) => { setExchangeRate(parseFloat(event.target.value) || 1); setRateFetched(false); }} className="font-mono" placeholder="Enter exchange rate" />
            <span className="text-sm text-amber-800">{baseCurrency}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void fetchRate(currency)} disabled={rateLoading} className="whitespace-nowrap border-amber-300 text-amber-700 hover:bg-amber-100"><RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${rateLoading ? "animate-spin" : ""}`} />Refresh</Button>
          </div>
          <p className="text-xs text-amber-600">The fetched rate is a suggestion. You can enter the actual rate FINOS should use for this invoice.</p>
        </div>
      )}

      {incomeAccounts.length === 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"><strong>No active income accounts are configured.</strong> Create at least one income account in the <a href="/accounting/chart-of-accounts" className="underline font-medium">Chart of Accounts</a> before issuing invoices.</div>}

      <InvoiceLineItemsEditor currency={currency} items={items} taxRates={taxRates} incomeAccounts={incomeAccounts} defaultIncomeAccountId={defaultIncomeAccountId} lines={lines} onChange={setLines} customerId={customerId} projects={projects} reportingTags={reportingTags} />

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--app-border)] bg-white p-4"><input type="checkbox" checked={recogniseRevenue} onChange={(event) => setRecogniseRevenue(event.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--finos-accent)]" /><span><span className="block text-sm font-medium text-[var(--text-primary)]">Recognise revenue on invoice date</span><span className="mt-1 block text-xs leading-5 text-[var(--text-secondary)]">Unchecked amounts post to the configured Unearned Income account. Earnings can be recognised later from the posted invoice or Project.</span></span></label>

      <div className="border border-slate-200 rounded-xl p-4 bg-slate-50">
        <div className="flex flex-col items-end gap-1.5 text-sm">
          <div className="flex gap-8"><span className="text-slate-500">Subtotal</span><span className="font-mono w-36 text-right">{formatCurrency(subtotal, currency)}</span></div>
          {lineDiscountSum > 0 && <div className="flex gap-8"><span className="text-slate-500">Line Discounts</span><span className="font-mono w-36 text-right text-slate-600">-{formatCurrency(lineDiscountSum, currency)}</span></div>}
          <div className="flex gap-8 items-center"><span className="text-slate-500">Additional Invoice Discount</span><Input type="number" min="0" step="0.01" value={discountAmount} onChange={(event) => setDiscountAmount(parseFloat(event.target.value) || 0)} className="h-6 w-36 text-xs text-right font-mono" /></div>
          {taxBreakdown.map((row) => <div key={row.label} className="flex gap-8"><span className="text-slate-500">{row.label}</span><span className="font-mono w-36 text-right">{formatCurrency(row.amount, currency)}</span></div>)}
          <div className="flex gap-8 pt-1 border-t border-slate-300 mt-1"><span className="font-semibold text-slate-900">Total ({currency})</span><span className="font-bold font-mono w-36 text-right text-slate-900">{formatCurrency(total, currency)}</span></div>
          {!isBaseCurrency && exchangeRate > 0 && <div className="flex gap-8 text-xs text-slate-400 border-t border-dashed border-slate-200 pt-1 mt-0.5"><span>≈ {baseCurrency} equivalent</span><span className="font-mono w-36 text-right">{formatCurrency(total * exchangeRate, baseCurrency)}</span></div>}
        </div>
      </div>

      <div className="space-y-1.5"><Label htmlFor="notes">Notes</Label><Input id="notes" name="notes" placeholder="Payment instructions, terms, etc." /></div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-3"><Button type="submit" disabled={loading || (!isBaseCurrency && rateLoading)}>{loading ? "Creating…" : "Create Invoice"}</Button><Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button></div>
    </form>
  );
}
