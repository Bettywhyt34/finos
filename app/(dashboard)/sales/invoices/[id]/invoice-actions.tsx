"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send, CreditCard, Ban, Pencil, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { sendInvoice, updateInvoice } from "../actions";
import { recordCustomerPayment } from "../payment-actions";
import { voidInvoiceSafely } from "../void-actions";
import { formatCurrency } from "@/lib/utils";

interface OpenInvoice { id: string; invoiceNumber: string; balanceDue: number; dueDate: Date; }
interface BankAccount { id: string; accountName: string; bankName: string; }

interface Props {
  invoice: {
    id: string;
    status: string;
    customerId: string;
    balanceDue: number;
    notes: string | null;
    reference: string | null;
    dueDate: Date;
  };
  openInvoices: OpenInvoice[];
  bankAccounts: BankAccount[];
}

interface Allocation { invoiceId: string; invoiceNumber: string; maxAmount: number; amount: number; }

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function InvoiceActions({ invoice, openInvoices, bankAccounts }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const [sentOpen, setSentOpen] = useState(false);
  const [sentDate, setSentDate] = useState(new Date().toISOString().split("T")[0]);

  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [convertToDraft, setConvertToDraft] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editNotes, setEditNotes] = useState(invoice.notes ?? "");
  const [editReference, setEditReference] = useState(invoice.reference ?? "");
  const [editDueDate, setEditDueDate] = useState(
    invoice.dueDate instanceof Date
      ? invoice.dueDate.toISOString().split("T")[0]
      : String(invoice.dueDate).split("T")[0]
  );

  const [payOpen, setPayOpen] = useState(false);
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split("T")[0]);
  const [grossAmount, setGrossAmount] = useState(invoice.balanceDue);
  const [whtAmount, setWhtAmount] = useState(0);
  const [allocations, setAllocations] = useState<Allocation[]>(() =>
    openInvoices.map((i) => ({
      invoiceId: i.id,
      invoiceNumber: i.invoiceNumber,
      maxAmount: i.balanceDue,
      amount: i.id === invoice.id ? Math.min(invoice.balanceDue, i.balanceDue) : 0,
    }))
  );

  const cashAmount = roundMoney(Math.max(0, grossAmount - whtAmount));
  const totalAllocated = roundMoney(allocations.reduce((s, a) => s + a.amount, 0));

  function autoAllocate(total: number) {
    let remaining = total;
    setAllocations((prev) =>
      prev.map((a) => {
        const allocated = Math.min(remaining, a.maxAmount);
        remaining = Math.max(0, remaining - allocated);
        return { ...a, amount: roundMoney(allocated) };
      })
    );
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const result = await sendInvoice(invoice.id, sentDate);
    setLoading(false);
    if ("error" in result) { toast.error(result.error); return; }
    toast.success("Invoice marked as sent");
    setSentOpen(false);
    router.refresh();
  }

  async function handleVoid(e: React.FormEvent) {
    e.preventDefault();
    if (!voidReason.trim()) { toast.error("Please provide a void reason"); return; }
    setLoading(true);
    const result = await voidInvoiceSafely(invoice.id, voidReason, convertToDraft);
    setLoading(false);
    if (result?.error) { toast.error(result.error); return; }
    toast.success(convertToDraft ? "Invoice voided and draft created" : "Invoice voided");
    setVoidOpen(false);
    if (result.newInvoiceId) {
      router.push(`/sales/invoices/${result.newInvoiceId}`);
    } else {
      router.push("/sales/invoices");
    }
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const result = await updateInvoice(invoice.id, {
      notes: editNotes,
      reference: editReference,
      dueDate: editDueDate,
    });
    setLoading(false);
    if (result?.error) { toast.error(result.error); return; }
    toast.success("Invoice updated");
    setEditOpen(false);
    router.refresh();
  }

  async function handlePayment(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (grossAmount <= 0) {
      toast.error("Gross AR settled must be greater than zero");
      return;
    }
    if (whtAmount < 0 || whtAmount - grossAmount > 0.01) {
      toast.error("WHT withheld cannot exceed the gross amount settled");
      return;
    }
    if (Math.abs(totalAllocated - grossAmount) > 0.01) {
      toast.error(`Allocated ${formatCurrency(totalAllocated)} ≠ gross settled ${formatCurrency(grossAmount)}`);
      return;
    }
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    const result = await recordCustomerPayment({
      customerId: invoice.customerId,
      paymentDate,
      amount: cashAmount,
      whtAmount,
      method,
      reference: String(fd.get("reference") || ""),
      notes: String(fd.get("notes") || ""),
      invoiceAllocations: allocations.filter((a) => a.amount > 0).map((a) => ({ invoiceId: a.invoiceId, amount: a.amount })),
    });
    setLoading(false);
    if (result?.error) { toast.error(result.error); return; }
    toast.success("Receipt recorded");
    setPayOpen(false);
    router.refresh();
  }

  const isDraft       = invoice.status === "DRAFT";
  const canSend       = ["DRAFT", "PARTIAL", "OVERDUE"].includes(invoice.status);
  const canPay        = invoice.balanceDue > 0 && !["DRAFT", "VOIDED", "PAID"].includes(invoice.status);
  const canVoid       = !["VOIDED", "PAID"].includes(invoice.status);
  const canFullEdit   = isDraft;
  const canLimitedEdit = !isDraft && invoice.status !== "VOIDED";

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => window.open(`/sales/invoices/${invoice.id}/print`, "_blank")}
      >
        <Printer className="h-3.5 w-3.5 mr-1.5" />
        Print / Save as PDF
      </Button>
      {canFullEdit && (
        <Button variant="outline" size="sm" onClick={() => router.push(`/sales/invoices/${invoice.id}/edit`)}>
          <Pencil className="h-3.5 w-3.5 mr-1.5" />
          Edit Draft
        </Button>
      )}
      {canLimitedEdit && (
        <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
          <Pencil className="h-3.5 w-3.5 mr-1.5" />
          Edit
        </Button>
      )}
      {canSend && (
        <Button variant="outline" size="sm" onClick={() => setSentOpen(true)} disabled={loading}>
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
      {canVoid && (
        <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700 border-red-200 hover:border-red-300" onClick={() => setVoidOpen(true)}>
          <Ban className="h-3.5 w-3.5 mr-1.5" />
          Void
        </Button>
      )}

      <Dialog open={sentOpen} onOpenChange={setSentOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Mark as Sent</DialogTitle></DialogHeader>
          <form onSubmit={handleSend} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Date Sent</Label>
              <Input type="date" value={sentDate} onChange={(e) => setSentDate(e.target.value)} required />
              <p className="text-xs text-slate-500">This date will appear on the invoice PDF and is used for AR aging calculations.</p>
            </div>
            <DialogFooter className="pt-2">
              <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
              <Button type="submit" disabled={loading}>{loading ? "Saving…" : "Mark as Sent"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Edit Invoice</DialogTitle></DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Reference</Label>
              <Input value={editReference} onChange={(e) => setEditReference(e.target.value)} placeholder="PO / reference number" />
            </div>
            <div className="space-y-1.5">
              <Label>Due Date</Label>
              <Input type="date" value={editDueDate} onChange={(e) => setEditDueDate(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="Notes to customer" />
            </div>
            <DialogFooter className="pt-2">
              <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
              <Button type="submit" disabled={loading}>{loading ? "Saving…" : "Save Changes"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Void Invoice</DialogTitle></DialogHeader>
          <form onSubmit={handleVoid} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Reason for voiding *</Label>
              <Input
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="e.g. Issued in error, duplicate invoice"
                required
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={convertToDraft}
                onChange={(e) => setConvertToDraft(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              <span className="text-sm text-slate-700">Convert to draft for editing</span>
            </label>
            <p className="text-xs text-slate-500 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              This will reverse the journal entries for this invoice. This action cannot be undone.
            </p>
            <DialogFooter className="pt-2">
              <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
              <Button type="submit" variant="destructive" disabled={loading || !voidReason.trim()}>
                {loading ? "Voiding…" : "Void Invoice"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
                <Label>Gross AR Settled</Label>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={grossAmount}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value) || 0;
                    setGrossAmount(v);
                    autoAllocate(v);
                  }}
                  required
                />
                <p className="text-xs text-slate-500">Invoice balance cleared before customer WHT.</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>WHT Withheld by Customer</Label>
                <Input
                  type="number"
                  min="0"
                  max={grossAmount}
                  step="0.01"
                  value={whtAmount}
                  onChange={(e) => setWhtAmount(parseFloat(e.target.value) || 0)}
                />
                <p className="text-xs text-slate-500">Recognised as a recoverable tax credit.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Cash Received</Label>
                <div className="flex h-10 items-center rounded-md border border-slate-200 bg-slate-50 px-3 font-mono text-sm font-semibold text-slate-900">
                  {formatCurrency(cashAmount)}
                </div>
                <p className="text-xs text-slate-500">Gross settled less WHT withheld.</p>
              </div>
            </div>

            {whtAmount > 0 && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                Accounting: Dr Bank {formatCurrency(cashAmount)} + Dr WHT Receivable {formatCurrency(whtAmount)} / Cr Accounts Receivable {formatCurrency(grossAmount)}.
              </div>
            )}

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

            {openInvoices.length > 1 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Allocate Gross Settlement to Invoices</Label>
                  <Button type="button" variant="ghost" size="sm" className="h-6 text-xs" onClick={() => autoAllocate(grossAmount)}>
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
                <div className={`text-xs text-right ${Math.abs(totalAllocated - grossAmount) > 0.01 ? "text-red-500" : "text-green-600"}`}>
                  Allocated: {formatCurrency(totalAllocated)} / {formatCurrency(grossAmount)}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Input id="notes" name="notes" />
            </div>

            <DialogFooter className="pt-2">
              <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
              <Button type="submit" disabled={loading || grossAmount <= 0 || whtAmount > grossAmount}>
                {loading ? "Saving…" : "Record Receipt"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
