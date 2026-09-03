"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { reverseVendorPayment } from "../bills/vendor-payment-reverse-actions";

export function VendorPaymentActions({ paymentId, status }: { paymentId: string; status: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState("");
  const [reversalDate, setReversalDate] = useState(new Date().toISOString().split("T")[0]);

  if (status !== "POSTED") return <span className="text-xs text-slate-400">—</span>;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!reason.trim()) {
      toast.error("Enter a reversal reason");
      return;
    }
    setLoading(true);
    const result = await reverseVendorPayment({ paymentId, reason, reversalDate });
    setLoading(false);
    if (result?.error) {
      toast.error(result.error);
      return;
    }
    toast.success("Vendor payment reversed");
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setOpen(true)}>
        <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reverse
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Reverse Vendor Payment</DialogTitle></DialogHeader>
          <form onSubmit={submit} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Reversal Date</Label>
              <Input type="date" value={reversalDate} onChange={(event) => setReversalDate(event.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>Reason *</Label>
              <Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is this payment being reversed?" required />
            </div>
            <p className="text-xs text-slate-500">FINOS will preserve the original payment and allocations, post an exact reversal journal, and reopen the affected bill balances. Later dependent payments or FX revaluations must be reversed first.</p>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
              <Button type="submit" variant="destructive" disabled={loading}>{loading ? "Reversing…" : "Reverse Payment"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
