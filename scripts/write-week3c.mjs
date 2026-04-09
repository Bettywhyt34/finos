import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const B = 'C:/Users/digit/Projects/finos/finos-v5';

function w(p, c) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, c, 'utf8');
  console.log('✓', p.replace(B, ''));
}

// ════════════════════════════════════════════════════════════
// SALES INVOICES — Server Actions
// ════════════════════════════════════════════════════════════

w(`${B}/app/(dashboard)/sales/invoices/actions.ts`, `"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { postJournalEntry } from "@/lib/journal";
import { getRecognitionPeriod } from "@/lib/utils";

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
  lines: LineItem[];
}) {
  const session = await auth();
  const orgId = session?.user?.organizationId;
  const userId = session?.user?.id;
  if (!orgId || !userId) return { error: "Unauthorized" };

  if (data.lines.length === 0) return { error: "At least one line item is required" };

  const subtotal = data.lines.reduce((s, l) => s + l.quantity * l.rate, 0);
  const taxAmount = data.lines.reduce((s, l) => s + l.quantity * l.rate * (l.taxRate / 100), 0);
  const totalAmount = subtotal - data.discountAmount + taxAmount;
  const invoiceNumber = await getNextInvoiceNumber(orgId);

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

    // Auto-post journal entry: Dr AR (CA-001) / Cr Revenue
    // Find the revenue account from the first line item's income account or default
    const revenueAccountCode = "IN-001"; // Default revenue account
    await postJournalEntry({
      organizationId: orgId,
      createdBy: userId,
      entryDate: new Date(data.issueDate),
      reference: invoiceNumber,
      description: \`Invoice \${invoiceNumber}\`,
      recognitionPeriod: data.recognitionPeriod,
      source: "invoice",
      sourceId: invoice.id,
      lines: [
        { accountCode: "CA-001", description: \`AR - \${invoiceNumber}\`, debit: totalAmount, credit: 0 },
        { accountCode: revenueAccountCode, description: \`Revenue - \${invoiceNumber}\`, debit: 0, credit: totalAmount },
      ],
    }).catch(() => {
      // Journal posting is best-effort; invoice is still created
    });

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
  amount: number;
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

      // Update each invoice's amountPaid and balanceDue
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

    // Auto-post journal: Dr Bank (CA-003) / Cr AR (CA-001)
    // Find a default bank account
    const bankAccount = await prisma.bankAccount.findFirst({
      where: { organizationId: orgId, isActive: true },
    });
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

// ─── INVOICE LIST PAGE ─────────────────────────────────────
w(`${B}/app/(dashboard)/sales/invoices/page.tsx`, `import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { formatCurrency, formatDate, cn } from "@/lib/utils";

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
    include: { customer: { select: { companyName: true, customerCode: true } } },
    orderBy: { createdAt: "desc" },
  });

  const totalAR = invoices.reduce((s, i) => s + parseFloat(String(i.balanceDue)), 0);
  const overdueCount = invoices.filter((i) => i.status === "OVERDUE" || (new Date(i.dueDate) < new Date() && i.status !== "PAID")).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Sales Invoices</h1>
          <p className="text-sm text-slate-500 mt-1">
            {invoices.length} invoice{invoices.length !== 1 ? "s" : ""} ·
            AR: {formatCurrency(totalAR)}
            {overdueCount > 0 && (
              <span className="text-red-600 ml-2">· {overdueCount} overdue</span>
            )}
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
                <th className="text-right px-4 py-3 font-medium text-slate-500">Balance</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.map((inv) => {
                const balance = parseFloat(String(inv.balanceDue));
                const isOverdue = new Date(inv.dueDate) < new Date() && inv.status !== "PAID" && inv.status !== "WRITTEN_OFF";
                const statusKey = isOverdue && inv.status !== "PAID" ? "OVERDUE" : inv.status;
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
                      <span className={\`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium \${statusColors[statusKey] || ""}\`}>
                        {statusKey}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{formatCurrency(parseFloat(String(inv.totalAmount)))}</td>
                    <td className="px-4 py-3 text-right font-mono">
                      <span className={balance > 0 ? "text-amber-600 font-semibold" : "text-slate-400"}>
                        {formatCurrency(balance)}
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

// ─── NEW INVOICE PAGE ──────────────────────────────────────
w(`${B}/app/(dashboard)/sales/invoices/new/page.tsx`, `import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { InvoiceForm } from "./invoice-form";

export default async function NewInvoicePage() {
  const session = await auth();
  const organizationId = session!.user.organizationId!;

  const [customers, items, accounts] = await Promise.all([
    prisma.customer.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, companyName: true, customerCode: true, paymentTerms: true },
      orderBy: { companyName: "asc" },
    }),
    prisma.item.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, itemCode: true, name: true, salesPrice: true, type: true },
      orderBy: { name: "asc" },
    }),
    prisma.chartOfAccounts.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
  ]);

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900 mb-6">New Invoice</h1>
      <InvoiceForm
        customers={customers}
        items={items.map((i) => ({ ...i, salesPrice: i.salesPrice ? parseFloat(String(i.salesPrice)) : null }))}
        accounts={accounts}
      />
    </div>
  );
}
`);

w(`${B}/app/(dashboard)/sales/invoices/new/invoice-form.tsx`, `"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createInvoice } from "../actions";
import { formatCurrency } from "@/lib/utils";

interface Customer { id: string; companyName: string; customerCode: string; paymentTerms: number; }
interface Item { id: string; itemCode: string; name: string; salesPrice: number | null; type: string; }
interface Account { id: string; code: string; name: string; }

interface LineItem {
  id: string;
  itemId: string;
  description: string;
  quantity: number;
  rate: number;
  taxRate: number;
}

function today() {
  return new Date().toISOString().split("T")[0];
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function getMonthPeriod(dateStr: string): string {
  const d = new Date(dateStr);
  return \`\${d.getFullYear()}-\${String(d.getMonth() + 1).padStart(2, "0")}\`;
}

export function InvoiceForm({ customers, items, accounts: _accounts }: { customers: Customer[]; items: Item[]; accounts: Account[]; }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [issueDate, setIssueDate] = useState(today());
  const [dueDate, setDueDate] = useState(addDays(today(), 30));
  const [discountAmount, setDiscountAmount] = useState(0);
  const [recognitionPeriod, setRecognitionPeriod] = useState(getMonthPeriod(today()));
  const [lines, setLines] = useState<LineItem[]>([
    { id: crypto.randomUUID(), itemId: "", description: "", quantity: 1, rate: 0, taxRate: 0 },
  ]);

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
    setLines((prev) =>
      prev.map((l) =>
        l.id === lineId
          ? { ...l, itemId, description: item?.name || "", rate: item?.salesPrice ?? 0 }
          : l
      )
    );
  }

  function updateLine(lineId: string, field: keyof LineItem, value: string | number) {
    setLines((prev) => prev.map((l) => (l.id === lineId ? { ...l, [field]: value } : l)));
  }

  function addLine() {
    setLines((prev) => [...prev, { id: crypto.randomUUID(), itemId: "", description: "", quantity: 1, rate: 0, taxRate: 0 }]);
  }

  function removeLine(lineId: string) {
    if (lines.length === 1) return;
    setLines((prev) => prev.filter((l) => l.id !== lineId));
  }

  const subtotal = lines.reduce((s, l) => s + l.quantity * l.rate, 0);
  const taxAmount = lines.reduce((s, l) => s + l.quantity * l.rate * (l.taxRate / 100), 0);
  const total = subtotal - discountAmount + taxAmount;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!customerId) { setError("Please select a customer"); return; }
    setLoading(true);
    setError(null);
    const result = await createInvoice({
      customerId,
      issueDate,
      dueDate,
      discountAmount,
      recognitionPeriod,
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
      {/* Header fields */}
      <div className="border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Customer *</Label>
            <Select value={customerId} onValueChange={(v) => handleCustomerChange(v ?? "")}>
              <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
              <SelectContent>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reference">Reference (optional)</Label>
            <Input id="reference" name="reference" placeholder="PO-12345" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label>Issue Date</Label>
            <Input type="date" value={issueDate} onChange={(e) => handleIssueDateChange(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Due Date</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Recognition Period</Label>
            <Input
              value={recognitionPeriod}
              onChange={(e) => setRecognitionPeriod(e.target.value)}
              placeholder="YYYY-MM"
              pattern="\\d{4}-\\d{2}"
            />
          </div>
        </div>
      </div>

      {/* Line items */}
      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
          <span className="font-medium text-sm text-slate-700">Line Items</span>
          <Button type="button" variant="ghost" size="sm" onClick={addLine}>
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
                    {items.map((i) => (
                      <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-3">
                {idx === 0 && <Label className="block mb-1.5 text-xs">Description</Label>}
                <Input
                  className="h-8 text-xs"
                  value={line.description}
                  onChange={(e) => updateLine(line.id, "description", e.target.value)}
                  placeholder="Description"
                />
              </div>
              <div className="col-span-1">
                {idx === 0 && <Label className="block mb-1.5 text-xs">Qty</Label>}
                <Input
                  className="h-8 text-xs"
                  type="number"
                  min="0"
                  step="0.01"
                  value={line.quantity}
                  onChange={(e) => updateLine(line.id, "quantity", parseFloat(e.target.value) || 0)}
                />
              </div>
              <div className="col-span-2">
                {idx === 0 && <Label className="block mb-1.5 text-xs">Rate</Label>}
                <Input
                  className="h-8 text-xs"
                  type="number"
                  min="0"
                  step="0.01"
                  value={line.rate}
                  onChange={(e) => updateLine(line.id, "rate", parseFloat(e.target.value) || 0)}
                />
              </div>
              <div className="col-span-1">
                {idx === 0 && <Label className="block mb-1.5 text-xs">Tax%</Label>}
                <Input
                  className="h-8 text-xs"
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={line.taxRate}
                  onChange={(e) => updateLine(line.id, "taxRate", parseFloat(e.target.value) || 0)}
                />
              </div>
              <div className="col-span-1">
                {idx === 0 && <Label className="block mb-1.5 text-xs">Amount</Label>}
                <div className="h-8 flex items-center text-xs font-mono text-slate-600">
                  {formatCurrency(line.quantity * line.rate)}
                </div>
              </div>
              <div className="col-span-1 flex items-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-slate-400 hover:text-red-500"
                  onClick={() => removeLine(line.id)}
                  disabled={lines.length === 1}
                >
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
              <span className="font-mono w-28 text-right">{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex gap-8 items-center">
              <span className="text-slate-500">Discount</span>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={discountAmount}
                onChange={(e) => setDiscountAmount(parseFloat(e.target.value) || 0)}
                className="h-6 w-28 text-xs text-right font-mono"
              />
            </div>
            {taxAmount > 0 && (
              <div className="flex gap-8">
                <span className="text-slate-500">Tax</span>
                <span className="font-mono w-28 text-right">{formatCurrency(taxAmount)}</span>
              </div>
            )}
            <div className="flex gap-8 pt-1 border-t border-slate-300 mt-1">
              <span className="font-semibold text-slate-900">Total</span>
              <span className="font-bold font-mono w-28 text-right text-slate-900">{formatCurrency(total)}</span>
            </div>
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
        <Button type="submit" disabled={loading}>
          {loading ? "Creating…" : "Create Invoice"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
`);

// ─── INVOICE DETAIL PAGE ───────────────────────────────────
w(`${B}/app/(dashboard)/sales/invoices/[id]/page.tsx`, `import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
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
      payments: {
        include: { payment: true },
      },
    },
  });

  if (!invoice) notFound();

  const openInvoices = await prisma.invoice.findMany({
    where: {
      organizationId,
      customerId: invoice.customerId,
      status: { in: ["SENT", "PARTIAL", "OVERDUE"] },
    },
    select: { id: true, invoiceNumber: true, balanceDue: true, dueDate: true },
    orderBy: { dueDate: "asc" },
  });

  const bankAccounts = await prisma.bankAccount.findMany({
    where: { organizationId, isActive: true },
    select: { id: true, accountName: true, bankName: true },
  });

  const balance = parseFloat(String(invoice.balanceDue));

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
        </div>
        <InvoiceActions
          invoice={{ id: invoice.id, status: invoice.status, customerId: invoice.customerId, balanceDue: balance }}
          openInvoices={openInvoices.map((i) => ({ ...i, balanceDue: parseFloat(String(i.balanceDue)) }))}
          bankAccounts={bankAccounts}
        />
      </div>

      {/* Invoice header */}
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
          </div>
        </div>

        {/* Lines */}
        <table className="w-full text-sm mb-4">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left py-2 font-medium text-slate-500">Description</th>
              <th className="text-right py-2 font-medium text-slate-500">Qty</th>
              <th className="text-right py-2 font-medium text-slate-500">Rate</th>
              <th className="text-right py-2 font-medium text-slate-500">Tax%</th>
              <th className="text-right py-2 font-medium text-slate-500">Amount</th>
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
                <td className="py-2.5 text-right font-mono">{formatCurrency(parseFloat(String(line.rate)))}</td>
                <td className="py-2.5 text-right font-mono">{parseFloat(String(line.taxRate))}%</td>
                <td className="py-2.5 text-right font-mono font-medium">{formatCurrency(parseFloat(String(line.amount)))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="flex justify-end">
          <div className="w-56 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Subtotal</span>
              <span className="font-mono">{formatCurrency(parseFloat(String(invoice.subtotal)))}</span>
            </div>
            {parseFloat(String(invoice.discountAmount)) > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-500">Discount</span>
                <span className="font-mono text-red-500">-{formatCurrency(parseFloat(String(invoice.discountAmount)))}</span>
              </div>
            )}
            {parseFloat(String(invoice.taxAmount)) > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-500">Tax</span>
                <span className="font-mono">{formatCurrency(parseFloat(String(invoice.taxAmount)))}</span>
              </div>
            )}
            <div className="flex justify-between pt-2 border-t border-slate-200 font-semibold">
              <span>Total</span>
              <span className="font-mono">{formatCurrency(parseFloat(String(invoice.totalAmount)))}</span>
            </div>
            {parseFloat(String(invoice.amountPaid)) > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Paid</span>
                <span className="font-mono">-{formatCurrency(parseFloat(String(invoice.amountPaid)))}</span>
              </div>
            )}
            <div className="flex justify-between pt-1 text-lg font-bold">
              <span>Balance Due</span>
              <span className={\`font-mono \${balance > 0 ? "text-amber-600" : "text-green-600"}\`}>{formatCurrency(balance)}</span>
            </div>
          </div>
        </div>

        {invoice.notes && (
          <div className="mt-6 pt-4 border-t border-slate-200">
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
                  <th className="text-right px-4 py-2.5 font-medium text-slate-500">Amount</th>
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

w(`${B}/app/(dashboard)/sales/invoices/[id]/invoice-actions.tsx`, `"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send, CreditCard, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { sendInvoice, recordPayment } from "../actions";
import { formatCurrency } from "@/lib/utils";

interface OpenInvoice { id: string; invoiceNumber: string; balanceDue: number; dueDate: Date; }
interface BankAccount { id: string; accountName: string; bankName: string; }

interface Props {
  invoice: { id: string; status: string; customerId: string; balanceDue: number; };
  openInvoices: OpenInvoice[];
  bankAccounts: BankAccount[];
}

interface Allocation { invoiceId: string; invoiceNumber: string; maxAmount: number; amount: number; }

export function InvoiceActions({ invoice, openInvoices, bankAccounts }: Props) {
  const router = useRouter();
  const [payOpen, setPayOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split("T")[0]);
  const [amount, setAmount] = useState(invoice.balanceDue);
  const [allocations, setAllocations] = useState<Allocation[]>(() =>
    openInvoices.map((i) => ({
      invoiceId: i.id,
      invoiceNumber: i.invoiceNumber,
      maxAmount: i.balanceDue,
      amount: i.id === invoice.id ? Math.min(invoice.balanceDue, i.balanceDue) : 0,
    }))
  );

  const totalAllocated = allocations.reduce((s, a) => s + a.amount, 0);

  function autoAllocate(total: number) {
    let remaining = total;
    setAllocations((prev) =>
      prev.map((a) => {
        const allocated = Math.min(remaining, a.maxAmount);
        remaining = Math.max(0, remaining - allocated);
        return { ...a, amount: Math.round(allocated * 100) / 100 };
      })
    );
  }

  async function handleSend() {
    setLoading(true);
    const result = await sendInvoice(invoice.id);
    setLoading(false);
    if (result?.error) { toast.error(result.error); return; }
    toast.success("Invoice marked as sent");
    router.refresh();
  }

  async function handlePayment(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (Math.abs(totalAllocated - amount) > 0.01) {
      toast.error(\`Allocated \${formatCurrency(totalAllocated)} ≠ payment \${formatCurrency(amount)}\`);
      return;
    }
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    const result = await recordPayment({
      customerId: invoice.customerId,
      paymentDate,
      amount,
      method,
      reference: String(fd.get("reference") || ""),
      notes: String(fd.get("notes") || ""),
      invoiceAllocations: allocations.filter((a) => a.amount > 0).map((a) => ({ invoiceId: a.invoiceId, amount: a.amount })),
    });
    setLoading(false);
    if (result?.error) { toast.error(result.error); return; }
    toast.success("Payment recorded");
    setPayOpen(false);
    router.refresh();
  }

  const canSend = ["DRAFT", "PARTIAL", "OVERDUE"].includes(invoice.status);
  const canPay = invoice.balanceDue > 0;

  return (
    <div className="flex items-center gap-2">
      {canSend && (
        <Button variant="outline" size="sm" onClick={handleSend} disabled={loading}>
          <Send className="h-3.5 w-3.5 mr-1.5" />
          Mark as Sent
        </Button>
      )}
      {canPay && (
        <Button size="sm" onClick={() => setPayOpen(true)}>
          <CreditCard className="h-3.5 w-3.5 mr-1.5" />
          Record Payment
        </Button>
      )}

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Record Payment</DialogTitle></DialogHeader>
          <form onSubmit={handlePayment} className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Payment Date</Label>
                <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label>Amount</Label>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value) || 0;
                    setAmount(v);
                    autoAllocate(v);
                  }}
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Method</Label>
                <Select value={method} onValueChange={(v) => setMethod(v ?? "BANK_TRANSFER")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BANK_TRANSFER">Bank Transfer</SelectItem>
                    <SelectItem value="CHECK">Cheque</SelectItem>
                    <SelectItem value="CASH">Cash</SelectItem>
                    <SelectItem value="CARD">Card</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reference">Reference</Label>
                <Input id="reference" name="reference" placeholder="Bank ref / cheque no." />
              </div>
            </div>

            {/* Invoice allocation */}
            {openInvoices.length > 1 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Allocate to Invoices</Label>
                  <Button type="button" variant="ghost" size="sm" className="h-6 text-xs" onClick={() => autoAllocate(amount)}>
                    Auto-allocate
                  </Button>
                </div>
                <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                  {allocations.map((alloc) => (
                    <div key={alloc.invoiceId} className="flex items-center gap-3 px-3 py-2">
                      <span className="font-mono text-xs text-slate-600 w-24">{alloc.invoiceNumber}</span>
                      <span className="text-xs text-slate-400 flex-1">max {formatCurrency(alloc.maxAmount)}</span>
                      <Input
                        type="number"
                        min="0"
                        max={alloc.maxAmount}
                        step="0.01"
                        value={alloc.amount}
                        onChange={(e) => setAllocations((prev) =>
                          prev.map((a) => a.invoiceId === alloc.invoiceId ? { ...a, amount: parseFloat(e.target.value) || 0 } : a)
                        )}
                        className="h-7 w-28 text-xs text-right"
                      />
                    </div>
                  ))}
                </div>
                <div className={\`text-xs text-right \${Math.abs(totalAllocated - amount) > 0.01 ? "text-red-500" : "text-green-600"}\`}>
                  Allocated: {formatCurrency(totalAllocated)} / {formatCurrency(amount)}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Input id="notes" name="notes" />
            </div>

            <DialogFooter className="pt-2">
              <DialogClose asChild>
                <Button type="button" variant="outline">Cancel</Button>
              </DialogClose>
              <Button type="submit" disabled={loading}>{loading ? "Saving…" : "Record Payment"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
`);

console.log('\n✅ Invoices module done');
