"use client";

import { useState, useMemo } from "react";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchUnreconciledTransactions, markTransactionsReconciled } from "./actions";
import { formatCurrency, formatDate, cn } from "@/lib/utils";

interface Transaction {
  id: string;
  transactionDate: string;
  description: string;
  reference: string | null;
  amount: number;
  type: "CREDIT" | "DEBIT";
  isReconciled: boolean;
}

interface ReconciliationViewProps {
  bankAccountId: string;
  currency: string;
  currentBalance: number;
  initialTransactions: Transaction[];
  accountName: string;
}

export function ReconciliationView({
  bankAccountId,
  currency,
  currentBalance,
  initialTransactions,
  accountName,
}: ReconciliationViewProps) {
  const [transactions, setTransactions] = useState<Transaction[]>(initialTransactions);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statementBalance, setStatementBalance] = useState("");
  const [saving, setSaving] = useState(false);

  const selectedTransactions = transactions.filter((t) => selected.has(t.id));

  const selectedCredits = selectedTransactions
    .filter((t) => t.type === "CREDIT")
    .reduce((s, t) => s + t.amount, 0);
  const selectedDebits = selectedTransactions
    .filter((t) => t.type === "DEBIT")
    .reduce((s, t) => s + t.amount, 0);

  const totalCredits = transactions
    .filter((t) => t.type === "CREDIT")
    .reduce((s, t) => s + t.amount, 0);
  const totalDebits = transactions
    .filter((t) => t.type === "DEBIT")
    .reduce((s, t) => s + t.amount, 0);

  const stmtBal = parseFloat(statementBalance) || 0;
  const difference = currentBalance - stmtBal;
  const isBalanced = Math.abs(difference) < 0.005;

  function toggleAll() {
    if (selected.size === transactions.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(transactions.map((t) => t.id)));
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleReconcile() {
    if (selected.size === 0) {
      toast.error("Select at least one transaction to reconcile");
      return;
    }
    setSaving(true);
    const result = await markTransactionsReconciled(Array.from(selected));
    setSaving(false);

    if (result?.error) {
      toast.error(result.error);
      return;
    }

    toast.success(`${result.count} transaction${result.count !== 1 ? "s" : ""} reconciled`);
    // Remove reconciled transactions from the list
    setTransactions((prev) => prev.filter((t) => !selected.has(t.id)));
    setSelected(new Set());
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-1">
          <p className="text-xs text-slate-500">Ledger Balance</p>
          <p className="text-xl font-bold font-mono text-slate-900">
            {formatCurrency(currentBalance, currency)}
          </p>
          <p className="text-xs text-slate-400">{accountName}</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-1">
          <p className="text-xs text-slate-500">Statement Balance</p>
          <input
            type="number"
            step="0.01"
            className="text-xl font-bold font-mono text-slate-900 w-full border-none outline-none bg-transparent p-0"
            placeholder="Enter balance…"
            value={statementBalance}
            onChange={(e) => setStatementBalance(e.target.value)}
          />
          <p className="text-xs text-slate-400">From your bank statement</p>
        </div>

        <div className={cn(
          "border rounded-lg p-4 space-y-1",
          isBalanced ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"
        )}>
          <p className="text-xs text-slate-500">Difference</p>
          <p className={cn("text-xl font-bold font-mono",
            isBalanced ? "text-green-700" : "text-red-600"
          )}>
            {isBalanced ? "₦0.00" : formatCurrency(Math.abs(difference), currency)}
          </p>
          <div className={cn("flex items-center gap-1 text-xs",
            isBalanced ? "text-green-700" : "text-red-600"
          )}>
            {isBalanced
              ? <><CheckCircle2 className="h-3 w-3" /> Balanced</>
              : <><AlertCircle className="h-3 w-3" /> Not balanced</>
            }
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-1">
          <p className="text-xs text-slate-500">Unreconciled Items</p>
          <p className="text-xl font-bold text-slate-900">{transactions.length}</p>
          <p className="text-xs text-slate-400">
            {selected.size} selected · {formatCurrency(selectedCredits - selectedDebits, currency)} net
          </p>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-6 text-sm text-slate-500">
        <span>Unreconciled credits: <strong className="text-green-700">{formatCurrency(totalCredits, currency)}</strong></span>
        <span>Unreconciled debits: <strong className="text-red-600">{formatCurrency(totalDebits, currency)}</strong></span>
        <span>Net: <strong className="text-slate-700">{formatCurrency(totalCredits - totalDebits, currency)}</strong></span>
      </div>

      {/* Transactions table */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <p className="text-sm font-medium text-slate-700">
            Unreconciled Transactions ({transactions.length})
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={toggleAll}
              className="text-xs"
            >
              {selected.size === transactions.length && transactions.length > 0
                ? "Deselect All"
                : "Select All"}
            </Button>
            <Button
              size="sm"
              onClick={handleReconcile}
              disabled={saving || selected.size === 0}
            >
              {saving ? "Reconciling…" : `Reconcile (${selected.size})`}
            </Button>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead className="w-10"></TableHead>
              <TableHead className="w-28">Date</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-32">Reference</TableHead>
              <TableHead className="w-28 text-right">Credit</TableHead>
              <TableHead className="w-28 text-right">Debit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-10 text-slate-400 text-sm">
                  <CheckCircle2 className="h-8 w-8 text-green-300 mx-auto mb-2" />
                  All transactions in this period are reconciled
                </TableCell>
              </TableRow>
            ) : (
              transactions.map((tx) => (
                <TableRow
                  key={tx.id}
                  className={cn(selected.has(tx.id) && "bg-blue-50/50")}
                  onClick={() => toggleOne(tx.id)}
                >
                  <TableCell>
                    <Checkbox
                      checked={selected.has(tx.id)}
                      onCheckedChange={() => toggleOne(tx.id)}
                    />
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">
                    {formatDate(new Date(tx.transactionDate))}
                  </TableCell>
                  <TableCell className="truncate max-w-xs text-sm">
                    {tx.description}
                  </TableCell>
                  <TableCell className="text-xs text-slate-400 font-mono">
                    {tx.reference ?? "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {tx.type === "CREDIT" ? (
                      <span className="text-green-700">
                        {formatCurrency(tx.amount, currency)}
                      </span>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {tx.type === "DEBIT" ? (
                      <span className="text-red-600">
                        {formatCurrency(tx.amount, currency)}
                      </span>
                    ) : "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
