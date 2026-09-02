"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleDollarSign } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/utils";
import { getStandaloneInvoiceDeferredState, recogniseStandaloneInvoiceRevenue } from "../revenue-actions";

export function RecogniseRevenueButton({ invoiceId, currency }: { invoiceId: string; currency: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [amount, setAmount] = useState(0);
  const [recogniseFullBalance, setRecogniseFullBalance] = useState(true);
  const [recognitionDate, setRecognitionDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");

  async function prepare() {
    setLoading(true);
    const state = await getStandaloneInvoiceDeferredState(invoiceId);
    setLoading(false);
    if (!state.eligible || state.remaining <= 0) {
      toast.info(state.reason ?? "There is no deferred revenue left to recognise.");
      return;
    }
    setRemaining(state.remaining);
    setAmount(state.remaining);
    setRecogniseFullBalance(true);
    setOpen(true);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const amountToRecognise = recogniseFullBalance ? remaining : amount;
    if (!Number.isFinite(amountToRecognise) || amountToRecognise <= 0 || amountToRecognise - remaining > 0.01) {
      toast.error(`Enter an amount between 0.01 and ${formatCurrency(remaining, currency)}`);
      return;
    }
    setLoading(true);
    const result = await recogniseStandaloneInvoiceRevenue({
      invoiceId,
      amount: amountToRecognise,
      recognitionDate,
      note,
    });
    setLoading(false);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success(`Revenue recognised: ${formatCurrency(result.amount, currency)}`);
    setOpen(false);
    setNote("");
    router.refresh();
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" disabled={loading} onClick={prepare}>
        <CircleDollarSign className="mr-1.5 h-3.5 w-3.5" />
        {loading && !open ? "Checking…" : "Recognise Revenue"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Recognise revenue</DialogTitle></DialogHeader>
          <form onSubmit={submit} className="space-y-4 py-2">
            <div className="rounded-lg border border-[var(--app-border)] bg-[var(--surface-muted)] px-3 py-2 text-xs leading-5 text-[var(--text-secondary)]">
              Remaining unearned service value: <span className="font-semibold text-[var(--text-primary)]">{formatCurrency(remaining, currency)}</span>. This moves value from Unearned Revenue to Revenue. It does not change the invoice, VAT, Accounts Receivable, or cash.
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--app-border)] p-3">
              <Checkbox
                checked={recogniseFullBalance}
                onCheckedChange={(checked) => {
                  const full = checked === true;
                  setRecogniseFullBalance(full);
                  if (full) setAmount(remaining);
                }}
              />
              <span>
                <span className="block text-sm font-medium text-[var(--text-primary)]">Recognise full available balance</span>
                <span className="mt-0.5 block text-xs text-[var(--text-secondary)]">When selected, FINOS recognises the entire remaining deferred amount and locks the amount field.</span>
              </span>
            </label>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Revenue earned</Label>
                <Input
                  type="number"
                  min="0.01"
                  max={remaining}
                  step="0.01"
                  value={recogniseFullBalance ? remaining : amount}
                  readOnly={recogniseFullBalance}
                  onChange={(event) => setAmount(Number(event.target.value) || 0)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Recognition date</Label>
                <Input type="date" value={recognitionDate} onChange={(event) => setRecognitionDate(event.target.value)} required />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Note</Label>
              <Input value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} placeholder="e.g. Campaign delivered in full" />
            </div>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
              <Button type="submit" disabled={loading || (recogniseFullBalance ? remaining <= 0 : amount <= 0)}>{loading ? "Posting…" : "Recognise revenue"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
