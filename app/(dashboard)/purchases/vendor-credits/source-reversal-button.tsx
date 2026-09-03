"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { reverseSourceVendorCredit } from "./source-reverse-action";

export function SourceVendorCreditReversalButton({ creditId, creditNumber }: { creditId: string; creditNumber: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");

  function reverse() {
    if (!reason.trim()) return toast.error("Enter a reversal reason");
    startTransition(async () => {
      const result = await reverseSourceVendorCredit({ vendorCreditId: creditId, reason, reversalDate: date });
      if ("error" in result) return toast.error(result.error);
      toast.success(`${creditNumber} reversed`);
      setOpen(false);
      router.refresh();
    });
  }

  return <>
    <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Reverse credit</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Reverse {creditNumber}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="rounded-md bg-amber-50 p-3 text-xs text-amber-800">FINOS will preserve the original Vendor Credit, post an exact inverse journal, and restore the source Bill. Any later applications, refunds, or dependent FX revaluations must be reversed first.</div>
          <div className="space-y-1.5"><Label>Reversal date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Reason</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this Vendor Credit being reversed?" /></div>
        </div>
        <DialogFooter><DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose><Button type="button" disabled={pending} onClick={reverse}>{pending ? "Reversing…" : "Reverse Vendor Credit"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
