"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banknote, CircleDollarSign, ReceiptText, RotateCcw, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recogniseDeferredProjectRevenue, reverseProjectRevenueRecognition } from "../revenue-actions";
import { formatCurrency } from "@/lib/utils";

export interface ProjectRevenueMetrics {
  revenueEarned: number;
  invoiced: number;
  costsIncurred: number;
  grossMargin: number;
  contractAsset: number;
  unearnedIncome: number;
}

export interface ProjectRevenueHistoryRow {
  id: string;
  recognitionDate: string;
  amount: number;
  unearnedUsed: number;
  contractAssetCreated: number;
  currency: string;
  status: string;
  note: string | null;
  journalEntryId: string;
  reversedAt: string | null;
  reversalReason: string | null;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function ProjectRevenuePanel({
  projectId,
  projectCurrency,
  metrics,
  history,
  canManage,
}: {
  projectId: string;
  projectCurrency: string;
  metrics: ProjectRevenueMetrics;
  history: ProjectRevenueHistoryRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState(metrics.unearnedIncome > 0 ? String(metrics.unearnedIncome) : "");
  const [recognitionDate, setRecognitionDate] = useState(today());
  const [note, setNote] = useState("");
  const [reversingId, setReversingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  function submitRecognition() {
    startTransition(async () => {
      const result = await recogniseDeferredProjectRevenue({
        projectId,
        amount: Number(amount),
        recognitionDate,
        note,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Project revenue recognised");
      setAmount("");
      setNote("");
      router.refresh();
    });
  }

  function submitReversal(recognitionId: string) {
    startTransition(async () => {
      const result = await reverseProjectRevenueRecognition({ recognitionId, reason });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Revenue recognition reversed");
      setReversingId(null);
      setReason("");
      router.refresh();
    });
  }

  return (
    <section className="space-y-5">
      {projectCurrency !== "NGN" ? (
        <div className="rounded-xl border border-[var(--app-border)] bg-[var(--surface-muted)] px-4 py-3 text-sm text-[var(--text-secondary)]">
          Project commercial values may be in {projectCurrency}. Accounting metrics below are shown in NGN, FINOS&apos;s base ledger currency.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={TrendingUp} label="Revenue earned" value={formatCurrency(metrics.revenueEarned)} />
        <Metric icon={ReceiptText} label="Invoiced (net)" value={formatCurrency(metrics.invoiced)} />
        <Metric icon={CircleDollarSign} label="Contract Asset" value={formatCurrency(metrics.contractAsset)} />
        <Metric icon={Banknote} label="Unearned Income" value={formatCurrency(metrics.unearnedIncome)} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.35fr_1fr]">
        <section className="rounded-xl border border-[var(--app-border)] bg-white">
          <div className="border-b border-[var(--app-border)] px-6 py-5">
            <h2 className="font-serif text-xl font-medium text-[var(--text-primary)]">Revenue recognition history</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">Actual earning events. Billing plans do not create revenue.</p>
          </div>
          {history.length ? (
            <div className="divide-y divide-[var(--app-border)]">
              {history.map((row) => (
                <div key={row.id} className="px-6 py-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-financial text-lg font-medium text-[var(--text-primary)]">{formatCurrency(row.amount)}</p>
                        <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${row.status === "POSTED" ? "bg-[#E7F2EC] text-[var(--positive)]" : "bg-[var(--surface-muted)] text-[var(--text-secondary)]"}`}>
                          {row.status.toLowerCase()}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-[var(--text-secondary)]">{new Date(`${row.recognitionDate}T00:00:00`).toLocaleDateString("en-NG", { dateStyle: "medium" })} · Dr Unearned Income / Cr Revenue</p>
                      {row.note ? <p className="mt-2 text-sm text-[var(--text-secondary)]">{row.note}</p> : null}
                      {row.status === "REVERSED" && row.reversalReason ? <p className="mt-2 text-xs text-[var(--critical)]">Reversed: {row.reversalReason}</p> : null}
                    </div>
                    {canManage && row.status === "POSTED" ? (
                      reversingId === row.id ? (
                        <div className="w-full max-w-sm space-y-2">
                          <Label htmlFor={`reason-${row.id}`}>Reversal reason</Label>
                          <Input id={`reason-${row.id}`} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is this recognition being reversed?" />
                          <div className="flex gap-2">
                            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => { setReversingId(null); setReason(""); }}>Cancel</Button>
                            <Button type="button" size="sm" disabled={pending || !reason.trim()} onClick={() => submitReversal(row.id)}>
                              <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reverse
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button type="button" size="sm" variant="outline" onClick={() => setReversingId(row.id)}>
                          <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reverse
                        </Button>
                      )
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-6 py-10 text-center text-sm text-[var(--text-secondary)]">No revenue recognition entries have been posted yet.</p>
          )}
        </section>

        <section className="rounded-xl border border-[var(--app-border)] bg-white">
          <div className="border-b border-[var(--app-border)] px-6 py-5">
            <h2 className="font-serif text-xl font-medium text-[var(--text-primary)]">Recognise billed revenue</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">Release revenue that is currently sitting in Unearned Income.</p>
          </div>
          <div className="space-y-4 p-6">
            <div className="rounded-lg bg-[var(--surface-muted)] px-4 py-3">
              <p className="text-xs text-[var(--text-secondary)]">Available to recognise</p>
              <p className="font-financial mt-1 text-xl font-medium text-[var(--text-primary)]">{formatCurrency(metrics.unearnedIncome)}</p>
            </div>
            {metrics.unearnedIncome > 0.005 ? (
              canManage ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="recognitionAmount">Amount (NGN)</Label>
                    <Input id="recognitionAmount" type="number" min="0.01" step="0.01" max={metrics.unearnedIncome} value={amount} onChange={(event) => setAmount(event.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="recognitionDate">Recognition date</Label>
                    <Input id="recognitionDate" type="date" max={today()} value={recognitionDate} onChange={(event) => setRecognitionDate(event.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="recognitionNote">Evidence / note</Label>
                    <Input id="recognitionNote" value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. Service milestone accepted" />
                  </div>
                  <Button type="button" className="w-full" disabled={pending || !amount || Number(amount) <= 0 || Number(amount) > metrics.unearnedIncome + 0.005} onClick={submitRecognition}>
                    {pending ? "Posting…" : "Recognise Revenue"}
                  </Button>
                  <p className="text-xs leading-5 text-[var(--text-secondary)]">FINOS posts Dr Unearned Income / Cr Revenue and prevents recognition above the remaining deferred balance.</p>
                </>
              ) : (
                <p className="text-sm text-[var(--text-secondary)]">You can view revenue but your role cannot post recognition entries.</p>
              )
            ) : (
              <p className="text-sm leading-6 text-[var(--text-secondary)]">There is no billed-but-unearned revenue available to release.</p>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof TrendingUp; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--app-border)] bg-white p-5">
      <div className="flex items-center justify-between"><p className="text-xs font-medium text-[var(--text-secondary)]">{label}</p><Icon className="h-4 w-4 text-[var(--finos-accent)]" /></div>
      <p className="font-financial mt-3 text-[27px] font-medium text-[var(--text-primary)]">{value}</p>
    </div>
  );
}
