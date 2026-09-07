"use client";

import { ArrowLeftRight } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";

export interface TransferBankOption {
  id: string;
  accountName: string;
  bankName: string;
  currency: string;
}

export function BankTransferPanel({
  amount,
  currency,
  baseCurrency,
  direction,
  value,
  bankAccounts,
  onChange,
}: {
  amount: number;
  currency: string;
  baseCurrency: string;
  direction: "CREDIT" | "DEBIT";
  value: string;
  bankAccounts: TransferBankOption[];
  onChange: (bankAccountId: string) => void;
}) {
  const eligible = bankAccounts.filter((account) => account.currency.toUpperCase() === currency.toUpperCase());
  const fxBlocked = currency.toUpperCase() !== baseCurrency.toUpperCase();

  return (
    <div className="mt-3 rounded-lg border border-[var(--app-border)] bg-[var(--surface-muted)] p-3">
      <div className="flex items-start gap-2">
        <ArrowLeftRight className="mt-0.5 h-4 w-4 text-[var(--finos-accent)]" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-[var(--text-primary)]">
            {direction === "DEBIT" ? "Transfer to another FINOS bank account" : "Transfer from another FINOS bank account"}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
            FINOS records one transfer and one balanced journal. The other bank-statement side can be matched later without creating a duplicate.
          </p>
        </div>
      </div>

      {fxBlocked ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          Transfer matching is protected for now because this account is {currency} while the FINOS base currency is {baseCurrency}. Same-foreign-currency transfer matching will be enabled with FX-aware reconciliation.
        </div>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
          <select
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="h-8 rounded-md border border-[var(--app-border)] bg-white px-2 text-xs"
          >
            <option value="">Choose the other bank account…</option>
            {eligible.map((account) => (
              <option key={account.id} value={account.id}>
                {account.bankName} · {account.accountName} · {account.currency}
              </option>
            ))}
          </select>
          <span className={cn("text-xs font-financial tabular-nums", value ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]")}> 
            {formatCurrency(amount, currency)}
          </span>
        </div>
      )}

      {!fxBlocked && eligible.length === 0 ? (
        <p className="mt-2 text-[11px] text-amber-700">No other active {currency} bank account is available for this transfer.</p>
      ) : null}
    </div>
  );
}
