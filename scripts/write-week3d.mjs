import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const B = 'C:/Users/digit/Projects/finos/finos-v5';

function w(p, c) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, c, 'utf8');
  console.log('✓', p.replace(B, ''));
}

// ════════════════════════════════════════════════════════════
// CUSTOMER RECEIPTS page
// ════════════════════════════════════════════════════════════

w(`${B}/app/(dashboard)/sales/receipts/page.tsx`, `import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { CreditCard } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { formatCurrency, formatDate, cn } from "@/lib/utils";

export default async function ReceiptsPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId!;

  const payments = await prisma.customerPayment.findMany({
    where: { organizationId },
    include: {
      customer: { select: { companyName: true } },
      allocations: { include: { invoice: { select: { invoiceNumber: true } } } },
    },
    orderBy: { paymentDate: "desc" },
  });

  const totalReceived = payments.reduce((s, p) => s + parseFloat(String(p.amount)), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Customer Receipts</h1>
          <p className="text-sm text-slate-500 mt-1">
            {payments.length} payment{payments.length !== 1 ? "s" : ""} ·
            Total: {formatCurrency(totalReceived)}
          </p>
        </div>
      </div>

      {payments.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-slate-200 rounded-xl">
          <CreditCard className="h-10 w-10 text-slate-300 mb-3" />
          <p className="text-slate-500 font-medium mb-1">No receipts yet</p>
          <p className="text-sm text-slate-400">Record payments from the invoice detail page.</p>
        </div>
      ) : (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Reference</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Customer</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Date</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Method</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Invoices</th>
                <th className="text-right px-4 py-3 font-medium text-slate-500">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payments.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs text-blue-600">{p.paymentNumber}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{p.customer.companyName}</td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(p.paymentDate)}</td>
                  <td className="px-4 py-3 text-slate-500">{p.method.replace("_", " ")}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {p.allocations.map((a) => (
                      <Link key={a.id} href={\`/sales/invoices/\${a.invoiceId}\`} className="hover:underline text-blue-600 mr-2">
                        {a.invoice.invoiceNumber}
                      </Link>
                    ))}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-green-600">
                    {formatCurrency(parseFloat(String(p.amount)))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
`);

// ════════════════════════════════════════════════════════════
// BILLS — Actions + Pages
// ════════════════════════════════════════════════════════════

w(`${B}/app/(dashboard)/purchases/bills/actions.ts`, `"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { postJournalEntry } from "@/lib/journal";
import { getRecognitionPeriod } from "@/lib/utils";

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
  lines: BillLineItem[];
}) {
  const session = await auth();
  const orgId = session?.user?.organizationId;
  const userId = session?.user?.id;
  if (!orgId || !userId) return { error: "Unauthorized" };

  if (data.lines.length === 0) return { error: "At least one line item is required" };
  if (data.lines.some((l) => !l.accountId)) return { error: "Each line must have an expense account" };

  const subtotal = data.lines.reduce((s, l) => s + l.quantity * l.rate, 0);
  const billNumber = await getNextBillNumber(orgId);

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

    // Auto-post journal: Dr Expense accounts / Cr AP (CL-001)
    const journalLines = [
      ...data.lines.map((l) => {
        // Resolve account code from ID
        return { accountId: l.accountId, amount: l.quantity * l.rate };
      }),
    ];

    // We need account codes for journal posting - fetch them
    const accountIds = Array.from(new Set(data.lines.map((l) => l.accountId)));
    const accounts = await prisma.chartOfAccounts.findMany({
      where: { id: { in: accountIds } },
      select: { id: true, code: true },
    });
    const idToCode = Object.fromEntries(accounts.map((a) => [a.id, a.code]));

    const period = getRecognitionPeriod(new Date(data.billDate));
    await postJournalEntry({
      organizationId: orgId,
      createdBy: userId,
      entryDate: new Date(data.billDate),
      reference: billNumber,
      description: \`Bill \${billNumber}\`,
      recognitionPeriod: period,
      source: "bill",
      sourceId: bill.id,
      lines: [
        ...data.lines.map((l) => ({
          accountCode: idToCode[l.accountId],
          description: l.description,
          debit: l.quantity * l.rate,
          credit: 0,
        })),
        { accountCode: "CL-001", description: \`AP - \${billNumber}\`, debit: 0, credit: subtotal },
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
  amount: number;
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

      // Update each bill
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

    // Auto-post journal: Dr AP (CL-001) / Cr Bank (CA-003) + WHT payable if any
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

// ─── BILLS LIST PAGE ───────────────────────────────────────
w(`${B}/app/(dashboard)/purchases/bills/page.tsx`, `import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Receipt, Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { formatCurrency, formatDate, cn } from "@/lib/utils";

const statusColors: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600",
  RECORDED: "bg-blue-100 text-blue-700",
  PARTIAL: "bg-amber-100 text-amber-700",
  PAID: "bg-green-100 text-green-700",
  OVERDUE: "bg-red-100 text-red-700",
};

export default async function BillsPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId!;

  const bills = await prisma.bill.findMany({
    where: { organizationId },
    include: { vendor: { select: { companyName: true, vendorCode: true } } },
    orderBy: { createdAt: "desc" },
  });

  const totalAP = bills.reduce((s, b) => {
    const balance = parseFloat(String(b.totalAmount)) - parseFloat(String(b.amountPaid));
    return s + balance;
  }, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Bills</h1>
          <p className="text-sm text-slate-500 mt-1">
            {bills.length} bill{bills.length !== 1 ? "s" : ""} ·
            AP: {formatCurrency(totalAP)}
          </p>
        </div>
        <Link href="/purchases/bills/new" className={buttonVariants()}>
          <Plus className="h-4 w-4 mr-1.5" />
          New Bill
        </Link>
      </div>

      {bills.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-slate-200 rounded-xl">
          <Receipt className="h-10 w-10 text-slate-300 mb-3" />
          <p className="text-slate-500 font-medium mb-1">No bills yet</p>
          <p className="text-sm text-slate-400">Record vendor bills to track AP.</p>
        </div>
      ) : (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Number</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Vendor</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Date</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Due</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Status</th>
                <th className="text-right px-4 py-3 font-medium text-slate-500">Total</th>
                <th className="text-right px-4 py-3 font-medium text-slate-500">Balance</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bills.map((b) => {
                const balance = parseFloat(String(b.totalAmount)) - parseFloat(String(b.amountPaid));
                const isOverdue = new Date(b.dueDate) < new Date() && b.status !== "PAID";
                const statusKey = isOverdue ? "OVERDUE" : b.status;
                return (
                  <tr key={b.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={\`/purchases/bills/\${b.id}\`} className="font-mono text-xs text-blue-600 hover:underline">
                        {b.billNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">{b.vendor.companyName}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(b.billDate)}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(b.dueDate)}</td>
                    <td className="px-4 py-3">
                      <span className={\`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium \${statusColors[statusKey] || ""}\`}>
                        {statusKey}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{formatCurrency(parseFloat(String(b.totalAmount)))}</td>
                    <td className="px-4 py-3 text-right font-mono">
                      <span className={balance > 0 ? "text-red-600 font-semibold" : "text-slate-400"}>
                        {formatCurrency(balance)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={\`/purchases/bills/\${b.id}\`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-7 px-2 text-xs")}>
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

// ─── NEW BILL PAGE ─────────────────────────────────────────
w(`${B}/app/(dashboard)/purchases/bills/new/page.tsx`, `import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BillForm } from "./bill-form";

export default async function NewBillPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId!;

  const [vendors, items, accounts] = await Promise.all([
    prisma.vendor.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, companyName: true, vendorCode: true, paymentTerms: true },
      orderBy: { companyName: "asc" },
    }),
    prisma.item.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, itemCode: true, name: true, costPrice: true },
      orderBy: { name: "asc" },
    }),
    prisma.chartOfAccounts.findMany({
      where: { organizationId, isActive: true, type: { in: ["EXPENSE", "ASSET"] } },
      select: { id: true, code: true, name: true, type: true },
      orderBy: { code: "asc" },
    }),
  ]);

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900 mb-6">New Bill</h1>
      <BillForm
        vendors={vendors}
        items={items.map((i) => ({ ...i, costPrice: i.costPrice ? parseFloat(String(i.costPrice)) : null }))}
        accounts={accounts}
      />
    </div>
  );
}
`);

w(`${B}/app/(dashboard)/purchases/bills/new/bill-form.tsx`, `"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createBill } from "../actions";
import { formatCurrency } from "@/lib/utils";

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
  const [lines, setLines] = useState<LineItem[]>([
    { id: crypto.randomUUID(), itemId: "", description: "", quantity: 1, rate: 0, accountId: "" },
  ]);

  function handleVendorChange(id: string) {
    setVendorId(id);
    const v = vendors.find((v) => v.id === id);
    if (v) setDueDate(addDays(billDate, v.paymentTerms));
  }

  function handleItemSelect(lineId: string, itemId: string) {
    const item = items.find((i) => i.id === itemId);
    setLines((prev) =>
      prev.map((l) => l.id === lineId
        ? { ...l, itemId, description: item?.name || "", rate: item?.costPrice ?? 0 }
        : l
      )
    );
  }

  function updateLine(lineId: string, field: keyof LineItem, value: string | number) {
    setLines((prev) => prev.map((l) => l.id === lineId ? { ...l, [field]: value } : l));
  }

  const subtotal = lines.reduce((s, l) => s + l.quantity * l.rate, 0);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!vendorId) { setError("Please select a vendor"); return; }
    if (lines.some((l) => !l.accountId)) { setError("Each line must have an expense account"); return; }
    setLoading(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const result = await createBill({
      vendorId,
      vendorRef: String(fd.get("vendorRef") || ""),
      billDate,
      dueDate,
      notes: String(fd.get("notes") || ""),
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
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Bill Date</Label>
            <Input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Due Date</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Line items */}
      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
          <span className="font-medium text-sm text-slate-700">Line Items</span>
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
                  onChange={(e) => updateLine(line.id, "description", e.target.value)} placeholder="Description" />
              </div>
              <div className="col-span-1">
                {idx === 0 && <Label className="block mb-1.5 text-xs">Qty</Label>}
                <Input className="h-8 text-xs" type="number" min="0" step="0.01" value={line.quantity}
                  onChange={(e) => updateLine(line.id, "quantity", parseFloat(e.target.value) || 0)} />
              </div>
              <div className="col-span-2">
                {idx === 0 && <Label className="block mb-1.5 text-xs">Rate</Label>}
                <Input className="h-8 text-xs" type="number" min="0" step="0.01" value={line.rate}
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
        <div className="border-t border-slate-200 p-4 bg-slate-50 flex justify-end">
          <div className="flex gap-8 text-sm font-semibold">
            <span className="text-slate-700">Total</span>
            <span className="font-mono w-28 text-right">{formatCurrency(subtotal)}</span>
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes</Label>
        <Input id="notes" name="notes" />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-3">
        <Button type="submit" disabled={loading}>{loading ? "Creating…" : "Create Bill"}</Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
`);

// ─── BILL DETAIL PAGE ──────────────────────────────────────
w(`${B}/app/(dashboard)/purchases/bills/[id]/page.tsx`, `import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
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

  const balance = parseFloat(String(bill.totalAmount)) - parseFloat(String(bill.amountPaid));
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
          </div>
        </div>

        <table className="w-full text-sm mb-4">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left py-2 font-medium text-slate-500">Description</th>
              <th className="text-right py-2 font-medium text-slate-500">Qty</th>
              <th className="text-right py-2 font-medium text-slate-500">Rate</th>
              <th className="text-right py-2 font-medium text-slate-500">Amount</th>
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
                <td className="py-2.5 text-right font-mono">{formatCurrency(parseFloat(String(line.rate)))}</td>
                <td className="py-2.5 text-right font-mono font-medium">{formatCurrency(parseFloat(String(line.amount)))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end">
          <div className="w-52 space-y-1.5 text-sm">
            <div className="flex justify-between pt-2 border-t border-slate-200 font-semibold">
              <span>Total</span>
              <span className="font-mono">{formatCurrency(parseFloat(String(bill.totalAmount)))}</span>
            </div>
            {parseFloat(String(bill.amountPaid)) > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Paid</span>
                <span className="font-mono">-{formatCurrency(parseFloat(String(bill.amountPaid)))}</span>
              </div>
            )}
            <div className="flex justify-between pt-1 text-lg font-bold">
              <span>Balance</span>
              <span className={\`font-mono \${balance > 0 ? "text-red-600" : "text-green-600"}\`}>{formatCurrency(balance)}</span>
            </div>
          </div>
        </div>

        {bill.notes && (
          <div className="mt-6 pt-4 border-t border-slate-200">
            <p className="text-xs text-slate-500 mb-1">Notes</p>
            <p className="text-sm text-slate-700">{bill.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}
`);

w(`${B}/app/(dashboard)/purchases/bills/[id]/bill-actions.tsx`, `"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CreditCard } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { recordBillPayment } from "../actions";
import { formatCurrency } from "@/lib/utils";

interface OpenBill { id: string; billNumber: string; balance: number; }
interface Props {
  bill: { id: string; status: string; vendorId: string; balance: number; isWhtEligible: boolean; };
  openBills: OpenBill[];
}

interface Allocation { billId: string; billNumber: string; maxAmount: number; amount: number; }

export function BillActions({ bill, openBills }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split("T")[0]);
  const [amount, setAmount] = useState(bill.balance);
  const [whtAmount, setWhtAmount] = useState(0);
  const [allocations, setAllocations] = useState<Allocation[]>(() =>
    openBills.map((b) => ({
      billId: b.id,
      billNumber: b.billNumber,
      maxAmount: b.balance,
      amount: b.id === bill.id ? Math.min(bill.balance, b.balance) : 0,
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

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (Math.abs(totalAllocated - amount) > 0.01) {
      toast.error(\`Allocated \${formatCurrency(totalAllocated)} ≠ payment \${formatCurrency(amount)}\`);
      return;
    }
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    const result = await recordBillPayment({
      vendorId: bill.vendorId,
      paymentDate,
      amount,
      method,
      reference: String(fd.get("reference") || ""),
      whtAmount,
      billAllocations: allocations.filter((a) => a.amount > 0).map((a) => ({ billId: a.billId, amount: a.amount })),
    });
    setLoading(false);
    if (result?.error) { toast.error(result.error); return; }
    toast.success("Payment recorded");
    setOpen(false);
    router.refresh();
  }

  const canPay = bill.balance > 0;

  return (
    <>
      {canPay && (
        <Button size="sm" onClick={() => setOpen(true)}>
          <CreditCard className="h-3.5 w-3.5 mr-1.5" />
          Record Payment
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Record Vendor Payment</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Payment Date</Label>
                <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label>Amount</Label>
                <Input type="number" min="0.01" step="0.01" value={amount}
                  onChange={(e) => { const v = parseFloat(e.target.value) || 0; setAmount(v); autoAllocate(v); }} required />
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
                <Input id="reference" name="reference" />
              </div>
            </div>
            {bill.isWhtEligible && (
              <div className="space-y-1.5">
                <Label>WHT Amount (deducted from payment)</Label>
                <Input type="number" min="0" step="0.01" value={whtAmount}
                  onChange={(e) => setWhtAmount(parseFloat(e.target.value) || 0)} />
                {whtAmount > 0 && (
                  <p className="text-xs text-slate-500">Net payment to vendor: {formatCurrency(amount - whtAmount)}</p>
                )}
              </div>
            )}

            {openBills.length > 1 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Allocate to Bills</Label>
                  <Button type="button" variant="ghost" size="sm" className="h-6 text-xs" onClick={() => autoAllocate(amount)}>
                    Auto-allocate
                  </Button>
                </div>
                <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                  {allocations.map((alloc) => (
                    <div key={alloc.billId} className="flex items-center gap-3 px-3 py-2">
                      <span className="font-mono text-xs text-slate-600 w-24">{alloc.billNumber}</span>
                      <span className="text-xs text-slate-400 flex-1">max {formatCurrency(alloc.maxAmount)}</span>
                      <Input type="number" min="0" max={alloc.maxAmount} step="0.01" value={alloc.amount}
                        onChange={(e) => setAllocations((prev) =>
                          prev.map((a) => a.billId === alloc.billId ? { ...a, amount: parseFloat(e.target.value) || 0 } : a)
                        )}
                        className="h-7 w-28 text-xs text-right" />
                    </div>
                  ))}
                </div>
                <div className={\`text-xs text-right \${Math.abs(totalAllocated - amount) > 0.01 ? "text-red-500" : "text-green-600"}\`}>
                  Allocated: {formatCurrency(totalAllocated)} / {formatCurrency(amount)}
                </div>
              </div>
            )}

            <DialogFooter className="pt-2">
              <DialogClose asChild>
                <Button type="button" variant="outline">Cancel</Button>
              </DialogClose>
              <Button type="submit" disabled={loading}>{loading ? "Saving…" : "Record Payment"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
`);

// ─── VENDOR PAYMENTS LIST ──────────────────────────────────
w(`${B}/app/(dashboard)/purchases/payments/page.tsx`, `import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DollarSign } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";

export default async function VendorPaymentsPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId!;

  const payments = await prisma.vendorPayment.findMany({
    where: { organizationId },
    include: {
      vendor: { select: { companyName: true } },
    },
    orderBy: { paymentDate: "desc" },
  });

  const totalPaid = payments.reduce((s, p) => s + parseFloat(String(p.amount)), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Vendor Payments</h1>
        <p className="text-sm text-slate-500 mt-1">
          {payments.length} payment{payments.length !== 1 ? "s" : ""} · Total: {formatCurrency(totalPaid)}
        </p>
      </div>

      {payments.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-slate-200 rounded-xl">
          <DollarSign className="h-10 w-10 text-slate-300 mb-3" />
          <p className="text-slate-500 font-medium mb-1">No vendor payments yet</p>
          <p className="text-sm text-slate-400">Record payments from the bill detail page.</p>
        </div>
      ) : (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Reference</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Vendor</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Date</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Method</th>
                <th className="text-right px-4 py-3 font-medium text-slate-500">Amount</th>
                <th className="text-right px-4 py-3 font-medium text-slate-500">WHT</th>
                <th className="text-right px-4 py-3 font-medium text-slate-500">Net Paid</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payments.map((p) => {
                const wht = parseFloat(String(p.whtAmount));
                const net = parseFloat(String(p.amount)) - wht;
                return (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-blue-600">{p.paymentNumber}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{p.vendor.companyName}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(p.paymentDate)}</td>
                    <td className="px-4 py-3 text-slate-500">{p.method.replace("_", " ")}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatCurrency(parseFloat(String(p.amount)))}</td>
                    <td className="px-4 py-3 text-right font-mono text-amber-600">{wht > 0 ? formatCurrency(wht) : "—"}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-red-600">{formatCurrency(net)}</td>
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

console.log('\n✅ Bills + Vendor Payments done');
