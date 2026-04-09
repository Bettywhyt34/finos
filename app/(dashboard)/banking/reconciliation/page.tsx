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
import { fetchUnreconciledTransactions } from "./actions";
import { useSession } from "next-auth/react";
import { toast } from "sonner";

// We can't use async server component here because we need to fetch bank
// accounts client-side (they depend on the org from session). Instead, we
// fetch everything through the server action.

interface AccountOption {
  id: string;
  accountName: string;
  bankName: string;
  currency: string;
}

interface ReconciliationData {
  transactions: {
    id: string;
    transactionDate: string;
    description: string;
    reference: string | null;
    amount: number;
    type: "CREDIT" | "DEBIT";
    isReconciled: boolean;
  }[];
  accountName: string;
  currency: string;
  currentBalance: number;
}

export default function ReconciliationPage() {
  const { data: session } = useSession();
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

  // Load accounts via API when component mounts / session available
  async function loadAccounts() {
    if (accountsLoaded) return;
    try {
      const res = await fetch("/api/banking/accounts");
      if (res.ok) {
        const json = await res.json();
        setAccounts(json.accounts ?? []);
        setAccountsLoaded(true);
      }
    } catch {
      // ignore
    }
  }

  async function handleLoad() {
    if (!selectedAccount) { toast.error("Select a bank account"); return; }
    if (!fromDate || !toDate) { toast.error("Select a date range"); return; }
    setLoading(true);
    const result = await fetchUnreconciledTransactions(selectedAccount, fromDate, toDate);
    setLoading(false);
    if ("error" in result) { toast.error(result.error); return; }
    setData(result as ReconciliationData);
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Bank Reconciliation
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Match bank statement transactions to your ledger
        </p>
      </div>

      {/* Controls */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="grid grid-cols-4 gap-4 items-end">
          <div className="space-y-1.5">
            <Label className="text-xs">Bank Account</Label>
            <Select
              value={selectedAccount}
              onValueChange={(v) => setSelectedAccount(v ?? "")}
              onOpenChange={(open) => open && loadAccounts()}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select account…" />
              </SelectTrigger>
              <SelectContent>
                {accounts.length === 0 ? (
                  <SelectItem value="__loading__" disabled>
                    {accountsLoaded ? "No accounts found" : "Loading…"}
                  </SelectItem>
                ) : (
                  accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.accountName} ({a.bankName})
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">From Date</Label>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="h-8 text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">To Date</Label>
            <Input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="h-8 text-sm"
            />
          </div>

          <Button onClick={handleLoad} disabled={loading || !selectedAccount}>
            <Search className="h-4 w-4 mr-1.5" />
            {loading ? "Loading…" : "Load Transactions"}
          </Button>
        </div>
      </div>

      {/* Results */}
      {data && (
        <ReconciliationView
          bankAccountId={selectedAccount}
          currency={data.currency}
          currentBalance={data.currentBalance}
          initialTransactions={data.transactions}
          accountName={data.accountName}
        />
      )}

      {!data && (
        <div className="text-center py-16 text-slate-400 border border-dashed border-slate-200 rounded-xl">
          <Search className="h-8 w-8 mx-auto mb-2 text-slate-300" />
          <p className="text-sm">Select a bank account and date range, then click Load.</p>
        </div>
      )}
    </div>
  );
}
