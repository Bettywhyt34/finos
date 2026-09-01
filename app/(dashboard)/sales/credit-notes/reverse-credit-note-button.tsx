"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { reverseCreditNote } from "./reverse-actions";

export function ReverseCreditNoteButton({ creditNoteId, creditNumber }: { creditNoteId: string; creditNumber: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [reversalDate, setReversalDate] = useState(new Date().toISOString().slice(0, 10));
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!reason.trim()) {
      toast.error("Enter a reversal reason");
      return;
    }
    startTransition(async () => {
      const result = await reverseCreditNote({ creditNoteId, reversalDate, reason });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`${creditNumber} reversed`);
      setOpen(false);
      setReason("");
      router.refresh();
    });
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reverse
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Reverse {creditNumber}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Reversal date</Label>
              <Input type="date" value={reversalDate} onChange={(event) => setReversalDate(event.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>Reason *</Label>
              <Input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} placeholder="e.g. Credit issued in error" />
            </div>
            <p className="rounded-lg border border-[var(--app-border)] bg-[var(--surface-muted)] px-3 py-2 text-xs leading-5 text-[var(--text-secondary)]">
              FINOS will restore the invoice AR balance and post an exact reversal journal. The original credit note remains in the register as audit history.
            </p>
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="button" variant="destructive" disabled={pending || !reason.trim() || !reversalDate} onClick={submit}>
              {pending ? "Reversing…" : "Reverse credit note"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
