"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { closePeriod, reopenPeriod, yearEndClose, ensurePeriodsExist } from "./actions";
import { toast } from "sonner";

interface EquityAccount { id: string; code: string; name: string; }

interface Props {
  period: string;
  isClosed: boolean;
  hasDrafts: boolean;
  isYearEnd?: boolean;
  equityAccounts?: EquityAccount[];
}

export function PeriodCloseActions({ period, isClosed, hasDrafts, isYearEnd, equityAccounts = [] }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showYearEnd, setShowYearEnd] = useState(false);
  const [retainedId, setRetainedId] = useState("");

  function handleClose() {
    if (!confirm("Close period " + period + "? This will lock all entries.")) return;
    startTransition(async () => {
      // Ensure period exists in DB first
      await ensurePeriodsExist(parseInt(period.slice(0, 4)));
      const result = await closePeriod(period);
      if ("error" in result) { toast.error(result.error); return; }
      toast.success("Period " + period + " closed");
      router.refresh();
    });
  }

  function handleReopen() {
    if (!confirm("Reopen period " + period + "? Entries can be modified again.")) return;
    startTransition(async () => {
      const result = await reopenPeriod(period);
      if ("error" in result) { toast.error(result.error); return; }
      toast.success("Period " + period + " reopened");
      router.refresh();
    });
  }

  function handleYearEnd() {
    if (!retainedId) { toast.error("Select Retained Earnings account"); return; }
    startTransition(async () => {
      const result = await yearEndClose(parseInt(period), retainedId);
      if ("error" in result) { toast.error(result.error); return; }
      toast.success("Year-end close complete. Net transferred: " + (result as { netToRetained: number }).netToRetained?.toFixed(2));
      setShowYearEnd(false);
      router.refresh();
    });
  }

  if (isYearEnd) {
    return (
      <>
        <Button type="button" onClick={() => setShowYearEnd(true)} disabled={isPending}>
          Run Year-End Close
        </Button>
        <Dialog open={showYearEnd} onOpenChange={setShowYearEnd}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Year-End Close {period}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">
                All income and expense account balances will be zeroed and transferred to the
                selected Retained Earnings account.
              </p>
              <div className="space-y-1">
                <Label>Retained Earnings Account *</Label>
                <Select value={retainedId} onValueChange={(v) => setRetainedId(v ?? "")}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select equity account" />
                  </SelectTrigger>
                  <SelectContent>
                    {equityAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.code} — {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <DialogClose render={<Button variant="outline" type="button" />}>
                Cancel
              </DialogClose>
              <Button type="button" onClick={handleYearEnd} disabled={isPending || !retainedId}>
                {isPending ? "Processing..." : "Confirm Year-End Close"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  if (isClosed) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={handleReopen} disabled={isPending}>
        Reopen
      </Button>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      onClick={handleClose}
      disabled={isPending || hasDrafts}
      title={hasDrafts ? "Post or delete draft entries first" : undefined}
    >
      {isPending ? "Closing..." : "Close Period"}
    </Button>
  );
}
