"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, AlertCircle, Link2, Unlink2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  matchReconciliationItem,
  unmatchReconciliationItem,
  completeReconciliation,
} from "./actions";
import { formatCurrency, formatDate, cn } from "@/lib/utils";

interface StatementTransaction {
  id: string;
  transactionDate: string;
  description: string;
  reference: string | null;
  amount: number;
  type: "CREDIT" | "DEBIT";
  matchedJournalLineId: string | null;
}

interface LedgerLine {
  id: string;
  entryId: string;
  entryNumber: string;
  entryDate: string;
  reference: string | null;
  description: string | null;
  source: string | null;
  debit: number;
  credit: number;
  matchedBankTransactionId: string | null;
}

interface ReconciliationData {
  bankAccountId: string;
  accountName: string;
  currency: string;
  ledgerAccountId: string;
  ledgerClosingBalance: number;
  completed: boolean;
  completedAt: string | null;
  statementClosingBalance: number | null;
  transactions: StatementTransaction[];
  ledgerLines: LedgerLine[];
}

interface Props {
  data: ReconciliationData;
  from: string;
  to: string;
  onRefresh: () => Promise<void>;
}

function moneyEqual(a: number, b: number) {
  return Math.abs(a - b) < 0.005;
}

export function ReconciliationView({ data, from, to, onRefresh }: Props) {
  const [statementBalance, setStatementBalance] = useState(
    data.statementClosingBalance == null ? "" : String(data.statementClosingBalance),
  );
  const [selectedLedger, setSelectedLedger] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);

  const statementBalanceNumber = statementBalance.trim() === "" ? null : Number(statementBalance);
  const difference = statementBalanceNumber == null ? null : data.ledgerClosingBalance - statementBalanceNumber;
  const balanced = difference != null && Math.abs(difference) < 0.005;
  const matchedCount = data.transactions.filter((transaction) => transaction.matchedJournalLineId).length;
  const unmatchedCount = data.transactions.length - matchedCount;

  const lineById = useMemo(
    () => new Map(data.ledgerLines.map((line) => [line.id, line])),
    [data.ledgerLines],
  );

  function candidatesFor(transaction: StatementTransaction) {
    return data.ledgerLines.filter((line) => {
      if (line.matchedBankTransactionId && line.matchedBankTransactionId !== transaction.id) return false;
      if (transaction.type === "CREDIT") {
        return line.credit < 0.005 && moneyEqual(line.debit, transaction.amount);
      }
      return line.debit < 0.005 && moneyEqual(line.credit, transaction.amount);
    });
  }

  async function handleMatch(transaction: StatementTransaction) {
    const journalEntryLineId = selectedLedger[transaction.id];
    if (!journalEntryLineId) { toast.error("Select the FINOS ledger entry to match"); return; }
    if (statementBalanceNumber == null || !Number.isFinite(statementBalanceNumber)) {
      toast.error("Enter the statement closing balance first");
      return;
    }

    setSavingId(transaction.id);
    const result = await matchReconciliationItem({
      bankAccountId: data.bankAccountId,
      from,
      to,
      statementClosingBalance: statementBalanceNumber,
      bankTransactionId: transaction.id,
      journalEntryLineId,
    });
    setSavingId(null);
    if (result?.error) { toast.error(result.error); return; }
    toast.success("Statement transaction matched to FINOS ledger");
    await onRefresh();
  }

  async function handleUnmatch(transaction: StatementTransaction) {
    setSavingId(transaction.id);
    const result = await unmatchReconciliationItem(transaction.id);
    setSavingId(null);
    if (result?.error) { toast.error(result.error); return; }
    toast.success("Match removed");
    await onRefresh();
  }

  async function handleComplete() {
    if (statementBalanceNumber == null || !Number.isFinite(statementBalanceNumber)) {
      toast.error("Enter the statement closing balance");
      return;
    }
    setCompleting(true);
    const result = await completeReconciliation({
      bankAccountId: data.bankAccountId,
      from,
      to,
      statementClosingBalance: statementBalanceNumber,
    });
    setCompleting(false);
    if (result?.error) { toast.error(result.error); return; }
    toast.success("Bank reconciliation completed");
    await onRefresh();
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="grid gap-4 md:grid-cols-4">
          <div>
            <p className="text-xs text-slate-500">Bank Account</p>
            <p className="mt-1 font-semibold text-slate-900">{data.accountName}</p>
            <p className="mt-1 text-xs text-slate-400">{from} to {to}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">FINOS Ledger Closing</p>
            <p className="mt-1 font-mono text-lg font-semibold text-slate-900">
              {formatCurrency(data.ledgerClosingBalance, data.currency)}
            </p>
            <p className="mt-1 text-xs text-slate-400">Posted bank-ledger balance at statement end</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Statement Closing Balance</Label>
            <Input
              type="number"
              step="0.01"
              value={statementBalance}
              disabled={data.completed}
              onChange={(event) => setStatementBalance(event.target.value)}
              placeholder="0.00"
              className="font-mono"
            />
          </div>
          <div className={cn(
            "rounded-md border p-3",
            difference == null ? "border-slate-200 bg-slate-50" : balanced ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50",
          )}>
            <p className="text-xs text-slate-500">Difference</p>
            <p className={cn("mt-1 font-mono text-lg font-semibold", balanced ? "text-emerald-700" : "text-slate-900")}>
              {difference == null ? "—" : formatCurrency(difference, data.currency)}
            </p>
            <p className="mt-1 text-xs text-slate-500">{matchedCount} of {data.transactions.length} statement items matched</p>
          </div>
        </div>
      </div>

      {data.completed && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4" />
          Reconciliation completed{data.completedAt ? ` on ${formatDate(new Date(data.completedAt))}` : ""}. Match evidence is locked.
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-slate-800">Statement to FINOS Ledger</p>
            <p className="text-xs text-slate-500">Match each imported bank-statement row to the corresponding posted bank-ledger entry.</p>
          </div>
          <span className={cn(
            "rounded-full px-2 py-1 text-xs font-medium",
            unmatchedCount === 0 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700",
          )}>
            {unmatchedCount} unmatched
          </span>
        </div>

        <div className="divide-y divide-slate-100">
          {data.transactions.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-slate-400">No imported bank-statement transactions in this period.</div>
          ) : data.transactions.map((transaction) => {
            const matchedLine = transaction.matchedJournalLineId ? lineById.get(transaction.matchedJournalLineId) : null;
            const candidates = candidatesFor(transaction);
            return (
              <div key={transaction.id} className="grid gap-4 px-4 py-4 lg:grid-cols-[1.15fr_1.4fr_auto] lg:items-center">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">{formatDate(new Date(transaction.transactionDate))}</span>
                    <span className={cn(
                      "rounded-full px-1.5 py-0.5 text-[11px] font-medium",
                      transaction.type === "CREDIT" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600",
                    )}>
                      {transaction.type === "CREDIT" ? "Money In" : "Money Out"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-slate-900">{transaction.description}</p>
                  <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
                    <span>{transaction.reference || "No reference"}</span>
                    <span className="font-mono font-semibold text-slate-800">{formatCurrency(transaction.amount, data.currency)}</span>
                  </div>
                </div>

                <div>
                  {matchedLine ? (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-800"><Link2 className="h-3.5 w-3.5" /> Matched to {matchedLine.entryNumber}</div>
                      <p className="mt-1 text-xs text-emerald-700">{formatDate(new Date(matchedLine.entryDate))} · {matchedLine.reference || matchedLine.description || "FINOS journal"}</p>
                    </div>
                  ) : (
                    <Select
                      value={selectedLedger[transaction.id] ?? ""}
                      disabled={data.completed}
                      onValueChange={(value) => setSelectedLedger((current) => ({ ...current, [transaction.id]: value ?? "" }))}
                    >
                      <SelectTrigger className="w-full"><SelectValue placeholder={candidates.length ? "Select matching FINOS ledger entry…" : "No exact ledger candidate"} /></SelectTrigger>
                      <SelectContent>
                        {candidates.map((line) => (
                          <SelectItem key={line.id} value={line.id}>
                            {line.entryNumber} · {formatDate(new Date(line.entryDate))} · {line.reference || line.description || line.source || "Journal"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                <div className="flex justify-end">
                  {matchedLine ? (
                    <Button variant="outline" size="sm" disabled={data.completed || savingId === transaction.id} onClick={() => handleUnmatch(transaction)}>
                      <Unlink2 className="mr-1.5 h-3.5 w-3.5" /> Unmatch
                    </Button>
                  ) : (
                    <Button size="sm" disabled={data.completed || !selectedLedger[transaction.id] || savingId === transaction.id} onClick={() => handleMatch(transaction)}>
                      <Link2 className="mr-1.5 h-3.5 w-3.5" /> {savingId === transaction.id ? "Matching…" : "Match"}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {!data.completed && (
        <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2">
            {balanced && unmatchedCount === 0 ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" /> : <AlertCircle className="mt-0.5 h-4 w-4 text-amber-600" />}
            <div>
              <p className="text-sm font-medium text-slate-800">Complete reconciliation</p>
              <p className="text-xs text-slate-500">Every statement row must be matched and the statement closing balance must equal the FINOS ledger closing balance.</p>
            </div>
          </div>
          <Button onClick={handleComplete} disabled={completing || unmatchedCount !== 0 || !balanced}>
            {completing ? "Completing…" : "Complete Reconciliation"}
          </Button>
        </div>
      )}
    </div>
  );
}
