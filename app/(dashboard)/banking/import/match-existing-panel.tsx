"use client";

import { useEffect, useMemo, useState } from "react";
import { Link2, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn, formatCurrency, formatDate } from "@/lib/utils";

interface Allocation {
  id: string;
  targetId: string;
  amount: number;
}

interface Candidate {
  id: string;
  entryNumber: string;
  entryDate: string;
  reference: string | null;
  description: string | null;
  source: string | null;
  entityName: string | null;
  eligibleAmount: number;
  matchedAmount: number;
  remainingAmount: number;
  daysApart: number;
  exactAmount: boolean;
  referenceMatch: boolean;
  score: number;
}

export function MatchExistingPanel({
  bankAccountId,
  date,
  type,
  amount,
  reference,
  currency,
  allocations,
  onChange,
}: {
  bankAccountId: string;
  date: string;
  type: "CREDIT" | "DEBIT";
  amount: number;
  reference: string;
  currency: string;
  allocations: Allocation[];
  onChange: (allocations: Allocation[]) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      const params = new URLSearchParams({
        accountId: bankAccountId,
        date,
        type,
        amount: String(amount),
        reference,
      });
      try {
        const response = await fetch(`/api/banking/import/match-candidates?${params.toString()}`);
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok || data?.error) {
          setError(data?.error ?? "Could not load existing FINOS transactions");
          setCandidates([]);
          return;
        }
        setCandidates(data.candidates ?? []);
      } catch {
        if (!cancelled) setError("Could not load existing FINOS transactions");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [bankAccountId, date, type, amount, reference]);

  const allocated = useMemo(
    () => allocations.reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0),
    [allocations],
  );

  function setAmount(candidate: Candidate, value: number) {
    const nextAmount = Math.max(0, Math.min(Number.isFinite(value) ? value : 0, candidate.remainingAmount));
    const existing = allocations.find((allocation) => allocation.targetId === candidate.id);
    if (nextAmount <= 0) {
      onChange(allocations.filter((allocation) => allocation.targetId !== candidate.id));
      return;
    }
    if (existing) {
      onChange(allocations.map((allocation) => allocation.targetId === candidate.id ? { ...allocation, amount: nextAmount } : allocation));
      return;
    }
    onChange([...allocations, { id: candidate.id, targetId: candidate.id, amount: nextAmount }]);
  }

  function quickUse(candidate: Candidate) {
    const remainingStatement = Math.max(0, Math.round((amount - allocated) * 100) / 100);
    if (remainingStatement <= 0) return;
    setAmount(candidate, Math.min(remainingStatement, candidate.remainingAmount));
  }

  return (
    <div className="mt-3 rounded-lg border border-[var(--app-border)] bg-[var(--surface-muted)] p-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-medium"><Link2 className="h-3.5 w-3.5" />Match existing FINOS transactions</p>
          <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">No new journal is created. Allocate this statement amount to activity already recorded in FINOS.</p>
        </div>
        <p className={cn("whitespace-nowrap text-[11px] font-medium", Math.abs(allocated - amount) <= 0.01 ? "text-emerald-700" : "text-amber-700")}>{formatCurrency(allocated, currency)} / {formatCurrency(amount, currency)}</p>
      </div>

      {loading ? <div className="flex items-center gap-2 py-5 text-xs text-[var(--text-secondary)]"><Loader2 className="h-3.5 w-3.5 animate-spin" />Finding likely matches…</div> : null}
      {error ? <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{error}</div> : null}
      {!loading && !error && candidates.length === 0 ? <p className="py-4 text-xs text-[var(--text-secondary)]">No available FINOS bank-ledger activity was found near this statement date.</p> : null}

      {!loading && !error && candidates.length > 0 ? (
        <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
          {candidates.map((candidate, index) => {
            const allocation = allocations.find((item) => item.targetId === candidate.id);
            const suggested = candidate.exactAmount || candidate.referenceMatch || index === 0;
            return (
              <div key={candidate.id} className="grid grid-cols-[1fr_115px] items-center gap-2 rounded-md border border-[var(--app-border)] bg-white px-2.5 py-2">
                <button type="button" onClick={() => quickUse(candidate)} className="min-w-0 text-left">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-medium text-[var(--text-primary)]">{candidate.entityName || candidate.entryNumber}</span>
                    {candidate.entityName ? <span className="text-[10px] text-[var(--text-secondary)]">{candidate.entryNumber}</span> : null}
                    {suggested ? <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">Suggested</span> : null}
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-[var(--text-secondary)]">{formatDate(new Date(candidate.entryDate))} · {candidate.reference || candidate.description || candidate.source || "FINOS journal"}</p>
                  <p className="mt-0.5 text-[10px] text-[var(--text-secondary)]">{formatCurrency(candidate.remainingAmount, currency)} available{candidate.matchedAmount > 0 ? ` · ${formatCurrency(candidate.matchedAmount, currency)} already matched` : ""}</p>
                </button>
                <Input
                  type="number"
                  min="0"
                  max={candidate.remainingAmount}
                  step="0.01"
                  value={allocation?.amount ?? ""}
                  onChange={(event) => setAmount(candidate, Number(event.target.value))}
                  placeholder="0.00"
                  className="h-8 text-right text-xs"
                />
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
