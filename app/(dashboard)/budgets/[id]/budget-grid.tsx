"use client";

import { useState, useTransition, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";
import { saveBudgetLines } from "../actions";
import { toast } from "sonner";

interface Account { id: string; code: string; name: string; type: string; }
interface AccountMeta { code: string; name: string; type: string; }

interface Props {
  budgetId: string;
  versionId: string;
  accounts: Account[];
  months: string[];          // YYYY-MM
  monthNames: string[];      // Jan-Dec
  initialLines: Record<string, Record<string, number>>; // accountId → { period → amount }
  accountMeta: Record<string, AccountMeta>;
  colTotals: number[];
  grandTotal: number;
  isEditable: boolean;
}

export function BudgetGrid({
  budgetId, versionId, accounts, months, monthNames,
  initialLines, accountMeta, colTotals: initColTotals, grandTotal: initGrandTotal, isEditable,
}: Props) {
  const [isPending, startTransition] = useTransition();

  // lines[accountId][period] = amount
  const [lines, setLines] = useState<Record<string, Record<string, number>>>(initialLines);
  const [addAccountId, setAddAccountId] = useState("");
  const [dirty, setDirty] = useState(false);

  const accountIds = Object.keys(lines);

  function setAmount(accountId: string, period: string, value: string) {
    const num = parseFloat(value) || 0;
    setLines((prev) => ({
      ...prev,
      [accountId]: { ...(prev[accountId] ?? {}), [period]: num },
    }));
    setDirty(true);
  }

  function addRow() {
    if (!addAccountId) return;
    if (lines[addAccountId]) { toast.info("Account already in grid"); return; }
    setLines((prev) => ({ ...prev, [addAccountId]: {} }));
    setAddAccountId("");
    setDirty(true);
  }

  function removeRow(accountId: string) {
    setLines((prev) => {
      const next = { ...prev };
      delete next[accountId];
      return next;
    });
    setDirty(true);
  }

  function fillRow(accountId: string, value: string) {
    const num = parseFloat(value) || 0;
    setLines((prev) => ({
      ...prev,
      [accountId]: Object.fromEntries(months.map((m) => [m, num])),
    }));
    setDirty(true);
  }

  const colTotals = months.map((m) =>
    accountIds.reduce((s, id) => s + (lines[id]?.[m] ?? 0), 0)
  );
  const grandTotal = colTotals.reduce((s, v) => s + v, 0);

  function handleSave() {
    const flatLines = accountIds.flatMap((accountId) =>
      months.map((period) => ({
        accountId,
        period,
        amount: lines[accountId]?.[period] ?? 0,
      }))
    );
    startTransition(async () => {
      const result = await saveBudgetLines(budgetId, versionId, flatLines);
      if ("error" in result) { toast.error(result.error); return; }
      toast.success("Budget saved");
      setDirty(false);
    });
  }

  const getMeta = (id: string): AccountMeta =>
    accountMeta[id] ?? accounts.find((a) => a.id === id) ?? { code: "?", name: "Unknown", type: "" };

  const availableAccounts = accounts.filter((a) => !lines[a.id]);

  return (
    <div className="space-y-3">
      {isEditable && (
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Add Account Row</label>
            <Select value={addAccountId} onValueChange={(v) => setAddAccountId(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="Search account..." />
              </SelectTrigger>
              <SelectContent>
                {availableAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="button" variant="outline" onClick={addRow} disabled={!addAccountId}>
            Add Row
          </Button>
          {dirty && (
            <Button type="button" onClick={handleSave} disabled={isPending}>
              {isPending ? "Saving..." : "Save Changes"}
            </Button>
          )}
        </div>
      )}

      <div className="rounded-lg border overflow-x-auto">
        <table className="text-sm min-w-max w-full">
          <thead className="bg-muted/50 sticky top-0">
            <tr>
              <th className="text-left p-2 font-medium min-w-[200px] sticky left-0 bg-muted/50">Account</th>
              {monthNames.map((m, i) => (
                <th key={i} className="text-right p-2 font-medium w-28">{m}</th>
              ))}
              <th className="text-right p-2 font-medium w-28 bg-muted/70">Total</th>
              {isEditable && <th className="p-2 w-20"></th>}
            </tr>
          </thead>
          <tbody>
            {accountIds.length === 0 && (
              <tr>
                <td colSpan={14} className="p-8 text-center text-muted-foreground">
                  No accounts added yet. Use the selector above to add budget rows.
                </td>
              </tr>
            )}
            {accountIds.map((accountId) => {
              const meta = getMeta(accountId);
              const rowTotal = months.reduce((s, m) => s + (lines[accountId]?.[m] ?? 0), 0);
              return (
                <tr key={accountId} className="border-t hover:bg-muted/20 group">
                  <td className="p-2 sticky left-0 bg-background group-hover:bg-muted/20">
                    <div>
                      <span className="font-mono text-xs text-muted-foreground">{meta.code}</span>
                      <span className="ml-2 text-sm">{meta.name}</span>
                    </div>
                    {isEditable && (
                      <div className="hidden group-hover:flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted-foreground">Fill all months:</span>
                        <Input
                          type="number"
                          className="h-5 w-24 text-xs"
                          placeholder="amount"
                          onBlur={(e) => { if (e.target.value) fillRow(accountId, e.target.value); }}
                        />
                      </div>
                    )}
                  </td>
                  {months.map((m) => (
                    <td key={m} className="p-1">
                      {isEditable ? (
                        <Input
                          type="number"
                          min="0"
                          step="1000"
                          className="h-7 text-xs text-right w-full"
                          value={lines[accountId]?.[m] || ""}
                          placeholder="0"
                          onChange={(e) => setAmount(accountId, m, e.target.value)}
                        />
                      ) : (
                        <span className="block text-right text-xs px-2">
                          {(lines[accountId]?.[m] ?? 0) > 0
                            ? (lines[accountId][m] / 1000).toFixed(0) + "k"
                            : ""}
                        </span>
                      )}
                    </td>
                  ))}
                  <td className="p-2 text-right font-medium bg-muted/20 text-xs">
                    {formatCurrency(rowTotal)}
                  </td>
                  {isEditable && (
                    <td className="p-2 text-center">
                      <button
                        type="button"
                        onClick={() => removeRow(accountId)}
                        className="text-muted-foreground hover:text-red-500 text-xs"
                      >
                        ×
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t-2 bg-muted/40 font-semibold">
            <tr>
              <td className="p-2 sticky left-0 bg-muted/40">Total</td>
              {colTotals.map((t, i) => (
                <td key={i} className="p-2 text-right text-xs">{formatCurrency(t)}</td>
              ))}
              <td className="p-2 text-right bg-muted/60">{formatCurrency(grandTotal)}</td>
              {isEditable && <td />}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
