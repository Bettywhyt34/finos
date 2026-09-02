"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";
import { applyInvoiceCreditNote } from "./actions";

export interface CreditEligibleInvoice {
  id: string;
  invoiceNumber: string;
  customerName: string;
  currency: string;
  balanceDue: number;
  creditableRemaining: number;
}

export function CreditNoteForm({ invoices }: { invoices: CreditEligibleInvoice[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [invoiceId, setInvoiceId] = useState(invoices[0]?.id ?? "");
  const [amount, setAmount] = useState(invoices[0]?.creditableRemaining ?? 0);
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  const selected = useMemo(() => invoices.find((invoice) => invoice.id === invoiceId) ?? null, [invoiceId, invoices]);
  const arReduction = selected ? Math.min(Math.max(amount, 0), selected.balanceDue) : 0;
  const customerCredit = selected ? Math.max(0, amount - arReduction) : 0;

  function selectInvoice(id: string) {
    setInvoiceId(id);
    const invoice = invoices.find((item) => item.id === id);
    if (invoice) setAmount(invoice.creditableRemaining);
  }

  function submit() {
    if (!invoiceId || !selected) return toast.error("Select an invoice");
    if (amount <= 0 || amount - selected.creditableRemaining > 0.01) {
      return toast.error(`Credit must be between 0.01 and ${formatCurrency(selected.creditableRemaining, selected.currency)}`);
    }
    if (!reason.trim()) return toast.error("Enter a reason for the credit note");

    startTransition(async () => {
      const result = await applyInvoiceCreditNote({ invoiceId, amount, issueDate, reason });
      if ("error" in result) return toast.error(result.error);
      toast.success(customerCredit > 0 ? "Credit note applied and customer credit created" : "Credit note applied");
      setOpen(false);
      setReason("");
      router.refresh();
    });
  }

  return (
    <>
      <Button type="button" disabled={!invoices.length} onClick={() => setOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> New credit note</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>New credit note</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Invoice</Label>
              <Select value={invoiceId} onValueChange={(value) => value && selectInvoice(value)}>
                <SelectTrigger><SelectValue placeholder="Select invoice" /></SelectTrigger>
                <SelectContent>
                  {invoices.map((invoice) => (
                    <SelectItem key={invoice.id} value={invoice.id}>
                      {invoice.invoiceNumber} · {invoice.customerName} · {formatCurrency(invoice.creditableRemaining, invoice.currency)} creditable
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label>Credit date</Label><Input type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} required /></div>
              <div className="space-y-1.5"><Label>Credit amount {selected ? `(${selected.currency})` : ""}</Label><Input type="number" min="0.01" max={selected?.creditableRemaining} step="0.01" value={amount} onChange={(event) => setAmount(Number(event.target.value) || 0)} required /></div>
            </div>
            {selected ? (
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-[var(--app-border)] bg-[var(--surface-muted)] p-3 text-xs">
                <div><p className="text-[var(--text-secondary)]">Reduces Accounts Receivable</p><p className="mt-1 font-financial font-semibold text-[var(--text-primary)]">{formatCurrency(arReduction, selected.currency)}</p></div>
                <div><p className="text-[var(--text-secondary)]">Creates customer credit</p><p className="mt-1 font-financial font-semibold text-[var(--text-primary)]">{formatCurrency(customerCredit, selected.currency)}</p></div>
                <div className="col-span-2 text-[var(--text-secondary)]">Outstanding AR is {formatCurrency(selected.balanceDue, selected.currency)}. The invoice still has {formatCurrency(selected.creditableRemaining, selected.currency)} of value not already credited.</div>
              </div>
            ) : null}
            <div className="space-y-1.5"><Label>Reason *</Label><Input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} placeholder="e.g. Pricing adjustment, service shortfall, billing correction" /></div>
            <p className="text-xs leading-5 text-[var(--text-secondary)]">FINOS reverses the relevant service/revenue and VAT accounting. Any credit above open AR becomes a customer-credit liability; it is not recorded as a payment.</p>
          </div>
          <DialogFooter><DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose><Button type="button" disabled={pending || !invoiceId || amount <= 0 || !reason.trim()} onClick={submit}>{pending ? "Applying…" : "Apply credit note"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
