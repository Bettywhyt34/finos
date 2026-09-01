"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { createQuote } from "../actions";

interface Customer { id: string; companyName: string; customerCode: string; }
interface Item { id: string; itemCode: string; name: string; salesPrice: number | null; type: string; incomeAccountId: string | null; }

function today() { return new Date().toISOString().slice(0, 10); }
function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function QuoteForm({
  customers,
  items,
  incomeAccounts,
  taxRates,
  projects,
  reportingTags,
}: {
  customers: Customer[];
  items: Item[];
  incomeAccounts: IncomeAccountOption[];
  taxRates: TaxRateOption[];
  projects: ProjectOption[];
  reportingTags: ReportingTagDefinition[];
}) {
  const router = useRouter();
  const defaultIncomeAccountId = incomeAccounts.find((account) => account.code === "IN-001")?.id ?? incomeAccounts[0]?.id ?? "";
  const [customerId, setCustomerId] = useState("");
  const [issueDate, setIssueDate] = useState(today());
  const [expiryDate, setExpiryDate] = useState(addDays(today(), 30));
  const [currency, setCurrency] = useState("NGN");
  const [exchangeRate, setExchangeRate] = useState(1);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [lines, setLines] = useState<LineItemData[]>(() => [emptyLine(taxRates, defaultIncomeAccountId)]);
  const [loading, setLoading] = useState(false);
  const [rateLoading, setRateLoading] = useState(false);
  const [rateFetched, setRateFetched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isNGN = currency === "NGN";
  const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.rate, 0);
  const lineDiscountSum = lines.reduce((sum, line) => sum + (line.quantity * line.rate - computeLineAmount(line)), 0);
  const taxBreakdown = buildTaxBreakdown(lines, taxRates);
  const taxTotal = taxBreakdown.reduce((sum, row) => sum + row.amount, 0);
  const maxDiscount = Math.max(0, subtotal - lineDiscountSum);
  const documentDiscount = Math.min(Math.max(0, discountAmount), maxDiscount);
  const total = subtotal - lineDiscountSum - documentDiscount + taxTotal;

  const fetchRate = useCallback(async (from: string) => {
    if (from === "NGN") {
      setExchangeRate(1);
      setRateFetched(false);
      return;
    }
    setRateLoading(true);
    setRateFetched(false);
    try {
      const response = await fetch(`https://api.frankfurter.app/latest?from=${from}&to=NGN`);
      const json = await response.json() as { rates?: Record<string, number> };
      const rate = json.rates?.NGN;
      if (rate) {
        setExchangeRate(rate);
        setRateFetched(true);
      }
    } catch {
      toast.error("Could not fetch a live rate — enter the quote rate manually");
    } finally {
      setRateLoading(false);
    }
  }, []);

  useEffect(() => { void fetchRate(currency); }, [currency, fetchRate]);

  function handleCustomerChange(value: string) {
    setCustomerId(value);
    setLines((current) => current.map((line) => ({ ...line, projectId: "" })));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customerId) {
      setError("Select a customer");
      return;
    }
    if (!isNGN && exchangeRate <= 0) {
      setError("Enter a valid exchange rate");
      return;
    }
    setLoading(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const result = await createQuote({
      customerId,
      issueDate,
      expiryDate,
      currency,
      exchangeRate: isNGN ? 1 : exchangeRate,
      discountAmount,
      reference: String(form.get("reference") || ""),
      orderNumber: String(form.get("orderNumber") || ""),
      notes: String(form.get("notes") || ""),
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
    if ("error" in result) {
      setError(result.error);
      return;
    }
    toast.success("Quote created");
    router.push("/sales/quotes");
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <section className="space-y-4 rounded-xl border border-[var(--app-border)] bg-white p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Customer *</Label>
            <Select value={customerId} onValueChange={(value) => handleCustomerChange(value ?? "")}>
              <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
              <SelectContent>{customers.map((customer) => <SelectItem key={customer.id} value={customer.id}>{customer.companyName}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reference">Reference / Subject</Label>
            <Input id="reference" name="reference" placeholder="Proposal subject or internal reference" />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Issue date</Label>
            <Input type="date" value={issueDate} onChange={(event) => {
              setIssueDate(event.target.value);
              if (expiryDate < event.target.value) setExpiryDate(addDays(event.target.value, 30));
            }} required />
          </div>
          <div className="space-y-1.5">
            <Label>Valid until</Label>
            <Input type="date" min={issueDate} value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label>Quote currency</Label>
            <Select value={currency} onValueChange={(value) => {
              setCurrency(value ?? "NGN");
              setExchangeRate(1);
              setRateFetched(false);
            }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SUPPORTED_CURRENCIES.map((code) => <SelectItem key={code} value={code}>{code}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="orderNumber">Customer PO / Order number</Label>
          <Input id="orderNumber" name="orderNumber" placeholder="Optional" />
        </div>
      </section>

      {!isNGN ? (
        <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-amber-900">Exchange rate</p>
            {rateFetched && !rateLoading ? <span className="text-xs font-medium text-emerald-700">Live rate loaded</span> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-amber-800">1 {currency} =</span>
            <Input className="max-w-52 font-mono" type="number" min="0.000001" step="0.000001" value={exchangeRate} onChange={(event) => setExchangeRate(Number(event.target.value) || 1)} />
            <span className="text-sm text-amber-800">NGN</span>
            <Button type="button" size="sm" variant="outline" disabled={rateLoading} onClick={() => void fetchRate(currency)}>
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${rateLoading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
          <p className="text-xs text-amber-700">This is a commercial quote rate only. The converted Draft Invoice remains editable before posting.</p>
        </section>
      ) : null}

      {incomeAccounts.length === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No active income accounts are configured. You can prepare the commercial quote, but its converted invoice cannot be posted until accounting mappings are configured.
        </div>
      ) : null}

      <InvoiceLineItemsEditor
        currency={currency}
        items={items}
        taxRates={taxRates}
        incomeAccounts={incomeAccounts}
        defaultIncomeAccountId={defaultIncomeAccountId}
        lines={lines}
        onChange={setLines}
        customerId={customerId}
        projects={projects}
        reportingTags={reportingTags}
      />

      <section className="rounded-xl border border-[var(--app-border)] bg-[var(--surface-muted)] p-4">
        <div className="flex flex-col items-end gap-1.5 text-sm">
          <Money label="Subtotal" value={formatCurrency(subtotal, currency)} />
          {lineDiscountSum > 0 ? <Money label="Line discounts" value={`-${formatCurrency(lineDiscountSum, currency)}`} /> : null}
          <div className="flex items-center gap-8">
            <span className="text-[var(--text-secondary)]">Additional quote discount</span>
            <Input className="h-7 w-36 text-right font-mono text-xs" type="number" min="0" step="0.01" value={discountAmount} onChange={(event) => setDiscountAmount(Number(event.target.value) || 0)} />
          </div>
          {taxBreakdown.map((row) => <Money key={row.label} label={row.label} value={formatCurrency(row.amount, currency)} />)}
          <div className="mt-1 flex gap-8 border-t border-[var(--app-border)] pt-2 font-semibold">
            <span>Total ({currency})</span><span className="font-financial w-36 text-right">{formatCurrency(total, currency)}</span>
          </div>
          {!isNGN && exchangeRate > 0 ? <Money label="≈ NGN equivalent" value={formatCurrency(total * exchangeRate)} /> : null}
        </div>
      </section>

      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes / commercial terms</Label>
        <Input id="notes" name="notes" placeholder="Validity, scope assumptions or commercial notes" />
      </div>

      <p className="rounded-lg border border-[var(--app-border)] bg-white px-4 py-3 text-xs leading-5 text-[var(--text-secondary)]">
        Quotes are non-accounting documents. Creating, sending or accepting a quote does not affect Revenue, Accounts Receivable or the General Ledger. Accounting begins only when the converted invoice is later posted.
      </p>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex gap-3">
        <Button type="submit" disabled={loading || rateLoading}>{loading ? "Creating…" : "Create quote"}</Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}

function Money({ label, value }: { label: string; value: string }) {
  return <div className="flex gap-8"><span className="text-[var(--text-secondary)]">{label}</span><span className="font-financial w-36 text-right">{value}</span></div>;
}
