"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { postJournalEntry, reverseJournalEntry } from "../actions";
import { toast } from "sonner";

interface Props {
  entryId: string;
  isLocked: boolean;
  isReversed: boolean;
  source: string;
}

export function JournalActions({ entryId, isLocked, isReversed, source }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showReverseDialog, setShowReverseDialog] = useState(false);
  const [reason, setReason] = useState("");

  function handlePost() {
    startTransition(async () => {
      const result = await postJournalEntry(entryId);
      if ("error" in result) { toast.error(result.error); return; }
      toast.success("Entry posted");
      router.refresh();
    });
  }

  function handleReverse() {
    if (!reason.trim()) { toast.error("Reversal reason required"); return; }
    startTransition(async () => {
      const result = await reverseJournalEntry(entryId, reason);
      if ("error" in result) { toast.error(result.error); return; }
      toast.success("Reversal entry created");
      setShowReverseDialog(false);
      router.refresh();
    });
  }

  return (
    <>
      {!isLocked && source === "manual" && (
        <Button type="button" onClick={handlePost} disabled={isPending}>
          {isPending ? "Posting..." : "Post"}
        </Button>
      )}
      {isLocked && !isReversed && (
        <Button
          type="button"
          variant="outline"
          onClick={() => setShowReverseDialog(true)}
          disabled={isPending}
        >
          Reverse
        </Button>
      )}

      <Dialog open={showReverseDialog} onOpenChange={setShowReverseDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reverse Journal Entry</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              A reversing entry will be created with all debits and credits swapped, posted to today&apos;s period.
            </p>
            <div className="space-y-1">
              <Label>Reason for reversal *</Label>
              <Input
                placeholder="e.g. Incorrect account coding"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <DialogClose render={<Button variant="outline" type="button" />}>
              Cancel
            </DialogClose>
            <Button type="button" onClick={handleReverse} disabled={isPending || !reason.trim()}>
              {isPending ? "Reversing..." : "Create Reversal"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
