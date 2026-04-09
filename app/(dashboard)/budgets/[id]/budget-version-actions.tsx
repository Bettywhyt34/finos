"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  submitBudget, approveBudget, rejectBudget, lockBudget, createRevision,
} from "../actions";
import { toast } from "sonner";

interface Props {
  budget: { id: string; status: string };
  version: { id: string; status: string; versionNumber: number };
  approval: { id: string; status: string } | null;
}

export function BudgetVersionActions({ budget, version, approval }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showApprove, setShowApprove] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [showRevise, setShowRevise] = useState(false);
  const [comments, setComments] = useState("");
  const [reviseLabel, setReviseLabel] = useState("Revised");

  function act(fn: () => Promise<{ error?: string; success?: boolean }>, successMsg: string) {
    startTransition(async () => {
      const result = await fn();
      if ("error" in result && result.error) { toast.error(result.error); return; }
      toast.success(successMsg);
      setShowApprove(false); setShowReject(false); setShowRevise(false);
      router.refresh();
    });
  }

  const { status } = budget;
  const vStatus = version.status;

  return (
    <div className="flex gap-2">
      {vStatus === "DRAFT" && (
        <Button type="button" onClick={() => act(() => submitBudget(budget.id, version.id), "Budget submitted for approval")}>
          Submit for Approval
        </Button>
      )}
      {vStatus === "SUBMITTED" && approval?.status === "PENDING" && (
        <>
          <Button type="button" variant="outline" onClick={() => setShowReject(true)} disabled={isPending}>
            Reject
          </Button>
          <Button type="button" onClick={() => setShowApprove(true)} disabled={isPending}>
            Approve
          </Button>
        </>
      )}
      {vStatus === "APPROVED" && (
        <Button type="button" variant="outline"
          onClick={() => act(() => lockBudget(budget.id, version.id), "Budget locked")}>
          Lock Budget
        </Button>
      )}
      {(vStatus === "APPROVED" || vStatus === "LOCKED") && (
        <Button type="button" variant="outline" onClick={() => setShowRevise(true)}>
          Create Revision
        </Button>
      )}

      {/* Approve dialog */}
      <Dialog open={showApprove} onOpenChange={setShowApprove}>
        <DialogContent>
          <DialogHeader><DialogTitle>Approve Budget</DialogTitle></DialogHeader>
          <div className="space-y-2 py-1">
            <Label>Comments (optional)</Label>
            <Input placeholder="Approval comments" value={comments} onChange={(e) => setComments(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
            <Button type="button" disabled={isPending}
              onClick={() => act(() => approveBudget(budget.id, version.id, approval!.id, comments), "Budget approved")}>
              Approve
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={showReject} onOpenChange={setShowReject}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject Budget</DialogTitle></DialogHeader>
          <div className="space-y-2 py-1">
            <Label>Reason for rejection *</Label>
            <Input placeholder="Required" value={comments} onChange={(e) => setComments(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
            <Button type="button" variant="destructive" disabled={isPending || !comments.trim()}
              onClick={() => act(() => rejectBudget(budget.id, approval!.id, comments), "Budget rejected")}>
              Reject
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Revision dialog */}
      <Dialog open={showRevise} onOpenChange={setShowRevise}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Budget Revision</DialogTitle></DialogHeader>
          <div className="space-y-2 py-1">
            <p className="text-sm text-muted-foreground">
              Creates a new draft version (v{version.versionNumber + 1}) copied from the current version.
            </p>
            <Label>Version Label</Label>
            <Input placeholder="e.g. Revised Q2, Forecast" value={reviseLabel} onChange={(e) => setReviseLabel(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
            <Button type="button" disabled={isPending || !reviseLabel.trim()}
              onClick={() => act(() => createRevision(budget.id, version.id, reviseLabel), "Revision created")}>
              Create Revision
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
