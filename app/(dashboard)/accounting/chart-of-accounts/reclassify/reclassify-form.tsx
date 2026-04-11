"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { AccountType, FinancialCategory } from "@prisma/client";

// ── Dropdown options per AccountType ──────────────────────────────────────────
const OPTIONS: Partial<Record<AccountType, Array<{ value: FinancialCategory; label: string }>>> = {
  EXPENSE: [
    { value: FinancialCategory.COST_OF_SALES,    label: "Cost of Sales" },
    { value: FinancialCategory.DIRECT_EXPENSES,  label: "Direct Expenses" },
    { value: FinancialCategory.EXPENSES,         label: "Expenses" },
    { value: FinancialCategory.OTHER_EXPENSES,   label: "Other Expenses" },
  ],
  ASSET: [
    { value: FinancialCategory.CURRENT_ASSET,     label: "Current Asset" },
    { value: FinancialCategory.NON_CURRENT_ASSET, label: "Non-Current Asset" },
  ],
  LIABILITY: [
    { value: FinancialCategory.CURRENT_LIABILITY,     label: "Current Liability" },
    { value: FinancialCategory.NON_CURRENT_LIABILITY, label: "Non-Current Liability" },
  ],
};

const TYPE_LABELS: Partial<Record<AccountType, string>> = {
  EXPENSE:   "Expense Accounts",
  ASSET:     "Asset Accounts",
  LIABILITY: "Liability Accounts",
};

export type PendingAccount = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  financialCategory: FinancialCategory | null;
  migrationStatus: string;
};

type AccountState = {
  financialCategory: FinancialCategory | null;
  status: "idle" | "saving" | "saved" | "error";
};

export function ReclassifyForm({ initialAccounts }: { initialAccounts: PendingAccount[] }) {
  const router = useRouter();

  const [states, setStates] = useState<Record<string, AccountState>>(() =>
    Object.fromEntries(
      initialAccounts.map((a) => [
        a.id,
        { financialCategory: a.financialCategory, status: "idle" },
      ]),
    ),
  );

  const confirmedCount = Object.values(states).filter((s) => s.status === "saved").length;
  const total = initialAccounts.length;
  const allDone = confirmedCount === total;

  const save = useCallback(async (accountId: string, financialCategory: FinancialCategory) => {
    setStates((prev) => ({
      ...prev,
      [accountId]: { ...prev[accountId], financialCategory, status: "saving" },
    }));

    try {
      const res = await fetch("/api/accounting/coa/reclassify", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, financialCategory }),
      });
      if (!res.ok) throw new Error("Failed");
      setStates((prev) => ({
        ...prev,
        [accountId]: { ...prev[accountId], financialCategory, status: "saved" },
      }));
    } catch {
      setStates((prev) => ({
        ...prev,
        [accountId]: { ...prev[accountId], status: "error" },
      }));
    }
  }, []);

  const grouped = (Object.keys(OPTIONS) as AccountType[]).map((type) => ({
    type,
    label: TYPE_LABELS[type]!,
    accounts: initialAccounts.filter((a) => a.type === type),
    options: OPTIONS[type]!,
  })).filter((g) => g.accounts.length > 0);

  return (
    <div className="space-y-8">
      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm text-slate-600">
          <span>{confirmedCount} of {total} accounts reclassified</span>
          <span className="font-medium">{Math.round((confirmedCount / total) * 100)}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-slate-100">
          <div
            className="h-2 rounded-full bg-blue-600 transition-all duration-300"
            style={{ width: `${(confirmedCount / total) * 100}%` }}
          />
        </div>
      </div>

      {/* Account groups */}
      {grouped.map(({ type, label, accounts, options }) => (
        <div key={type} className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            {label} ({accounts.length})
          </h2>

          <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
            {accounts.map((account) => {
              const state = states[account.id];
              return (
                <div
                  key={account.id}
                  className="flex items-center gap-4 px-4 py-3"
                >
                  {/* Status dot */}
                  <div className={`h-2 w-2 flex-shrink-0 rounded-full ${
                    state.status === "saved"
                      ? "bg-green-500"
                      : state.status === "error"
                      ? "bg-red-500"
                      : state.status === "saving"
                      ? "bg-blue-400 animate-pulse"
                      : "bg-slate-300"
                  }`} />

                  {/* Account info */}
                  <div className="flex-1 min-w-0">
                    <span className="font-mono text-xs text-slate-500 mr-2">{account.code}</span>
                    <span className="text-sm text-slate-800 truncate">{account.name}</span>
                  </div>

                  {/* Dropdown */}
                  <select
                    className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700
                               focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
                               disabled:opacity-50 disabled:cursor-not-allowed"
                    value={state.financialCategory ?? ""}
                    disabled={state.status === "saving"}
                    onChange={(e) => {
                      const val = e.target.value as FinancialCategory;
                      if (val) save(account.id, val);
                    }}
                  >
                    <option value="" disabled>Select category…</option>
                    {options.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>

                  {state.status === "error" && (
                    <span className="text-xs text-red-500 flex-shrink-0">Save failed</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Complete Setup button */}
      <div className="flex items-center justify-between pt-4 border-t border-slate-200">
        <p className="text-sm text-slate-500">
          {allDone
            ? "All accounts reclassified — ready to proceed."
            : `${total - confirmedCount} account${total - confirmedCount !== 1 ? "s" : ""} remaining.`}
        </p>
        <button
          onClick={() => router.push("/")}
          disabled={!allDone}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white
                     hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed
                     transition-colors"
        >
          Complete Setup
        </button>
      </div>
    </div>
  );
}
