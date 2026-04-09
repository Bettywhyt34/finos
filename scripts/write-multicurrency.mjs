import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const B = 'C:/Users/digit/Projects/finos/finos-v5';
function w(p, c) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, c, 'utf8');
  console.log('✓', p.replace(B, ''));
}

// ════════════════════════════════════════════════════════════
// INVOICE ACTIONS — updated with currency + exchangeRate
// ════════════════════════════════════════════════════════════

w(`${B}/app/(dashboard)/sales/invoices/actions.ts`, `"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { postJournalEntry } from "@/lib/journal";
import { getRecognitionPeriod, toNGN } from "@/lib/utils";

async function getNextInvoiceNumber(orgId: string): Promise<string> {
  const count = await prisma.invoice.count({ where: { organizationId: orgId } });
  return \`INV-\${String(count + 1).padStart(5, "0")}\`;
}

export interface LineItem {
  itemId?: string;
  description: string;
  quantity: number;
  rate: number;
  taxRate: number;
}

export async function createInvoice(data: {
  customerId: string;
  reference?: string;
  issueDate: string;
  dueDate: string;
  notes?: string;
  recognitionPeriod: string;
  discountAmount: number;
  currency: string;
  exchangeRate: number;
  lines: LineItem[];
}) {
  const session = await auth();
  const orgId = session?.user?.organizationId;
  const userId = session?.user?.id;
  if (!orgId || !userId) return { error: "Unauthorized" };

  if (data.lines.length === 0) return { error: "At least one line item is required" };
  const rate = data.exchangeRate || 1;

  // Amounts stored in document currency (e.g., USD)
  const subtotal = data.lines.reduce((s, l) => s + l.quantity * l.rate, 0);
  const taxAmount = data.lines.reduce((s, l) => s + l.quantity * l.rate * (l.taxRate / 100), 0);
  const totalAmount = subtotal - data.discountAmount + taxAmount;
  const invoiceNumber = await getNextInvoiceNumber(orgId);

  // NGN equivalents for journal posting
  const totalNGN = toNGN(totalAmount, rate);

  try {
    const invoice = await prisma.invoice.create({
      data: {
        organizationId: orgId,
        customerId: data.customerId,
        invoiceNumber,
        reference: data.reference || null,
        issueDate: new Date(data.issueDate),
        dueDate: new Date(data.dueDate),
        status: "DRAFT",
        currency: data.currency,
        exchangeRate: rate,
        subtotal,
        discountAmount: data.discountAmount,
        taxAmount,
        totalAmount,
        amountPaid: 0,
        balanceDue: totalAmount,
        recognitionPeriod: data.recognitionPeriod,
        notes: data.notes || null,
        lines: {
          create: data.lines.map((l) => ({
            itemId: l.itemId || null,
            description: l.description,
            quantity: l.quantity,
            rate: l.rate,
            amount: l.quantity * l.rate,
            taxRate: l.taxRate,
          })),
        },
      },
    });

    // Auto-post journal in NGN (DR AR / CR Revenue)
    const fxNote = rate !== 1 ? \` (\${data.currency} @ \${rate})\` : "";
    await postJournalEntry({
      organizationId: orgId,
      createdBy: userId,
      entryDate: new Date(data.issueDate),
      reference: invoiceNumber,
      description: \`Invoice \${invoiceNumber}\${fxNote}\`,
      recognitionPeriod: data.recognitionPeriod,
      source: "invoice",
      sourceId: invoice.id,
      lines: [
        { accountCode: "CA-001", description: \`AR - \${invoiceNumber}\${fxNote}\`, debit: totalNGN, credit: 0 },
        { accountCode: "IN-001", description: \`Revenue - \${invoiceNumber}\${fxNote}\`, debit: 0, credit: totalNGN },
      ],
    }).catch(() => {});

    revalidatePath("/sales/invoices");
    return { success: true, id: invoice.id };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function sendInvoice(id: string) {
  const session = await auth();
  const orgId = session?.user?.organizationId;
  if (!orgId) return { error: "Unauthorized" };
  await prisma.invoice.update({
    where: { id, organizationId: orgId },
    data: { status: "SENT", sentAt: new Date() },
  });
  revalidatePath(\`/sales/invoices/\${id}\`);
  revalidatePath("/sales/invoices");
  return { success: true };
}

export async function recordPayment(data: {
  customerId: string;
  paymentDate: string;
  amount: number;          // always in NGN (the amount physically received)
  method: string;
  reference?: string;
  notes?: string;
  invoiceAllocations: { invoiceId: string; amount: number }[];
}) {
  const session = await auth();
  const orgId = session?.user?.organizationId;
  const userId = session?.user?.id;
  if (!orgId || !userId) return { error: "Unauthorized" };

  const totalAllocated = data.invoiceAllocations.reduce((s, a) => s + a.amount, 0);
  if (Math.abs(totalAllocated - data.amount) > 0.01) {
    return { error: "Allocated amount must equal payment amount" };
  }

  const count = await prisma.customerPayment.count({ where: { organizationId: orgId } });
  const paymentNumber = \`RCP-\${String(count + 1).padStart(5, "0")}\`;

  try {
    const payment = await prisma.$transaction(async (tx) => {
      const pmt = await tx.customerPayment.create({
        data: {
          organizationId: orgId,
          customerId: data.customerId,
          paymentNumber,
          paymentDate: new Date(data.paymentDate),
          amount: data.amount,
          method: data.method as "BANK_TRANSFER" | "CHECK" | "CASH" | "CARD",
          reference: data.reference || null,
          notes: data.notes || null,
          allocations: {
            create: data.invoiceAllocations.map((a) => ({
              invoiceId: a.invoiceId,
              amount: a.amount,
            })),
          },
        },
      });

      for (const alloc of data.invoiceAllocations) {
        const inv = await tx.invoice.findUnique({ where: { id: alloc.invoiceId } });
        if (!inv) continue;
        const newPaid = parseFloat(String(inv.amountPaid)) + alloc.amount;
        const newBalance = parseFloat(String(inv.totalAmount)) - newPaid;
        const newStatus = newBalance <= 0.01 ? "PAID" : newPaid > 0 ? "PARTIAL" : inv.status;
        await tx.invoice.update({
          where: { id: alloc.invoiceId },
          data: { amountPaid: newPaid, balanceDue: newBalance, status: newStatus },
        });
      }
      return pmt;
    });

    // Journal: DR Bank (NGN received) / CR AR (NGN equivalent)
    await postJournalEntry({
      organizationId: orgId,
      createdBy: userId,
      entryDate: new Date(data.paymentDate),
      reference: paymentNumber,
      description: \`Customer payment \${paymentNumber}\`,
      recognitionPeriod: getRecognitionPeriod(new Date(data.paymentDate)),
      source: "customer_payment",
      sourceId: payment.id,
      lines: [
        { accountCode: "CA-003", description: \`Bank receipt - \${paymentNumber}\`, debit: data.amount, credit: 0 },
        { accountCode: "CA-001", description: \`AR cleared - \${paymentNumber}\`, debit: 0, credit: data.amount },
      ],
    }).catch(() => {});

    revalidatePath("/sales/invoices");
    revalidatePath("/sales/receipts");
    return { success: true, id: payment.id };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
`);

// ─── INVOICE FORM — with FX rate UI ──────────────────────
w(`${B}/app/(dashboard)/sales/invoices/new/invoice-form.tsx`, `"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createInvoice } from "../actions";
import { formatCurrency } from "@/lib/utils";
import { SUPPORTED_CURRENCIES } from "@/lib/fx";

interface Customer { id: string; companyName: string; customerCode: string; paymentTerms: number; }
interface Item { id: string; itemCode: string; name: string; salesPrice: number | null; type: string; }
interface Account { id: string; code: string; name: string; }
interface LineItem { id: string; itemId: string; description: string; quantity: number; rate: number; taxRate: number; }

function today() { return new Date().toISOString().split("T")[0]; }
function addDays(d: string, n: number) { const dt = new Date(d); dt.setDate(dt.getDate() + n); return dt.toISOString().split("T")[0]; }
function getMonthPeriod(d: string) { const dt = new Date(d); return \`\${dt.getFullYear()}-\${String(dt.getMonth() + 1).padStart(2, "0")}\`; }

export function InvoiceForm({ customers, items, accounts: _accounts }: { customers: Customer[]; items: Item[]; accounts: Account[]; }) {
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
  const [lines, setLines] = useState<LineItem[]>([
    { id: crypto.randomUUID(), itemId: "", description: "", quantity: 1, rate: 0, taxRate: 0 },
  ]);

  const isNGN = currency === "NGN";

  const fetchRate = useCallback(async (from: string) => {
    if (from === "NGN") { setExchangeRate(1); setRateFetched(false); return; }
    setRateLoading(true);
    setRateFetched(false);
    try {
      const res = await fetch(\`https://api.frankfurter.app/latest?from=\${from}&to=NGN\`);
      const json = await res.json() as { rates?: Record<string, number> };
      const rate = json.rates?.NGN;
      if (rate) { setExchangeRate(rate); setRateFetched(true); }
    } catch {
      toast.error("Could not fetch live rate — enter manually");
    } finally {
      setRateLoading(false);
    }
  }, []);

  // Auto-fetch when currency changes
  useEffect(() => { fetchRate(currency); }, [currency, fetchRate]);

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

  const subtotal = lines.reduce((s, l) => s + l.quantity * l.rate, 0);
  const taxAmount = lines.reduce((s, l) => s + l.quantity * l.rate * (l.taxRate / 100), 0);
  const total = subtotal - discountAmount + taxAmount;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!customerId) { setError("Please select a customer"); return; }
    if (!isNGN && exchangeRate <= 0) { setError("Please enter a valid exchange rate"); return; }
    setLoading(true);
    setError(null);
    const fd = new FormData(e.currentTarget as HTMLFormElement);
    const result = await createInvoice({
      customerId,
      reference: String(fd.get("reference") || ""),
      issueDate,
      dueDate,
      discountAmount,
      recognitionPeriod,
      currency,
      exchangeRate: isNGN ? 1 : exchangeRate,
      lines: lines.map((l) => ({
        itemId: l.itemId || undefined,
        description: l.description,
        quantity: l.quantity,
        rate: l.rate,
        taxRate: l.taxRate,
      })),
    });
    setLoading(false);
    if (result?.error) { setError(result.error); return; }
    toast.success("Invoice created");
    router.push(\`/sales/invoices/\${result.id}\`);
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
              type="number"
              min="0.0001"
              step="0.0001"
              value={exchangeRate}
              onChange={(e) => setExchangeRate(parseFloat(e.target.value) || 1)}
              className="font-mono"
              placeholder="e.g. 1580.50"
            />
            <span className="text-sm text-amber-800">NGN</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fetchRate(currency)}
              disabled={rateLoading}
              className="whitespace-nowrap border-amber-300 text-amber-700 hover:bg-amber-100"
            >
              <RefreshCw className={\`h-3.5 w-3.5 mr-1.5 \${rateLoading ? "animate-spin" : ""}\`} />
              Refresh
            </Button>
          </div>
          <p className="text-xs text-amber-600">
            Auto-fetched from Frankfurter. Override with your contracted rate.
          </p>
          {exchangeRate > 0 && total > 0 && (
            <div className="bg-white rounded-lg px-4 py-3 space-y-1 text-xs border border-amber-100">
              <div className="flex justify-between text-slate-500">
                <span>Subtotal (NGN equivalent)</span>
                <span className="font-mono font-medium text-slate-700">{formatCurrency(subtotal * exchangeRate)}</span>
              </div>
              {taxAmount > 0 && (
                <div className="flex justify-between text-slate-500">
                  <span>Tax (NGN equivalent)</span>
                  <span className="font-mono font-medium text-slate-700">{formatCurrency(taxAmount * exchangeRate)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold text-slate-900 pt-1 border-t border-slate-200">
                <span>Total (NGN equivalent)</span>
                <span className="font-mono">{formatCurrency(total * exchangeRate)}</span>
              </div>
              <p className="text-slate-400 pt-1">Journal entries will post at this NGN equivalent.</p>
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
                  onChange={(e) => updateLine(line.id, "description", e.target.value)} placeholder="Description" />
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
`);

// ─── INVOICE DETAIL PAGE — shows FX info ─────────────────
w(`${B}/app/(dashboard)/sales/invoices/[id]/page.tsx`, `import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { formatCurrency, toNGN, cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils";
import { InvoiceActions } from "./invoice-actions";

const statusColors: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600",
  SENT: "bg-blue-100 text-blue-700",
  PARTIAL: "bg-amber-100 text-amber-700",
  PAID: "bg-green-100 text-green-700",
  OVERDUE: "bg-red-100 text-red-700",
  WRITTEN_OFF: "bg-slate-100 text-slate-400",
};

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const organizationId = session!.user.organizationId!;

  const invoice = await prisma.invoice.findFirst({
    where: { id, organizationId },
    include: {
      customer: true,
      lines: { include: { item: { select: { name: true, itemCode: true } } } },
      payments: { include: { payment: true } },
    },
  });

  if (!invoice) notFound();

  const openInvoices = await prisma.invoice.findMany({
    where: {
      organizationId,
      customerId: invoice.customerId,
      status: { in: ["SENT", "PARTIAL", "OVERDUE"] },
    },
    select: { id: true, invoiceNumber: true, balanceDue: true, dueDate: true, currency: true, exchangeRate: true },
    orderBy: { dueDate: "asc" },
  });

  const bankAccounts = await prisma.bankAccount.findMany({
    where: { organizationId, isActive: true },
    select: { id: true, accountName: true, bankName: true },
  });

  const currency = invoice.currency;
  const rate = parseFloat(String(invoice.exchangeRate));
  const isNGN = currency === "NGN";
  const balance = parseFloat(String(invoice.balanceDue));
  const totalNGN = toNGN(parseFloat(String(invoice.totalAmount)), rate);
  const balanceNGN = toNGN(balance, rate);

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/sales/invoices" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Invoices
          </Link>
          <span className="text-slate-300">/</span>
          <span className="font-mono text-sm font-semibold">{invoice.invoiceNumber}</span>
          <span className={\`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium \${statusColors[invoice.status] || ""}\`}>
            {invoice.status}
          </span>
          {!isNGN && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
              {currency}
            </span>
          )}
        </div>
        <InvoiceActions
          invoice={{ id: invoice.id, status: invoice.status, customerId: invoice.customerId, balanceDue: balance }}
          openInvoices={openInvoices.map((i) => ({
            ...i,
            balanceDue: parseFloat(String(i.balanceDue)),
            exchangeRate: parseFloat(String(i.exchangeRate)),
          }))}
          bankAccounts={bankAccounts}
        />
      </div>

      {/* FX banner */}
      {!isNGN && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm">
          <span className="text-amber-700">Exchange rate:</span>
          <span className="font-mono font-semibold text-amber-900">1 {currency} = ₦{rate.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</span>
          <span className="text-amber-500 mx-2">·</span>
          <span className="text-amber-700">NGN Total:</span>
          <span className="font-mono font-semibold text-amber-900">{formatCurrency(totalNGN)}</span>
        </div>
      )}

      {/* Invoice body */}
      <div className="border border-slate-200 rounded-xl p-6">
        <div className="flex justify-between mb-6">
          <div>
            <p className="text-2xl font-bold text-slate-900">{invoice.invoiceNumber}</p>
            <p className="text-slate-500 mt-1">To: <span className="font-medium text-slate-900">{invoice.customer.companyName}</span></p>
            {invoice.customer.email && <p className="text-sm text-slate-400">{invoice.customer.email}</p>}
          </div>
          <div className="text-right">
            <p className="text-sm text-slate-500">Issue Date: <span className="text-slate-900">{formatDate(invoice.issueDate)}</span></p>
            <p className="text-sm text-slate-500 mt-1">Due Date: <span className="text-slate-900">{formatDate(invoice.dueDate)}</span></p>
            <p className="text-sm text-slate-500 mt-1">Period: <span className="font-mono text-slate-900">{invoice.recognitionPeriod}</span></p>
            {!isNGN && <p className="text-sm text-slate-500 mt-1">Currency: <span className="font-semibold text-amber-700">{currency}</span></p>}
          </div>
        </div>

        <table className="w-full text-sm mb-4">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left py-2 font-medium text-slate-500">Description</th>
              <th className="text-right py-2 font-medium text-slate-500">Qty</th>
              <th className="text-right py-2 font-medium text-slate-500">Rate ({currency})</th>
              <th className="text-right py-2 font-medium text-slate-500">Tax%</th>
              <th className="text-right py-2 font-medium text-slate-500">Amount ({currency})</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {invoice.lines.map((line) => (
              <tr key={line.id}>
                <td className="py-2.5">
                  <p className="font-medium text-slate-900">{line.description}</p>
                  {line.item && <p className="text-xs text-slate-400">{line.item.itemCode}</p>}
                </td>
                <td className="py-2.5 text-right font-mono">{parseFloat(String(line.quantity))}</td>
                <td className="py-2.5 text-right font-mono">{formatCurrency(parseFloat(String(line.rate)), currency)}</td>
                <td className="py-2.5 text-right font-mono">{parseFloat(String(line.taxRate))}%</td>
                <td className="py-2.5 text-right font-mono font-medium">{formatCurrency(parseFloat(String(line.amount)), currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end">
          <div className="w-64 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Subtotal</span>
              <span className="font-mono">{formatCurrency(parseFloat(String(invoice.subtotal)), currency)}</span>
            </div>
            {parseFloat(String(invoice.discountAmount)) > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-500">Discount</span>
                <span className="font-mono text-red-500">-{formatCurrency(parseFloat(String(invoice.discountAmount)), currency)}</span>
              </div>
            )}
            {parseFloat(String(invoice.taxAmount)) > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-500">Tax</span>
                <span className="font-mono">{formatCurrency(parseFloat(String(invoice.taxAmount)), currency)}</span>
              </div>
            )}
            <div className="flex justify-between pt-2 border-t border-slate-200 font-semibold">
              <span>Total ({currency})</span>
              <span className="font-mono">{formatCurrency(parseFloat(String(invoice.totalAmount)), currency)}</span>
            </div>
            {!isNGN && (
              <div className="flex justify-between text-xs text-amber-600">
                <span>≈ NGN equivalent</span>
                <span className="font-mono">{formatCurrency(totalNGN)}</span>
              </div>
            )}
            {parseFloat(String(invoice.amountPaid)) > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Paid</span>
                <span className="font-mono">-{formatCurrency(parseFloat(String(invoice.amountPaid)), currency)}</span>
              </div>
            )}
            <div className="flex justify-between pt-1 text-lg font-bold border-t border-slate-200">
              <span>Balance Due</span>
              <div className="text-right">
                <div className={\`font-mono \${balance > 0 ? "text-amber-600" : "text-green-600"}\`}>
                  {formatCurrency(balance, currency)}
                </div>
                {!isNGN && balance > 0 && (
                  <div className="text-xs text-amber-500 font-normal">≈ {formatCurrency(balanceNGN)}</div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* FX footnote */}
        {!isNGN && (
          <div className="mt-6 pt-4 border-t border-slate-200">
            <p className="text-xs text-slate-400">
              Exchange Rate: 1 {currency} = ₦{rate.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ·
              NGN Total: {formatCurrency(totalNGN)} · Journal entries posted at this rate.
            </p>
          </div>
        )}

        {invoice.notes && (
          <div className="mt-4 pt-4 border-t border-slate-200">
            <p className="text-xs text-slate-500 mb-1">Notes</p>
            <p className="text-sm text-slate-700">{invoice.notes}</p>
          </div>
        )}
      </div>

      {/* Payment history */}
      {invoice.payments.length > 0 && (
        <div>
          <h2 className="font-semibold text-slate-900 mb-3">Payment History</h2>
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium text-slate-500">Reference</th>
                  <th className="text-left px-4 py-2.5 font-medium text-slate-500">Date</th>
                  <th className="text-left px-4 py-2.5 font-medium text-slate-500">Method</th>
                  <th className="text-right px-4 py-2.5 font-medium text-slate-500">Amount (NGN)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoice.payments.map((alloc) => (
                  <tr key={alloc.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono text-xs text-blue-600">{alloc.payment.paymentNumber}</td>
                    <td className="px-4 py-2.5 text-slate-600">{formatDate(alloc.payment.paymentDate)}</td>
                    <td className="px-4 py-2.5 text-slate-500">{alloc.payment.method.replace("_", " ")}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-green-600">
                      {formatCurrency(parseFloat(String(alloc.amount)))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
`);

// ─── INVOICE LIST — add currency column ───────────────────
w(`${B}/app/(dashboard)/sales/invoices/page.tsx`, `import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { formatCurrency, toNGN, cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils";

const statusColors: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600",
  SENT: "bg-blue-100 text-blue-700",
  PARTIAL: "bg-amber-100 text-amber-700",
  PAID: "bg-green-100 text-green-700",
  OVERDUE: "bg-red-100 text-red-700",
  WRITTEN_OFF: "bg-slate-100 text-slate-400",
};

export default async function InvoicesPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId!;

  const invoices = await prisma.invoice.findMany({
    where: { organizationId },
    include: { customer: { select: { companyName: true } } },
    orderBy: { createdAt: "desc" },
  });

  // AR balance in NGN (all converted)
  const totalAR = invoices.reduce((s, i) => {
    const bal = parseFloat(String(i.balanceDue));
    const rate = parseFloat(String(i.exchangeRate));
    return s + toNGN(bal, rate);
  }, 0);

  const overdueCount = invoices.filter(
    (i) => new Date(i.dueDate) < new Date() && i.status !== "PAID" && i.status !== "WRITTEN_OFF"
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Sales Invoices</h1>
          <p className="text-sm text-slate-500 mt-1">
            {invoices.length} invoice{invoices.length !== 1 ? "s" : ""} ·
            AR (NGN): {formatCurrency(totalAR)}
            {overdueCount > 0 && <span className="text-red-600 ml-2">· {overdueCount} overdue</span>}
          </p>
        </div>
        <Link href="/sales/invoices/new" className={buttonVariants()}>
          <Plus className="h-4 w-4 mr-1.5" />
          New Invoice
        </Link>
      </div>

      {invoices.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-slate-200 rounded-xl">
          <FileText className="h-10 w-10 text-slate-300 mb-3" />
          <p className="text-slate-500 font-medium mb-1">No invoices yet</p>
          <p className="text-sm text-slate-400">Create your first invoice to start tracking AR.</p>
        </div>
      ) : (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Number</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Customer</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Date</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Due</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Status</th>
                <th className="text-right px-4 py-3 font-medium text-slate-500">Total</th>
                <th className="text-right px-4 py-3 font-medium text-slate-500">Balance (NGN)</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.map((inv) => {
                const balance = parseFloat(String(inv.balanceDue));
                const rate = parseFloat(String(inv.exchangeRate));
                const balanceNGN = toNGN(balance, rate);
                const totalNGN = toNGN(parseFloat(String(inv.totalAmount)), rate);
                const isNGN = inv.currency === "NGN";
                const isOverdue = new Date(inv.dueDate) < new Date() && inv.status !== "PAID" && inv.status !== "WRITTEN_OFF";
                const statusKey = isOverdue ? "OVERDUE" : inv.status;
                return (
                  <tr key={inv.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={\`/sales/invoices/\${inv.id}\`} className="font-mono text-xs text-blue-600 hover:underline">
                        {inv.invoiceNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">{inv.customer.companyName}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(inv.issueDate)}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(inv.dueDate)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className={\`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium \${statusColors[statusKey] || ""}\`}>
                          {statusKey}
                        </span>
                        {!isNGN && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
                            {inv.currency}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      <div>{formatCurrency(parseFloat(String(inv.totalAmount)), inv.currency)}</div>
                      {!isNGN && <div className="text-xs text-slate-400">≈ {formatCurrency(totalNGN)}</div>}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      <span className={balanceNGN > 0 ? "text-amber-600 font-semibold" : "text-slate-400"}>
                        {formatCurrency(balanceNGN)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={\`/sales/invoices/\${inv.id}\`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-7 px-2 text-xs")}>
                        View
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
`);

console.log('\n✅ Invoice FX module done');
