"use client";

/**
 * Shared line-items editor used by both "New Invoice" and "Edit Invoice" forms.
 *
 * Zoho-style layout:
 *   Item | Description | Qty | Rate | Discount | Tax | Amount
 *
 * - Amount column = net taxable amount = qty × rate − lineDiscount (before tax)
 * - Tax is shown ONLY in the totals block, grouped by name
 * - lineTotal stored in DB but NOT shown per-line in the editor
 * - Each line has a sub-row for selecting the income account
 */

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { cn, formatCurrency } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TaxRateOption {
  id:        string;
  name:      string;
  rate:      number;
  type:      string;
  isDefault: boolean;
}

export interface IncomeAccountOption {
  id:   string;
  code: string;
  name: string;
}

export interface LineItemData {
  id:              string;   // frontend key (crypto.randomUUID)
  itemId:          string;
  description:     string;
  quantity:        number;
  rate:            number;
  taxRateId:       string;   // "" = no tax
  discountType:    "PERCENT" | "FIXED";
  discountValue:   number;
  incomeAccountId: string;   // "" = use default resolved server-side
}

interface ItemOption {
  id:              string;
  itemCode:        string;
  name:            string;
  salesPrice:      number | null;
  type:            string;
  incomeAccountId: string | null;
}

interface Props {
  currency:               string;
  items:                  ItemOption[];
  taxRates:               TaxRateOption[];
  incomeAccounts:         IncomeAccountOption[];
  defaultIncomeAccountId: string;
  lines:                  LineItemData[];
  onChange:               (lines: LineItemData[]) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Net taxable amount = gross − discount (before tax). Shown in "Amount" column. */
export function computeLineAmount(line: LineItemData): number {
  const gross = line.quantity * line.rate;
  const disc =
    line.discountType === "FIXED"
      ? Math.min(Math.max(0, line.discountValue), gross)
      : (gross * Math.min(Math.max(0, line.discountValue), 100)) / 100;
  return gross - disc;
}

/** Tax amount for one line (applied on the taxable amount). */
export function computeLineTax(line: LineItemData, taxRates: TaxRateOption[]): number {
  const taxInfo = taxRates.find((t) => t.id === line.taxRateId);
  if (!taxInfo) return 0;
  return computeLineAmount(line) * taxInfo.rate / 100;
}

/** Grouped tax breakdown for the totals block. */
export function buildTaxBreakdown(
  lines:    LineItemData[],
  taxRates: TaxRateOption[],
): Array<{ label: string; amount: number }> {
  const map = new Map<string, number>();
  for (const line of lines) {
    const taxInfo = taxRates.find((t) => t.id === line.taxRateId);
    if (!taxInfo) continue;
    const taxAmt  = computeLineTax(line, taxRates);
    const label   = `${taxInfo.name} [${taxInfo.rate}%]`;
    map.set(label, (map.get(label) ?? 0) + taxAmt);
  }
  return Array.from(map.entries()).map(([label, amount]) => ({ label, amount }));
}

/** Default empty line for new rows. */
export function emptyLine(taxRates: TaxRateOption[], defaultIncomeAccountId?: string): LineItemData {
  const defaultVat = taxRates.find((t) => t.isDefault && t.type === "VAT") ?? taxRates.find((t) => t.type === "VAT");
  return {
    id:              crypto.randomUUID(),
    itemId:          "",
    description:     "",
    quantity:        1,
    rate:            0,
    taxRateId:       defaultVat?.id ?? "",
    discountType:    "PERCENT",
    discountValue:   0,
    incomeAccountId: defaultIncomeAccountId ?? "",
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function InvoiceLineItemsEditor({
  currency,
  items,
  taxRates,
  incomeAccounts,
  defaultIncomeAccountId,
  lines,
  onChange,
}: Props) {

  function updateLine(id: string, patch: Partial<LineItemData>) {
    onChange(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function handleItemSelect(lineId: string, itemId: string) {
    const item = items.find((i) => i.id === itemId);
    updateLine(lineId, {
      itemId,
      description:     item?.name ?? "",
      rate:            item?.salesPrice ?? 0,
      incomeAccountId: item?.incomeAccountId ?? defaultIncomeAccountId ?? "",
    });
  }

  function removeLine(id: string) {
    if (lines.length > 1) onChange(lines.filter((l) => l.id !== id));
  }

  function addLine() {
    onChange([...lines, emptyLine(taxRates, defaultIncomeAccountId)]);
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
      {/* Section header */}
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
        <span className="font-semibold text-slate-800 text-sm">
          Line Items
          <span className="ml-2 text-slate-400 font-normal text-xs">prices in {currency}</span>
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={addLine}
        >
          <Plus className="h-3.5 w-3.5" /> Add Line
        </Button>
      </div>

      {/* Column headers — 8-col grid */}
      <div
        className="grid gap-2 px-4 py-2 border-b border-slate-100 text-xs font-medium text-slate-500"
        style={{ gridTemplateColumns: "2fr 2fr 1fr 2fr 2fr 2fr 1fr 32px" }}
      >
        <div>Item</div>
        <div>Description <span className="text-red-400">*</span></div>
        <div className="text-center">Qty</div>
        <div>Rate ({currency})</div>
        <div>Discount</div>
        <div>Tax</div>
        <div className="text-right">Amount</div>
        <div />
      </div>

      {/* Line rows */}
      <div className="divide-y divide-slate-50">
        {lines.map((line) => {
          const lineItemName = line.itemId
            ? (items.find((i) => i.id === line.itemId)?.name ?? "Custom")
            : null;
          const taxLabel = line.taxRateId
            ? (taxRates.find((t) => t.id === line.taxRateId)
                ? `${taxRates.find((t) => t.id === line.taxRateId)!.name} [${taxRates.find((t) => t.id === line.taxRateId)!.rate}%]`
                : "")
            : "";
          const netAmount = computeLineAmount(line);

          const selectedAccount = incomeAccounts.find((a) => a.id === line.incomeAccountId);
          const accountLabel = selectedAccount
            ? `${selectedAccount.code} — ${selectedAccount.name}`
            : "";

          return (
            <div key={line.id}>
              {/* Main data row */}
              <div
                className="grid gap-2 px-4 py-3 items-center hover:bg-slate-50/50 transition-colors"
                style={{ gridTemplateColumns: "2fr 2fr 1fr 2fr 2fr 2fr 1fr 32px" }}
              >
                {/* Item */}
                <Select value={line.itemId} onValueChange={(v) => handleItemSelect(line.id, v ?? "")}>
                  <SelectTrigger className="h-8 text-xs w-full">
                    <span className={cn("flex-1 truncate text-left", !lineItemName && "text-muted-foreground")}>
                      {lineItemName ?? "Select item"}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Custom</SelectItem>
                    {items.map((i) => (
                      <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Description */}
                <Input
                  className="h-8 text-xs"
                  value={line.description}
                  onChange={(e) => updateLine(line.id, { description: e.target.value })}
                  placeholder="Description"
                />

                {/* Qty */}
                <Input
                  className="h-8 text-xs text-center"
                  type="number"
                  min="0"
                  step="0.01"
                  value={line.quantity}
                  onChange={(e) => updateLine(line.id, { quantity: parseFloat(e.target.value) || 0 })}
                />

                {/* Rate */}
                <Input
                  className="h-8 text-xs font-mono"
                  type="number"
                  min="0"
                  step="0.01"
                  value={line.rate}
                  onChange={(e) => updateLine(line.id, { rate: parseFloat(e.target.value) || 0 })}
                />

                {/* Discount — type toggle + value */}
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      updateLine(line.id, {
                        discountType: line.discountType === "PERCENT" ? "FIXED" : "PERCENT",
                        discountValue: 0,
                      })
                    }
                    className="h-8 w-8 flex-shrink-0 flex items-center justify-center rounded-md border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors select-none"
                    title={line.discountType === "PERCENT" ? "Switch to fixed amount" : "Switch to percentage"}
                  >
                    {line.discountType === "PERCENT" ? "%" : currency === "NGN" ? "₦" : "$"}
                  </button>
                  <Input
                    className="h-8 text-xs font-mono"
                    type="number"
                    min="0"
                    step="0.01"
                    max={line.discountType === "PERCENT" ? 100 : undefined}
                    value={line.discountValue}
                    onChange={(e) =>
                      updateLine(line.id, { discountValue: parseFloat(e.target.value) || 0 })
                    }
                    placeholder={line.discountType === "PERCENT" ? "0%" : "0.00"}
                  />
                </div>

                {/* Tax dropdown */}
                <Select
                  value={line.taxRateId}
                  onValueChange={(v) => updateLine(line.id, { taxRateId: v ?? "" })}
                >
                  <SelectTrigger className="h-8 text-xs w-full">
                    <span className={cn("flex-1 truncate text-left", !taxLabel && "text-muted-foreground")}>
                      {taxLabel || "— No Tax"}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">— No Tax</SelectItem>
                    {taxRates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} [{t.rate}%]
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Net taxable amount (before tax) */}
                <div className="text-right font-mono text-xs text-slate-600 tabular-nums">
                  {formatCurrency(netAmount, currency)}
                </div>

                {/* Delete */}
                <button
                  type="button"
                  className={cn(
                    "h-7 w-7 flex items-center justify-center rounded-md text-slate-300 transition-colors",
                    lines.length > 1
                      ? "hover:text-red-500 hover:bg-red-50 cursor-pointer"
                      : "opacity-30 cursor-not-allowed",
                  )}
                  onClick={() => removeLine(line.id)}
                  disabled={lines.length === 1}
                  aria-label="Remove line"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Income account sub-row */}
              <div
                className="grid gap-2 px-4 py-2 bg-slate-50/40 border-t border-dashed border-slate-100"
                style={{ gridTemplateColumns: "2fr 2fr 1fr 2fr 2fr 2fr 1fr 32px" }}
              >
                <div className="col-span-7 flex items-center gap-2">
                  <span className="text-xs text-slate-400 whitespace-nowrap">Account:</span>
                  <Select
                    value={line.incomeAccountId}
                    onValueChange={(v) => updateLine(line.id, { incomeAccountId: v ?? "" })}
                  >
                    <SelectTrigger className="h-7 text-xs flex-1">
                      <span className={cn("flex-1 truncate text-left", !accountLabel && "text-muted-foreground")}>
                        {accountLabel || "— Select account"}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">— Select account</SelectItem>
                      {incomeAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.code} — {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-slate-400 whitespace-nowrap hidden sm:block">
                    Revenue from this line will post to this income account when sent.
                  </span>
                </div>
                <div />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
