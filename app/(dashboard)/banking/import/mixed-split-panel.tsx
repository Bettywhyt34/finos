"use client";

import { Plus, Split, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, formatCurrency } from "@/lib/utils";

export type SplitAllocationKind = "ACCOUNT" | "CUSTOMER" | "VENDOR";

export interface StatementSplitLine {
  id: string;
  targetId: string;
  amount: number;
  kind?: SplitAllocationKind;
  entityId?: string;
  whtAmount?: number;
}

interface AccountOption {
  id: string;
  code: string;
  name: string;
}

interface CustomerOption {
  id: string;
  companyName: string;
  invoices: Array<{
    id: string;
    number: string;
    currency: string;
    outstanding: number;
  }>;
}

interface VendorOption {
  id: string;
  companyName: string;
  bills: Array<{
    id: string;
    number: string;
    currency: string;
    outstanding: number;
  }>;
}

function money(value: number, currency: string) {
  return formatCurrency(value, currency);
}

function normaliseLine(line: StatementSplitLine): Required<StatementSplitLine> {
  return {
    ...line,
    kind: line.kind ?? "ACCOUNT",
    entityId: line.entityId ?? "",
    whtAmount: Number(line.whtAmount ?? 0),
  };
}

export function MixedSplitPanel({
  direction,
  amount,
  currency,
  allocations,
  accounts,
  customers,
  vendors,
  onChange,
}: {
  direction: "CREDIT" | "DEBIT";
  amount: number;
  currency: string;
  allocations: StatementSplitLine[];
  accounts: AccountOption[];
  customers: CustomerOption[];
  vendors: VendorOption[];
  onChange: (allocations: StatementSplitLine[]) => void;
}) {
  const lines = allocations.map(normaliseLine);
  const allowedSubledger: SplitAllocationKind = direction === "CREDIT" ? "CUSTOMER" : "VENDOR";
  const allocatedCash = lines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
  const totalWht = lines.reduce(
    (sum, line) => sum + (line.kind === "ACCOUNT" ? 0 : Number(line.whtAmount || 0)),
    0,
  );
  const remaining = Math.round((amount - allocatedCash) * 100) / 100;

  function patchLine(id: string, patch: Partial<StatementSplitLine>) {
    onChange(lines.map((line) => line.id === id ? { ...line, ...patch } : line));
  }

  function chooseKind(id: string, kind: SplitAllocationKind) {
    patchLine(id, {
      kind,
      entityId: "",
      targetId: "",
      whtAmount: 0,
    });
  }

  function addLine() {
    onChange([
      ...lines,
      {
        id: `split-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        kind: "ACCOUNT",
        entityId: "",
        targetId: "",
        amount: 0,
        whtAmount: 0,
      },
    ]);
  }

  function removeLine(id: string) {
    onChange(lines.filter((line) => line.id !== id));
  }

  return (
    <div className="mt-3 rounded-lg border border-[var(--app-border)] bg-[var(--surface-muted)] p-3">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-primary)]">
            <Split className="h-3.5 w-3.5" />
            Split {money(amount, currency)}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
            {direction === "CREDIT"
              ? "Allocate this Money In row across accounts and customer invoices in one Split."
              : "Allocate this Money Out row across accounts and vendor bills in one Split."}
          </p>
        </div>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={addLine}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add line
        </Button>
      </div>

      <div className="space-y-2">
        {lines.map((line) => {
          const customer = line.kind === "CUSTOMER"
            ? customers.find((item) => item.id === line.entityId)
            : null;
          const vendor = line.kind === "VENDOR"
            ? vendors.find((item) => item.id === line.entityId)
            : null;

          return (
            <div
              key={line.id}
              className="grid gap-2 rounded-md border border-[var(--app-border)] bg-white p-2 lg:grid-cols-[120px_minmax(150px,0.9fr)_minmax(170px,1fr)_115px_105px_28px]"
            >
              <select
                value={line.kind}
                onChange={(event) => chooseKind(line.id, event.target.value as SplitAllocationKind)}
                className="h-8 rounded-md border border-[var(--app-border)] bg-white px-2 text-xs"
              >
                <option value="ACCOUNT">Account</option>
                <option value={allowedSubledger}>
                  {allowedSubledger === "CUSTOMER" ? "Customer" : "Vendor"}
                </option>
              </select>

              {line.kind === "ACCOUNT" ? (
                <>
                  <select
                    value={line.targetId}
                    onChange={(event) => patchLine(line.id, { targetId: event.target.value })}
                    className="h-8 rounded-md border border-[var(--app-border)] bg-white px-2 text-xs lg:col-span-2"
                  >
                    <option value="">Choose account…</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.code} · {account.name}
                      </option>
                    ))}
                  </select>
                </>
              ) : line.kind === "CUSTOMER" ? (
                <>
                  <select
                    value={line.entityId}
                    onChange={(event) => patchLine(line.id, { entityId: event.target.value, targetId: "" })}
                    className="h-8 rounded-md border border-[var(--app-border)] bg-white px-2 text-xs"
                  >
                    <option value="">Choose customer…</option>
                    {customers
                      .filter((item) => item.invoices.some((invoice) => invoice.currency === currency))
                      .map((item) => (
                        <option key={item.id} value={item.id}>{item.companyName}</option>
                      ))}
                  </select>
                  <select
                    value={line.targetId}
                    onChange={(event) => patchLine(line.id, { targetId: event.target.value })}
                    className="h-8 rounded-md border border-[var(--app-border)] bg-white px-2 text-xs"
                  >
                    <option value="">Choose invoice…</option>
                    {(customer?.invoices ?? [])
                      .filter((invoice) => invoice.currency === currency)
                      .map((invoice) => (
                        <option key={invoice.id} value={invoice.id}>
                          {invoice.number} · Due {money(invoice.outstanding, currency)}
                        </option>
                      ))}
                  </select>
                </>
              ) : (
                <>
                  <select
                    value={line.entityId}
                    onChange={(event) => patchLine(line.id, { entityId: event.target.value, targetId: "" })}
                    className="h-8 rounded-md border border-[var(--app-border)] bg-white px-2 text-xs"
                  >
                    <option value="">Choose vendor…</option>
                    {vendors
                      .filter((item) => item.bills.some((bill) => bill.currency === currency))
                      .map((item) => (
                        <option key={item.id} value={item.id}>{item.companyName}</option>
                      ))}
                  </select>
                  <select
                    value={line.targetId}
                    onChange={(event) => patchLine(line.id, { targetId: event.target.value })}
                    className="h-8 rounded-md border border-[var(--app-border)] bg-white px-2 text-xs"
                  >
                    <option value="">Choose bill…</option>
                    {(vendor?.bills ?? [])
                      .filter((bill) => bill.currency === currency)
                      .map((bill) => (
                        <option key={bill.id} value={bill.id}>
                          {bill.number} · Due {money(bill.outstanding, currency)}
                        </option>
                      ))}
                  </select>
                </>
              )}

              <Input
                type="number"
                min="0"
                step="0.01"
                value={line.amount || ""}
                onChange={(event) => patchLine(line.id, { amount: Number(event.target.value) })}
                className="h-8 text-right text-xs"
                placeholder="Bank amount"
              />

              {line.kind === "ACCOUNT" ? (
                <div className="flex h-8 items-center justify-end px-2 text-[11px] text-[var(--text-secondary)]">
                  —
                </div>
              ) : (
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={line.whtAmount || ""}
                  onChange={(event) => patchLine(line.id, { whtAmount: Number(event.target.value) })}
                  className="h-8 text-right text-xs"
                  placeholder="WHT"
                  title="WHT amount"
                />
              )}

              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => removeLine(line.id)}
                aria-label="Remove split line"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-end gap-x-5 gap-y-1 text-[11px]">
        {totalWht > 0 ? (
          <span className="text-[var(--text-secondary)]">
            WHT settlement + {money(totalWht, currency)}
          </span>
        ) : null}
        <span
          className={cn(
            "font-medium",
            Math.abs(remaining) <= 0.01 ? "text-emerald-700" : "text-amber-700",
          )}
        >
          Bank allocated {money(allocatedCash, currency)} / {money(amount, currency)}
          {Math.abs(remaining) > 0.01
            ? ` · ${remaining > 0 ? "Remaining" : "Over"} ${money(Math.abs(remaining), currency)}`
            : ""}
        </span>
      </div>

      <p className="mt-1 text-right text-[10px] text-[var(--text-secondary)]">
        WHT settles the selected invoice or bill but does not increase the bank amount.
      </p>
    </div>
  );
}
