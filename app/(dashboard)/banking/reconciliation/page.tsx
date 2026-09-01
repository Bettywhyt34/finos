"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ReconciliationView } from "./reconciliation-view";
import { fetchReconciliationData } from "./actions";
import { toast } from "sonner";

interface AccountOption {
  id: string;
  accountName: string;
  bankName: string;
  currency: string;
}

export interface ReconciliationData {
  bankAccountId: string;
  accountName: string;
  currency: string;
  ledgerAccountId: string;
  ledgerClosingBalance: number;
  completed: boolean;
  completedAt: string | null;
  statementClosingBalance: number | null;
  transactions: Array<{
    id: string;
    transactionDate: string;
    description: string;
    reference: string | null;
    amount: number;
    type: "CREDIT" | "DEBIT";
    matchedJournalLineId: string | null;
  }>;
  ledgerLines: Array<{
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
  }>;
}

export default function ReconciliationPage() {
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split("T")[0];
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ReconciliationData | null>(null);

  async function loadAccounts() {
    if (accountsLoaded) return;
    try {
      const res = await fetch("/api/banking/accounts");
      if (res.ok) {
        const json = await res.json();
        setAccounts(json.accounts ?? []);
      }
      setAccountsLoaded(true);
    } catch {
      setAccountsLoaded(true);
    }
  }

  async function handleLoad() {
    if (!selectedAccount) { toast.error("Select a bank account"); return; }
    if (!fromDate || !toDate) { toast.error("Select a date range"); return; }
    setLoading(true);
    const result = await fetchReconciliationData(selectedAccount, fromDate, toDate);
    setLoading(false);
    if ("error" in result) { toast.error(result.error); return; }
    setData(result as ReconciliationData);
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Bank Reconciliation</h1>
        <p className="text-sm text-slate-500 mt-1">Match imported bank-statement transactions to posted FINOS bank-ledger entries.</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="grid gap-4 items-end md:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Bank Account</Label>
            <Select
              value={selectedAccount}
              onValueChange={(v) => { setSelectedAccount(v ?? ""); setData(null); }}
              onOpenChange={(open) => open && loadAccounts()}
            >
              <SelectTrigger className="w-full"><SelectValue placeholder="Select account…" /></SelectTrigger>
              <SelectContent>
                {accounts.length === 0 ? (
                  <SelectItem value="__loading__" disabled>{accountsLoaded ? "No accounts found" : "Loading…"}</SelectItem>
                ) : accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>{account.accountName} ({account.bankName})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Statement From</Label>
            <Input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setData(null); }} className="h-9 text-sm" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Statement To</Label>
            <Input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setData(null); }} className="h-9 text-sm" />
          </div>

          <Button onClick={handleLoad} disabled={loading || !selectedAccount}>
            <Search className="h-4 w-4 mr-1.5" /> {loading ? "Loading…" : "Start Reconciliation"}
          </Button>
        </div>
      </div>

      {data ? (
        <ReconciliationView
          key={`${selectedAccount}:${fromDate}:${toDate}`}
          data={data}
          from={fromDate}
          to={toDate}
          onRefresh={handleLoad}
        />
      ) : (
        <div className="text-center py-16 text-slate-400 border border-dashed border-slate-200 rounded-xl">
          <Search className="h-8 w-8 mx-auto mb-2 text-slate-300" />
          <p className="text-sm">Select the bank account and statement period to begin.</p>
        </div>
      )}
    </div>
  );
}
