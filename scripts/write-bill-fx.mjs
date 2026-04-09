import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const B = 'C:/Users/digit/Projects/finos/finos-v5';
function w(p, c) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, c, 'utf8');
  console.log('✓', p.replace(B, ''));
}

// ════════════════════════════════════════════════════════════
// BILL ACTIONS — updated with currency + exchangeRate
// ════════════════════════════════════════════════════════════

w(`${B}/app/(dashboard)/purchases/bills/actions.ts`, `"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { postJournalEntry } from "@/lib/journal";
import { getRecognitionPeriod, toNGN } from "@/lib/utils";

async function getNextBillNumber(orgId: string): Promise<string> {
  const count = await prisma.bill.count({ where: { organizationId: orgId } });
  return \`BILL-\${String(count + 1).padStart(5, "0")}\`;
}

export interface BillLineItem {
  itemId?: string;
  description: string;
  quantity: number;
  rate: number;
  accountId: string;
}

export async function createBill(data: {
  vendorId: string;
  vendorRef?: string;
  billDate: string;
  dueDate: string;
  notes?: string;
  currency: string;
  exchangeRate: number;
  lines: BillLineItem[];
}) {
  const session = await auth();
  const orgId = session?.user?.organizationId;
  const userId = session?.user?.id;
  if (!orgId || !userId) return { error: "Unauthorized" };

  if (data.lines.length === 0) return { error: "At least one line item is required" };
  if (data.lines.some((l) => !l.accountId)) return { error: "Each line must have an expense account" };

  const rate = data.exchangeRate || 1;
  const subtotal = data.lines.reduce((s, l) => s + l.quantity * l.rate, 0);
  const subtotalNGN = toNGN(subtotal, rate);
  const billNumber = await getNextBillNumber(orgId);
  const fxNote = rate !== 1 ? \` (\${data.currency} @ \${rate})\` : "";

  try {
    const bill = await prisma.bill.create({
      data: {
        organizationId: orgId,
        vendorId: data.vendorId,
        billNumber,
        vendorRef: data.vendorRef || null,
        billDate: new Date(data.billDate),
        dueDate: new Date(data.dueDate),
        status: "DRAFT",
        currency: data.currency,
        exchangeRate: rate,
        subtotal,
        taxAmount: 0,
        totalAmount: subtotal,
        amountPaid: 0,
        notes: data.notes || null,
        lines: {
          create: data.lines.map((l) => ({
            itemId: l.itemId || null,
            description: l.description,
            quantity: l.quantity,
            rate: l.rate,
            amount: l.quantity * l.rate,
            accountId: l.accountId,
          })),
        },
      },
    });

    // Fetch expense account codes for journal
    const accountIds = Array.from(new Set(data.lines.map((l) => l.accountId)));
    const accounts = await prisma.chartOfAccounts.findMany({
      where: { id: { in: accountIds } },
      select: { id: true, code: true },
    });
    const idToCode = Object.fromEntries(accounts.map((a) => [a.id, a.code]));

    const period = getRecognitionPeriod(new Date(data.billDate));

    // Aggregate by account code in NGN
    const expenseByCode: Record<string, number> = {};
    for (const l of data.lines) {
      const code = idToCode[l.accountId];
      expenseByCode[code] = (expenseByCode[code] ?? 0) + toNGN(l.quantity * l.rate, rate);
    }

    await postJournalEntry({
      organizationId: orgId,
      createdBy: userId,
      entryDate: new Date(data.billDate),
      reference: billNumber,
      description: \`Bill \${billNumber}\${fxNote}\`,
      recognitionPeriod: period,
      source: "bill",
      sourceId: bill.id,
      lines: [
        ...Object.entries(expenseByCode).map(([code, amtNGN]) => ({
          accountCode: code,
          description: \`Expense - \${billNumber}\${fxNote}\`,
          debit: amtNGN,
          credit: 0,
        })),
        { accountCode: "CL-001", description: \`AP - \${billNumber}\${fxNote}\`, debit: 0, credit: subtotalNGN },
      ],
    }).catch(() => {});

    revalidatePath("/purchases/bills");
    return { success: true, id: bill.id };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function recordBillPayment(data: {
  vendorId: string;
  paymentDate: string;
  amount: number;          // always in NGN
  method: string;
  reference?: string;
  whtAmount: number;
  billAllocations: { billId: string; amount: number }[];
}) {
  const session = await auth();
  const orgId = session?.user?.organizationId;
  const userId = session?.user?.id;
  if (!orgId || !userId) return { error: "Unauthorized" };

  const count = await prisma.vendorPayment.count({ where: { organizationId: orgId } });
  const paymentNumber = \`VPY-\${String(count + 1).padStart(5, "0")}\`;
  const netAmount = data.amount - data.whtAmount;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.vendorPayment.create({
        data: {
          organizationId: orgId,
          vendorId: data.vendorId,
          paymentNumber,
          paymentDate: new Date(data.paymentDate),
          amount: data.amount,
          method: data.method as "BANK_TRANSFER" | "CHECK" | "CASH" | "CARD",
          reference: data.reference || null,
          whtAmount: data.whtAmount,
        },
      });

      for (const alloc of data.billAllocations) {
        const bill = await tx.bill.findUnique({ where: { id: alloc.billId } });
        if (!bill) continue;
        const newPaid = parseFloat(String(bill.amountPaid)) + alloc.amount;
        const newBalance = parseFloat(String(bill.totalAmount)) - newPaid;
        const newStatus = newBalance <= 0.01 ? "PAID" : newPaid > 0 ? "PARTIAL" : bill.status;
        await tx.bill.update({
          where: { id: alloc.billId },
          data: { amountPaid: newPaid, status: newStatus },
        });
      }
    });

    const period = getRecognitionPeriod(new Date(data.paymentDate));
    const jLines = [
      { accountCode: "CL-001", description: \`AP settled - \${paymentNumber}\`, debit: data.amount, credit: 0 },
      { accountCode: "CA-003", description: \`Bank payment - \${paymentNumber}\`, debit: 0, credit: netAmount },
    ];
    if (data.whtAmount > 0) {
      jLines.push({ accountCode: "CL-002", description: \`WHT payable - \${paymentNumber}\`, debit: 0, credit: data.whtAmount });
    }
    await postJournalEntry({
      organizationId: orgId,
      createdBy: userId,
      entryDate: new Date(data.paymentDate),
      reference: paymentNumber,
      description: \`Vendor payment \${paymentNumber}\`,
      recognitionPeriod: period,
      source: "vendor_payment",
      sourceId: paymentNumber,
      lines: jLines,
    }).catch(() => {});

    revalidatePath("/purchases/bills");
    revalidatePath("/purchases/payments");
    return { success: true };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
`);

// ─── BILL FORM — with FX rate UI ─────────────────────────
w(`${B}/app/(dashboard)/purchases/bills/new/bill-form.tsx`, `"use client";

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
    router.push(\`/purchases/bills/\${result.id}\`);
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
              <RefreshCw className={\`h-3.5 w-3.5 mr-1.5 \${rateLoading ? "animate-spin" : ""}\`} />
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
`);

// ─── BILL DETAIL — show FX info ────────────────────────────
w(`${B}/app/(dashboard)/purchases/bills/[id]/page.tsx`, `import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { formatCurrency, toNGN, formatDate, cn } from "@/lib/utils";
import { BillActions } from "./bill-actions";

const statusColors: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600",
  RECORDED: "bg-blue-100 text-blue-700",
  PARTIAL: "bg-amber-100 text-amber-700",
  PAID: "bg-green-100 text-green-700",
  OVERDUE: "bg-red-100 text-red-700",
};

export default async function BillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const organizationId = session!.user.organizationId!;

  const bill = await prisma.bill.findFirst({
    where: { id, organizationId },
    include: {
      vendor: true,
      lines: { include: { item: { select: { name: true, itemCode: true } } } },
    },
  });

  if (!bill) notFound();

  const openBills = await prisma.bill.findMany({
    where: {
      organizationId,
      vendorId: bill.vendorId,
      status: { in: ["RECORDED", "PARTIAL", "OVERDUE"] },
    },
    select: { id: true, billNumber: true, totalAmount: true, amountPaid: true, dueDate: true },
    orderBy: { dueDate: "asc" },
  });

  const currency = bill.currency;
  const rate = parseFloat(String(bill.exchangeRate));
  const isNGN = currency === "NGN";
  const balance = parseFloat(String(bill.totalAmount)) - parseFloat(String(bill.amountPaid));
  const totalNGN = toNGN(parseFloat(String(bill.totalAmount)), rate);
  const isWht = bill.vendor.isWhtEligible;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/purchases/bills" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Bills
          </Link>
          <span className="text-slate-300">/</span>
          <span className="font-mono text-sm font-semibold">{bill.billNumber}</span>
          <span className={\`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium \${statusColors[bill.status] || ""}\`}>
            {bill.status}
          </span>
          {!isNGN && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
              {currency}
            </span>
          )}
        </div>
        <BillActions
          bill={{ id: bill.id, status: bill.status, vendorId: bill.vendorId, balance, isWhtEligible: isWht }}
          openBills={openBills.map((b) => ({
            id: b.id,
            billNumber: b.billNumber,
            balance: parseFloat(String(b.totalAmount)) - parseFloat(String(b.amountPaid)),
          }))}
        />
      </div>

      {!isNGN && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm">
          <span className="text-amber-700">Exchange rate:</span>
          <span className="font-mono font-semibold text-amber-900">1 {currency} = ₦{rate.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</span>
          <span className="text-amber-500 mx-2">·</span>
          <span className="text-amber-700">NGN Total:</span>
          <span className="font-mono font-semibold text-amber-900">{formatCurrency(totalNGN)}</span>
        </div>
      )}

      <div className="border border-slate-200 rounded-xl p-6">
        <div className="flex justify-between mb-6">
          <div>
            <p className="text-2xl font-bold text-slate-900">{bill.billNumber}</p>
            <p className="text-slate-500 mt-1">From: <span className="font-medium text-slate-900">{bill.vendor.companyName}</span></p>
            {bill.vendorRef && <p className="text-sm text-slate-400">Vendor ref: {bill.vendorRef}</p>}
          </div>
          <div className="text-right">
            <p className="text-sm text-slate-500">Bill Date: <span className="text-slate-900">{formatDate(bill.billDate)}</span></p>
            <p className="text-sm text-slate-500 mt-1">Due: <span className="text-slate-900">{formatDate(bill.dueDate)}</span></p>
            {!isNGN && <p className="text-sm text-slate-500 mt-1">Currency: <span className="font-semibold text-amber-700">{currency}</span></p>}
          </div>
        </div>

        <table className="w-full text-sm mb-4">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left py-2 font-medium text-slate-500">Description</th>
              <th className="text-right py-2 font-medium text-slate-500">Qty</th>
              <th className="text-right py-2 font-medium text-slate-500">Rate ({currency})</th>
              <th className="text-right py-2 font-medium text-slate-500">Amount ({currency})</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {bill.lines.map((line) => (
              <tr key={line.id}>
                <td className="py-2.5">
                  <p className="font-medium text-slate-900">{line.description}</p>
                  {line.item && <p className="text-xs text-slate-400">{line.item.itemCode}</p>}
                </td>
                <td className="py-2.5 text-right font-mono">{parseFloat(String(line.quantity))}</td>
                <td className="py-2.5 text-right font-mono">{formatCurrency(parseFloat(String(line.rate)), currency)}</td>
                <td className="py-2.5 text-right font-mono font-medium">{formatCurrency(parseFloat(String(line.amount)), currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end">
          <div className="w-60 space-y-1.5 text-sm">
            <div className="flex justify-between pt-2 border-t border-slate-200 font-semibold">
              <span>Total ({currency})</span>
              <span className="font-mono">{formatCurrency(parseFloat(String(bill.totalAmount)), currency)}</span>
            </div>
            {!isNGN && (
              <div className="flex justify-between text-xs text-amber-600">
                <span>≈ NGN equivalent</span>
                <span className="font-mono">{formatCurrency(totalNGN)}</span>
              </div>
            )}
            {parseFloat(String(bill.amountPaid)) > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Paid (NGN)</span>
                <span className="font-mono">-{formatCurrency(parseFloat(String(bill.amountPaid)))}</span>
              </div>
            )}
            <div className="flex justify-between pt-1 text-lg font-bold border-t border-slate-200">
              <span>Balance</span>
              <span className={\`font-mono \${balance > 0 ? "text-red-600" : "text-green-600"}\`}>
                {formatCurrency(balance, currency)}
              </span>
            </div>
          </div>
        </div>

        {!isNGN && (
          <div className="mt-6 pt-4 border-t border-slate-200">
            <p className="text-xs text-slate-400">
              Exchange Rate: 1 {currency} = ₦{rate.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ·
              NGN Total: {formatCurrency(totalNGN)} · Journals posted at this rate.
            </p>
          </div>
        )}

        {bill.notes && (
          <div className="mt-4 pt-4 border-t border-slate-200">
            <p className="text-xs text-slate-500 mb-1">Notes</p>
            <p className="text-sm text-slate-700">{bill.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}
`);

console.log('\n✅ Bill FX module done');
