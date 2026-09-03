"use client";

import { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Link2, Unlink2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { completeReconciliation, matchReconciliationItem, unmatchReconciliationItem } from "./actions";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import type { ReconciliationData } from "./page";

const TOLERANCE = 0.005;
type Transaction = ReconciliationData["transactions"][number];
type Match = Transaction["matches"][number];

export function ReconciliationView({ data, from, to, onRefresh }: {
  data: ReconciliationData;
  from: string;
  to: string;
  onRefresh: () => Promise<void>;
}) {
  const [statementBalance, setStatementBalance] = useState(data.statementClosingBalance == null ? "" : String(data.statementClosingBalance));
  const [selectedLedger, setSelectedLedger] = useState<Record<string, string>>({});
  const [matchAmounts, setMatchAmounts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);

  const ledgerById = useMemo(() => new Map(data.ledgerLines.map((line) => [line.id, line])), [data.ledgerLines]);
  const statementBalanceNumber = statementBalance.trim() === "" ? null : Number(statementBalance);
  const difference = data.matchingBlockedReason || statementBalanceNumber == null
    ? null
    : data.ledgerClosingBalance - statementBalanceNumber;
  const balanced = difference != null && Math.abs(difference) < TOLERANCE;
  const incomplete = data.transactions.filter((transaction) => !transaction.isFullyMatched).length;
  const partial = data.transactions.filter((transaction) => !transaction.isFullyMatched && transaction.matchedAmount > TOLERANCE).length;

  function candidatesFor(transaction: Transaction) {
    return data.ledgerLines
      .filter((line) => line.statementType === transaction.type && line.remainingAmount > TOLERANCE)
      .sort((a, b) => {
        const aExact = Math.abs(a.remainingAmount - transaction.remainingAmount) <= TOLERANCE;
        const bExact = Math.abs(b.remainingAmount - transaction.remainingAmount) <= TOLERANCE;
        if (aExact !== bExact) return aExact ? -1 : 1;
        return Math.abs(new Date(a.entryDate).getTime() - new Date(transaction.transactionDate).getTime())
          - Math.abs(new Date(b.entryDate).getTime() - new Date(transaction.transactionDate).getTime());
      });
  }

  function selectLedger(transaction: Transaction, lineId: string) {
    setSelectedLedger((current) => ({ ...current, [transaction.id]: lineId }));
    const line = ledgerById.get(lineId);
    if (line) {
      setMatchAmounts((current) => ({
        ...current,
        [transaction.id]: Math.min(transaction.remainingAmount, line.remainingAmount).toFixed(2),
      }));
    }
  }

  async function addMatch(transaction: Transaction) {
    const lineId = selectedLedger[transaction.id];
    if (!lineId) return toast.error("Select a FINOS ledger entry");
    if (statementBalanceNumber == null || !Number.isFinite(statementBalanceNumber)) return toast.error("Enter the statement closing balance first");
    const raw = matchAmounts[transaction.id]?.trim();
    const amount = raw ? Number(raw) : undefined;
    if (amount != null && (!Number.isFinite(amount) || amount <= 0)) return toast.error("Enter a valid match amount");

    setSavingId(transaction.id);
    const result = await matchReconciliationItem({
      bankAccountId: data.bankAccountId,
      from,
      to,
      statementClosingBalance: statementBalanceNumber,
      bankTransactionId: transaction.id,
      journalEntryLineId: lineId,
      matchedAmount: amount,
    });
    setSavingId(null);
    if ("error" in result) return toast.error(result.error);
    toast.success(result.remainingAmount > TOLERANCE ? "Partial match saved" : "Statement row fully matched");
    setSelectedLedger((current) => { const next = { ...current }; delete next[transaction.id]; return next; });
    setMatchAmounts((current) => { const next = { ...current }; delete next[transaction.id]; return next; });
    await onRefresh();
  }

  async function removeMatch(match: Match) {
    setSavingId(match.id);
    const result = await unmatchReconciliationItem(match.id);
    setSavingId(null);
    if ("error" in result) return toast.error(result.error);
    toast.success("Match allocation removed");
    await onRefresh();
  }

  async function finish() {
    if (statementBalanceNumber == null || !Number.isFinite(statementBalanceNumber)) return toast.error("Enter the statement closing balance");
    setCompleting(true);
    const result = await completeReconciliation({ bankAccountId: data.bankAccountId, from, to, statementClosingBalance: statementBalanceNumber });
    setCompleting(false);
    if ("error" in result) return toast.error(result.error);
    toast.success("Bank reconciliation completed");
    await onRefresh();
  }

  return <div className="space-y-5">
    <section className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-4">
      <div><p className="text-xs text-slate-500">Bank Account</p><p className="mt-1 font-semibold">{data.accountName}</p><p className="mt-1 text-xs text-slate-400">{from} to {to} · {data.currency}</p></div>
      <div><p className="text-xs text-slate-500">FINOS Ledger Closing</p><p className="mt-1 font-mono text-lg font-semibold">{formatCurrency(data.ledgerClosingBalance, data.baseCurrency)}</p><p className="mt-1 text-xs text-slate-400">Base ledger currency</p></div>
      <div><Label className="text-xs">Statement Closing Balance</Label><Input className="mt-1 font-mono" type="number" step="0.01" value={statementBalance} disabled={data.completed} onChange={(event) => setStatementBalance(event.target.value)} /><p className="mt-1 text-[11px] text-slate-400">{data.currency}</p></div>
      <div className={cn("rounded-md border p-3", data.matchingBlockedReason || !balanced ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50")}>
        <p className="text-xs text-slate-500">{data.matchingBlockedReason ? "Matching Status" : "Difference"}</p>
        <p className="mt-1 font-mono text-lg font-semibold">{data.matchingBlockedReason ? "FX review required" : difference == null ? "—" : formatCurrency(difference, data.currency)}</p>
        <p className="mt-1 text-xs text-slate-500">{incomplete} incomplete{partial ? ` · ${partial} partial` : ""}</p>
      </div>
    </section>

    {data.matchingBlockedReason && <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><div><p className="font-medium">FX reconciliation is protected</p><p className="mt-1 text-xs">{data.matchingBlockedReason}</p></div></div>}
    {data.completed && <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><CheckCircle2 className="h-4 w-4" />Reconciliation completed{data.completedAt ? ` on ${formatDate(new Date(data.completedAt))}` : ""}. Match evidence is locked.</div>}

    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3"><div><p className="text-sm font-semibold">Statement to FINOS Ledger</p><p className="text-xs text-slate-500">Allocate one statement row across several FINOS entries, or one FINOS entry across several statement rows.</p></div><span className={cn("rounded-full px-2 py-1 text-xs font-medium", incomplete ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700")}>{incomplete} incomplete</span></header>
      <div className="divide-y divide-slate-100">
        {data.transactions.length === 0 && <div className="px-4 py-12 text-center text-sm text-slate-400">No imported statement activity in this period.</div>}
        {data.transactions.map((transaction) => {
          const candidates = candidatesFor(transaction);
          return <div key={transaction.id} className="grid gap-4 px-4 py-4 lg:grid-cols-[1fr_1.5fr_auto] lg:items-start">
            <div><div className="flex items-center gap-2"><span className="text-xs text-slate-500">{formatDate(new Date(transaction.transactionDate))}</span><span className={cn("rounded-full px-1.5 py-0.5 text-[11px]", transaction.type === "CREDIT" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600")}>{transaction.type === "CREDIT" ? "Money In" : "Money Out"}</span></div><p className="mt-1 text-sm font-medium">{transaction.description}</p><p className="mt-1 text-xs text-slate-500">{transaction.reference || "No reference"} · <span className="font-mono font-semibold text-slate-800">{formatCurrency(transaction.amount, data.currency)}</span></p><p className={cn("mt-2 text-xs font-medium", transaction.isFullyMatched ? "text-emerald-700" : transaction.matchedAmount > TOLERANCE ? "text-amber-700" : "text-slate-400")}>{transaction.isFullyMatched ? "Fully matched" : `${formatCurrency(transaction.matchedAmount, data.currency)} matched · ${formatCurrency(transaction.remainingAmount, data.currency)} remaining`}</p></div>
            <div className="space-y-2">
              {transaction.matches.map((match) => <div key={match.id} className="flex items-center justify-between gap-3 rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2"><div className="min-w-0"><p className="flex items-center gap-1 text-xs font-medium text-emerald-800"><Link2 className="h-3.5 w-3.5" />{match.entryNumber} · <span className="font-mono">{formatCurrency(match.matchedAmount, data.currency)}</span></p><p className="mt-1 truncate text-xs text-emerald-700">{formatDate(new Date(match.entryDate))} · {match.reference || match.description || "FINOS journal"}</p></div>{match.canRemove && !data.completed ? <Button variant="ghost" size="sm" disabled={savingId === match.id} onClick={() => removeMatch(match)}><Unlink2 className="mr-1 h-3.5 w-3.5" />Remove</Button> : <span className="text-[11px] text-emerald-700">Locked</span>}</div>)}
              {!transaction.isFullyMatched && !data.completed && !data.matchingBlockedReason && <div className="grid gap-2 sm:grid-cols-[1fr_140px]"><Select value={selectedLedger[transaction.id] ?? ""} onValueChange={(value) => selectLedger(transaction, value ?? "")}><SelectTrigger><SelectValue placeholder={candidates.length ? "Select FINOS ledger entry…" : "No available ledger candidate"} /></SelectTrigger><SelectContent>{candidates.map((line) => <SelectItem key={line.id} value={line.id}>{line.entryNumber} · {formatDate(new Date(line.entryDate))} · {line.reference || line.description || line.source || "Journal"} · {formatCurrency(line.remainingAmount, data.currency)} available</SelectItem>)}</SelectContent></Select><Input type="number" min="0.01" step="0.01" value={matchAmounts[transaction.id] ?? ""} disabled={!selectedLedger[transaction.id]} onChange={(event) => setMatchAmounts((current) => ({ ...current, [transaction.id]: event.target.value }))} placeholder="Match amount" className="font-mono" /></div>}
            </div>
            <div>{!transaction.isFullyMatched && !data.completed && !data.matchingBlockedReason ? <Button size="sm" disabled={!selectedLedger[transaction.id] || savingId === transaction.id} onClick={() => addMatch(transaction)}><Link2 className="mr-1.5 h-3.5 w-3.5" />{savingId === transaction.id ? "Matching…" : "Match"}</Button> : transaction.isFullyMatched ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : null}</div>
          </div>;
        })}
      </div>
    </section>

    {!data.completed && <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-2">{balanced && incomplete === 0 ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" /> : <AlertCircle className="mt-0.5 h-4 w-4 text-amber-600" />}<div><p className="text-sm font-medium">Complete reconciliation</p><p className="text-xs text-slate-500">Every statement row must be fully allocated and the closing balances must agree.</p></div></div><Button onClick={finish} disabled={completing || incomplete !== 0 || !balanced || Boolean(data.matchingBlockedReason)}>{completing ? "Completing…" : "Complete Reconciliation"}</Button></section>}
  </div>;
}
