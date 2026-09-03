"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/utils";
import { recognisePrepaidCost, reversePrepaidCostRecognition } from "./cost-recognition-actions";

export interface PrepaidLineView {
  id: string;
  description: string;
  currency: string;
  totalAmount: number;
  recognisedAmount: number;
  remainingAmount: number;
}

export interface CostRecognitionView {
  id: string;
  billLineId: string;
  recognitionDate: string;
  amount: number;
  status: string;
}

function RecognitionButton({ line }: { line: PrepaidLineView }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [full, setFull] = useState(true);
  const [amount, setAmount] = useState(line.remainingAmount);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  function submit() {
    const value = full ? line.remainingAmount : amount;
    if (value <= 0 || value - line.remainingAmount > 0.01) return toast.error("Enter an amount within the remaining prepaid balance.");
    startTransition(async () => {
      const result = await recognisePrepaidCost({ billLineId: line.id, recognitionDate: date, amount: value });
      if ("error" in result) return toast.error(result.error);
      toast.success("Prepaid cost recognised");
      setOpen(false);
      router.refresh();
    });
  }

  return <>
    <Button size="sm" disabled={line.remainingAmount <= 0.005} onClick={() => setOpen(true)}>Recognise cost</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Recognise prepaid cost</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">
            {line.description}<br />Remaining prepaid: <span className="font-semibold text-slate-900">{formatCurrency(line.remainingAmount, line.currency)}</span>
          </div>
          <div className="space-y-1.5"><Label>Recognition date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={full} onChange={(e) => { setFull(e.target.checked); if (e.target.checked) setAmount(line.remainingAmount); }} /><span>Recognise full available balance</span></label>
          <div className="space-y-1.5"><Label>Amount ({line.currency})</Label><Input type="number" min="0.01" max={line.remainingAmount} step="0.01" disabled={full} value={full ? line.remainingAmount : amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} /></div>
          <p className="text-xs text-slate-500">FINOS uses the original Bill exchange rate. This recognition does not create FX gain or loss.</p>
        </div>
        <DialogFooter><DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose><Button type="button" disabled={pending} onClick={submit}>{pending ? "Recognising…" : "Recognise"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}

function ReversalButton({ recognition }: { recognition: CostRecognitionView }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  function reverse() {
    if (!reason.trim()) return toast.error("Enter a reversal reason");
    startTransition(async () => {
      const result = await reversePrepaidCostRecognition({ recognitionId: recognition.id, reversalDate: date, reason });
      if ("error" in result) return toast.error(result.error);
      toast.success("Cost recognition reversed");
      setOpen(false);
      router.refresh();
    });
  }

  return <>
    <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Reverse</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Reverse cost recognition</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="rounded-md bg-amber-50 p-3 text-xs text-amber-800">The original recognition remains in the audit trail; FINOS posts an exact inverse journal. Later recognitions on this line must be reversed first.</div>
          <div className="space-y-1.5"><Label>Reversal date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Reason</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this recognition being reversed?" /></div>
        </div>
        <DialogFooter><DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose><Button type="button" disabled={pending} onClick={reverse}>{pending ? "Reversing…" : "Reverse"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}

export function CostRecognitionPanel({ lines, recognitions }: { lines: PrepaidLineView[]; recognitions: CostRecognitionView[] }) {
  if (!lines.length) return null;
  const byLine = new Map<string, CostRecognitionView[]>();
  for (const recognition of recognitions) {
    const current = byLine.get(recognition.billLineId) ?? [];
    current.push(recognition);
    byLine.set(recognition.billLineId, current);
  }

  return <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
    <div><h2 className="text-lg font-semibold text-slate-900">Cost Recognition</h2><p className="mt-1 text-sm text-slate-500">Release prepaid costs to their intended Expense accounts as the cost is incurred.</p></div>
    <div className="space-y-4">
      {lines.map((line) => <div key={line.id} className="rounded-lg border border-slate-200 p-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div><p className="font-medium text-slate-900">{line.description}</p><p className="mt-1 text-xs text-slate-500">Prepaid {formatCurrency(line.totalAmount, line.currency)} · Recognised {formatCurrency(line.recognisedAmount, line.currency)} · Remaining {formatCurrency(line.remainingAmount, line.currency)}</p></div>
          <RecognitionButton line={line} />
        </div>
        {(byLine.get(line.id) ?? []).length > 0 && <div className="border-t border-slate-100 pt-3 space-y-2">
          {(byLine.get(line.id) ?? []).map((recognition) => <div key={recognition.id} className={`flex items-center justify-between text-xs ${recognition.status === "REVERSED" ? "text-slate-400" : "text-slate-600"}`}>
            <span>{recognition.recognitionDate} · {formatCurrency(recognition.amount, line.currency)} · {recognition.status}</span>
            {recognition.status === "POSTED" ? <ReversalButton recognition={recognition} /> : null}
          </div>)}
        </div>}
      </div>)}
    </div>
  </div>;
}
