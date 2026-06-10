"use client";

/**
 * OpeningBalancesClient
 * Full interactive Opening Balances UI for /settings/setup-configurations/opening-balances
 *
 * Features:
 *  - Empty state with "Set Opening Balances" CTA
 *  - Summary cards (Total Debit, Total Credit, Difference, Balance status)
 *  - Grouped table by account category
 *  - Clickable drilldown for Accounts Receivable, Accounts Payable, Bank/Cash
 *  - Edit drawer (new or edit DRAFT)
 *  - Delete confirmation
 *  - Finalise with accounting validation
 *  - Warning when transactions already exist
 */

import { useState, useMemo, useCallback, useId } from "react";
import { useRouter }                from "next/navigation";
import Link                         from "next/link";
import { toast }                    from "sonner";
import {
  AlertTriangle,
  Plus,
  Trash2,
  Pencil,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Lock,
  X,
  ExternalLink,
} from "lucide-react";
import { cn }                       from "@/lib/utils";
import type {
  OpeningBalanceBatchRow,
  OpeningBalanceLineRow,
  OpeningBalanceSummary,
} from "@/lib/setup-configurations/service";

// ─── Types ────────────────────────────────────────────────────────────────────

type CoaAccount  = { id: string; code: string; name: string; type: string; subtype: string | null };
type Customer    = { id: string; companyName: string; currency: string };
type Vendor      = { id: string; companyName: string; currency: string };
type BankAccount = { id: string; accountName: string; bankName: string; currency: string };

interface Props {
  initialBatch:              OpeningBalanceBatchRow | null;
  tenantCurrency:            string;
  coaAccounts:               CoaAccount[];
  customers:                 Customer[];
  vendors:                   Vendor[];
  bankAccounts:              BankAccount[];
  existingTransactionCount:  number;
}

type DraftLine = {
  _key:            string;
  id?:             string;   // real DB id if this line already exists
  lineType:        string;
  accountId:       string;
  customerId:      string;
  vendorId:        string;
  bankAccountId:   string;
  label:           string;
  accountCategory: string;
  currency:        string;
  exchangeRate:    string;
  debit:           string;
  credit:          string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const ACCOUNT_CATEGORIES = [
  "Asset",
  "Accounts Receivable",
  "Bank/Cash",
  "Liability",
  "Accounts Payable",
  "Equity",
  "Income",
  "Expense",
  "Other",
];

const CATEGORY_ORDER = [
  "Asset",
  "Accounts Receivable",
  "Bank/Cash",
  "Liability",
  "Accounts Payable",
  "Equity",
  "Income",
  "Expense",
];

const DRILLABLE_CATEGORIES = new Set([
  "Accounts Receivable",
  "Accounts Payable",
  "Bank/Cash",
]);

function slugify(cat: string): string {
  return cat.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en", {
      style:                 "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day:   "2-digit",
      month: "long",
      year:  "numeric",
    });
  } catch {
    return iso;
  }
}

function toDateInputValue(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

function computeSummary(
  lines: Pick<OpeningBalanceLineRow, "debit" | "credit">[],
): OpeningBalanceSummary {
  const totalDebit  = lines.reduce((s, l) => s + l.debit,  0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  const difference  = Math.abs(totalDebit - totalCredit);
  return { totalDebit, totalCredit, difference, isBalanced: difference < 0.005 };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function OpeningBalancesClient({
  initialBatch,
  tenantCurrency,
  coaAccounts,
  customers,
  vendors,
  bankAccounts,
  existingTransactionCount,
}: Props) {
  const router      = useRouter();
  const uid         = useId();

  const [batch,      setBatch]      = useState<OpeningBalanceBatchRow | null>(initialBatch);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [delOpen,    setDelOpen]    = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [finalising, setFinalising] = useState(false);
  const [serverErr,  setServerErr]  = useState<string | null>(null);
  const [delErr,     setDelErr]     = useState<string | null>(null);

  // ── Drawer form state ──────────────────────────────────────────────────────

  const [migDate,  setMigDate]  = useState("");
  const [notes,    setNotes]    = useState("");
  const [lines,    setLines]    = useState<DraftLine[]>([]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  function newDraftLine(): DraftLine {
    return {
      _key:            `${uid}-${Date.now()}-${Math.random()}`,
      lineType:        "ACCOUNT",
      accountId:       "",
      customerId:      "",
      vendorId:        "",
      bankAccountId:   "",
      label:           "",
      accountCategory: "",
      currency:        tenantCurrency,
      exchangeRate:    "1",
      debit:           "",
      credit:          "",
    };
  }

  function openNew() {
    setMigDate("");
    setNotes("");
    setLines([newDraftLine()]);
    setServerErr(null);
    setDrawerOpen(true);
  }

  function openEdit() {
    if (!batch) return;
    setMigDate(toDateInputValue(batch.migrationDate));
    setNotes(batch.notes ?? "");
    setLines(
      batch.lines.map((l) => ({
        _key:            `${uid}-${l.id}`,
        id:              l.id,
        lineType:        l.lineType,
        accountId:       l.accountId    ?? "",
        customerId:      l.customerId   ?? "",
        vendorId:        l.vendorId     ?? "",
        bankAccountId:   l.bankAccountId ?? "",
        label:           l.label,
        accountCategory: l.accountCategory ?? "",
        currency:        l.currency,
        exchangeRate:    String(l.exchangeRate),
        debit:           l.debit  > 0 ? String(l.debit)  : "",
        credit:          l.credit > 0 ? String(l.credit) : "",
      })),
    );
    setServerErr(null);
    setDrawerOpen(true);
  }

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((prev) =>
      prev.map((l) => (l._key === key ? { ...l, ...patch } : l)),
    );
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l._key !== key));
  }

  function addLine() {
    setLines((prev) => [...prev, newDraftLine()]);
  }

  /** Auto-fill label from entity selector */
  function handleLineTypeChange(key: string, lineType: string) {
    updateLine(key, {
      lineType,
      accountId:     "",
      customerId:    "",
      vendorId:      "",
      bankAccountId: "",
      label:         "",
      // Suggest category based on line type
      accountCategory:
        lineType === "CUSTOMER"  ? "Accounts Receivable" :
        lineType === "VENDOR"    ? "Accounts Payable"    :
        lineType === "BANK"      ? "Bank/Cash"           : "",
    });
  }

  function handleAccountSelect(key: string, accountId: string) {
    const acct = coaAccounts.find((a) => a.id === accountId);
    if (!acct) { updateLine(key, { accountId: "", label: "" }); return; }
    updateLine(key, {
      accountId,
      label:           acct.name,
      accountCategory: mapCoaTypeToCategory(acct.type, acct.subtype),
    });
  }

  function handleCustomerSelect(key: string, customerId: string) {
    const c = customers.find((x) => x.id === customerId);
    updateLine(key, {
      customerId,
      label:    c?.companyName ?? "",
      currency: c?.currency ?? tenantCurrency,
    });
  }

  function handleVendorSelect(key: string, vendorId: string) {
    const v = vendors.find((x) => x.id === vendorId);
    updateLine(key, {
      vendorId,
      label:    v?.companyName ?? "",
      currency: v?.currency ?? tenantCurrency,
    });
  }

  function handleBankSelect(key: string, bankAccountId: string) {
    const b = bankAccounts.find((x) => x.id === bankAccountId);
    updateLine(key, {
      bankAccountId,
      label:    b ? `${b.accountName} (${b.bankName})` : "",
      currency: b?.currency ?? tenantCurrency,
    });
  }

  // ── Summary (live, computed from drawer lines) ─────────────────────────────

  const draftSummary = useMemo<OpeningBalanceSummary>(() => {
    return computeSummary(
      lines.map((l) => ({
        debit:  parseFloat(l.debit)  || 0,
        credit: parseFloat(l.credit) || 0,
      })),
    );
  }, [lines]);

  // ── Grouped display ────────────────────────────────────────────────────────

  const grouped = useMemo(() => {
    if (!batch) return [];
    const map = new Map<string, OpeningBalanceLineRow[]>();
    for (const line of batch.lines) {
      const cat = line.accountCategory ?? "Other";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(line);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      const ai = CATEGORY_ORDER.indexOf(a);
      const bi = CATEGORY_ORDER.indexOf(b);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
  }, [batch]);

  const displaySummary = useMemo(() => {
    if (!batch) return null;
    return computeSummary(batch.lines);
  }, [batch]);

  // ── Save Draft ─────────────────────────────────────────────────────────────
  // Returns the saved batchId, or null on failure.

  const saveDraft = useCallback(async (
    opts: { closeOnSuccess?: boolean } = { closeOnSuccess: true },
  ): Promise<string | null> => {
    if (!migDate) { setServerErr("Migration date is required."); return null; }
    setServerErr(null);
    setSaving(true);

    try {
      let currentBatch = batch;

      // 1. Create or update the batch header
      if (!currentBatch) {
        const res = await fetch(
          "/api/settings/setup-configurations/opening-balances",
          {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ migrationDate: migDate, notes }),
          },
        );
        const json = await res.json();
        if (!res.ok) { setServerErr(json.error ?? "Failed to create opening balance."); return null; }
        currentBatch = json.data;
      } else {
        const res = await fetch(
          `/api/settings/setup-configurations/opening-balances/${currentBatch.id}`,
          {
            method:  "PATCH",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ migrationDate: migDate, notes }),
          },
        );
        const json = await res.json();
        if (!res.ok) { setServerErr(json.error ?? "Failed to update opening balance."); return null; }
        currentBatch = json.data;
      }

      // 2. Reconcile lines: delete removed, add new, update changed
      const existingIds = new Set((batch?.lines ?? []).map((l) => l.id));
      const draftIds    = new Set(lines.filter((l) => l.id).map((l) => l.id!));

      // Delete lines that were removed from the drawer
      for (const existing of batch?.lines ?? []) {
        if (!draftIds.has(existing.id)) {
          await fetch(
            `/api/settings/setup-configurations/opening-balances/${currentBatch!.id}/lines/${existing.id}`,
            { method: "DELETE" },
          );
        }
      }

      // Upsert lines
      for (const line of lines) {
        const payload = {
          lineType:        line.lineType,
          accountId:       line.accountId   || null,
          customerId:      line.customerId  || null,
          vendorId:        line.vendorId    || null,
          bankAccountId:   line.bankAccountId || null,
          label:           line.label,
          accountCategory: line.accountCategory || null,
          currency:        line.currency,
          exchangeRate:    parseFloat(line.exchangeRate) || 1,
          debit:           parseFloat(line.debit)  || 0,
          credit:          parseFloat(line.credit) || 0,
        };

        if (line.id && existingIds.has(line.id)) {
          await fetch(
            `/api/settings/setup-configurations/opening-balances/${currentBatch!.id}/lines/${line.id}`,
            {
              method:  "PATCH",
              headers: { "Content-Type": "application/json" },
              body:    JSON.stringify(payload),
            },
          );
        } else {
          await fetch(
            `/api/settings/setup-configurations/opening-balances/${currentBatch!.id}/lines`,
            {
              method:  "POST",
              headers: { "Content-Type": "application/json" },
              body:    JSON.stringify(payload),
            },
          );
        }
      }

      if (opts.closeOnSuccess) {
        toast.success("Opening balance saved as draft.");
        setDrawerOpen(false);
        router.refresh();
      }
      return currentBatch!.id as string;
    } catch {
      setServerErr("An unexpected error occurred. Please try again.");
      return null;
    } finally {
      setSaving(false);
    }
  }, [batch, migDate, notes, lines, router]);

  // ── Finalise ───────────────────────────────────────────────────────────────
  // Finalise directly (called after the batch already exists in DB).
  const finalise = useCallback(async (batchId: string) => {
    setServerErr(null);
    setFinalising(true);
    try {
      const res = await fetch(
        `/api/settings/setup-configurations/opening-balances/${batchId}/finalise`,
        { method: "POST" },
      );
      const json = await res.json();
      if (!res.ok) {
        setServerErr(json.error ?? "Finalisation failed.");
        return;
      }
      toast.success("Opening balances finalised and posted to the ledger.");
      setDrawerOpen(false);
      router.refresh();
    } catch {
      setServerErr("An unexpected error occurred during finalisation.");
    } finally {
      setFinalising(false);
    }
  }, [router]);

  // ── Delete ─────────────────────────────────────────────────────────────────

  const confirmDelete = useCallback(async () => {
    if (!batch) return;
    setDelErr(null);
    try {
      const res = await fetch(
        `/api/settings/setup-configurations/opening-balances/${batch.id}`,
        { method: "DELETE" },
      );
      const json = await res.json();
      if (!res.ok) { setDelErr(json.error ?? "Failed to delete."); return; }
      toast.success("Opening balance deleted.");
      setDelOpen(false);
      setBatch(null);
      router.refresh();
    } catch {
      setDelErr("An unexpected error occurred.");
    }
  }, [batch, router]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="relative h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 py-8 pb-24">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Opening Balances</h1>
            <p className="mt-1 text-sm text-slate-500 max-w-xl">
              Set the starting financial position of your organisation before recording
              live transactions in FINOS.
            </p>
          </div>
          {batch?.status === "DRAFT" && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setDelOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
              <button
                type="button"
                onClick={openEdit}
                className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium bg-[var(--finos-accent)] text-white rounded-lg hover:opacity-90 transition-opacity"
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </button>
            </div>
          )}
        </div>

        {/* ── Transactions warning ────────────────────────────────────────── */}
        {existingTransactionCount > 0 && !batch && (
          <div className="mb-5 flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
            <span>
              <strong>Note:</strong> {existingTransactionCount.toLocaleString()} transaction
              {existingTransactionCount !== 1 ? "s" : ""} already exist in this organisation.
              Opening balances should normally be set before recording live transactions.
              Changing opening balances now may affect your reports.
            </span>
          </div>
        )}

        {/* ── No opening balance ──────────────────────────────────────────── */}
        {!batch ? (
          <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed border-slate-200 rounded-xl bg-slate-50">
            <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mb-4">
              <svg className="h-6 w-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M4 19h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-slate-800 mb-1">
              No opening balances set
            </h3>
            <p className="text-sm text-slate-500 max-w-sm mb-6">
              Enter your migration date and opening account balances to start your
              accounting records correctly in FINOS.
            </p>
            <button
              type="button"
              onClick={openNew}
              className="flex items-center gap-2 px-5 py-2.5 bg-[var(--finos-accent)] text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
            >
              <Plus className="h-4 w-4" />
              Set Opening Balances
            </button>
          </div>
        ) : (
          <>
            {/* ── Batch meta ───────────────────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-6 p-4 bg-white border border-slate-200 rounded-xl">
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">Migration Date</p>
                <p className="text-sm font-medium text-slate-800">{formatDate(batch.migrationDate)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">Status</p>
                <StatusBadge status={batch.status} />
              </div>
              {batch.notes && (
                <div className="flex-1 min-w-[200px]">
                  <p className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">Notes</p>
                  <p className="text-sm text-slate-600">{batch.notes}</p>
                </div>
              )}
              {batch.journalEntryId && (
                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">Journal Entry</p>
                  <Link
                    href={`/accounting/journal-entries`}
                    className="text-sm text-[var(--finos-accent)] hover:underline flex items-center gap-1"
                  >
                    View entry <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              )}
            </div>

            {/* ── Summary cards ─────────────────────────────────────────── */}
            {displaySummary && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                <SummaryCard
                  label="Total Debit"
                  value={formatCurrency(displaySummary.totalDebit, tenantCurrency)}
                  color="blue"
                />
                <SummaryCard
                  label="Total Credit"
                  value={formatCurrency(displaySummary.totalCredit, tenantCurrency)}
                  color="purple"
                />
                <SummaryCard
                  label="Difference"
                  value={formatCurrency(displaySummary.difference, tenantCurrency)}
                  color={displaySummary.isBalanced ? "green" : "red"}
                />
                <div className={cn(
                  "rounded-xl border p-4 flex flex-col gap-1",
                  displaySummary.isBalanced
                    ? "border-green-200 bg-green-50"
                    : "border-red-200 bg-red-50",
                )}>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Balance</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {displaySummary.isBalanced
                      ? <CheckCircle2 className="h-4 w-4 text-green-600" />
                      : <XCircle      className="h-4 w-4 text-red-500" />
                    }
                    <span className={cn(
                      "text-sm font-semibold",
                      displaySummary.isBalanced ? "text-green-700" : "text-red-600",
                    )}>
                      {displaySummary.isBalanced ? "Balanced" : "Unbalanced"}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* ── Lines table ───────────────────────────────────────────── */}
            {batch.lines.length === 0 ? (
              <div className="p-6 text-center border border-dashed border-slate-200 rounded-xl text-sm text-slate-400">
                No lines entered yet.{batch.status === "DRAFT" && " Click Edit to add account balances."}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">
                        Accounts
                      </th>
                      <th className="text-right px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide w-40">
                        Debit
                      </th>
                      <th className="text-right px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide w-40">
                        Credit
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped.map(([category, catLines]) => (
                      <>
                        {/* Category header */}
                        <tr
                          key={`cat-${category}`}
                          className="bg-slate-50/70 border-t border-slate-100"
                        >
                          <td
                            colSpan={3}
                            className="px-4 py-2"
                          >
                            {DRILLABLE_CATEGORIES.has(category) ? (
                              <Link
                                href={`/settings/setup-configurations/opening-balances/account/${slugify(category)}`}
                                className="flex items-center gap-1 text-xs font-semibold text-slate-700 uppercase tracking-wide hover:text-[var(--finos-accent)] transition-colors"
                              >
                                {category}
                                <ChevronRight className="h-3 w-3" />
                              </Link>
                            ) : (
                              <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                                {category}
                              </span>
                            )}
                          </td>
                        </tr>

                        {/* Lines within category */}
                        {catLines.map((line) => (
                          <tr
                            key={line.id}
                            className="border-t border-slate-100 hover:bg-slate-50/50 transition-colors"
                          >
                            <td className="px-4 py-2.5 pl-8 text-slate-700">
                              {line.label}
                              {line.currency !== tenantCurrency && (
                                <span className="ml-2 text-xs text-slate-400">
                                  {line.currency} × {line.exchangeRate}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                              {line.debit > 0
                                ? formatCurrency(line.debit, tenantCurrency)
                                : <span className="text-slate-300">—</span>}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                              {line.credit > 0
                                ? formatCurrency(line.credit, tenantCurrency)
                                : <span className="text-slate-300">—</span>}
                            </td>
                          </tr>
                        ))}
                      </>
                    ))}

                    {/* Totals row */}
                    <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                      <td className="px-4 py-3 text-slate-900 text-xs uppercase tracking-wide">
                        Total
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-900">
                        {formatCurrency(displaySummary?.totalDebit ?? 0, tenantCurrency)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-900">
                        {formatCurrency(displaySummary?.totalCredit ?? 0, tenantCurrency)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* ── Finalise CTA (when DRAFT) ─────────────────────────────── */}
            {batch.status === "DRAFT" && displaySummary && (
              <div className="mt-6 flex items-center gap-4 p-4 bg-white border border-slate-200 rounded-xl">
                {displaySummary.isBalanced ? (
                  <>
                    <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
                    <p className="text-sm text-slate-700 flex-1">
                      Opening balances are balanced and ready to finalise.
                      Finalising will post a locked opening journal entry to the ledger.
                    </p>
                    <button
                      type="button"
                      onClick={() => batch && finalise(batch.id)}
                      disabled={finalising}
                      className="px-4 py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors shrink-0"
                    >
                      <Lock className="inline h-3.5 w-3.5 mr-1.5" />
                      {finalising ? "Finalising…" : "Finalise"}
                    </button>
                  </>
                ) : (
                  <>
                    <XCircle className="h-5 w-5 text-red-500 shrink-0" />
                    <p className="text-sm text-slate-600 flex-1">
                      Opening balances must be balanced before they can be finalised.
                      Difference: <strong>{formatCurrency(displaySummary.difference, tenantCurrency)}</strong>
                    </p>
                  </>
                )}
              </div>
            )}

            {/* Finalised notice */}
            {batch.status === "FINALISED" && (
              <div className="mt-6 flex items-start gap-3 p-4 bg-green-50 border border-green-200 rounded-xl">
                <Lock className="h-4 w-4 text-green-700 mt-0.5 shrink-0" />
                <p className="text-sm text-green-800">
                  These opening balances have been finalised and an opening journal entry posted
                  to the ledger. They are now read-only.
                  To make corrections, reverse the opening journal entry from the Journal Entries module.
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Edit Drawer ──────────────────────────────────────────────────────── */}
      {drawerOpen && (
        <EditDrawer
          batch={batch}
          migDate={migDate}
          notes={notes}
          lines={lines}
          coaAccounts={coaAccounts}
          customers={customers}
          vendors={vendors}
          bankAccounts={bankAccounts}
          tenantCurrency={tenantCurrency}
          draftSummary={draftSummary}
          saving={saving}
          finalising={finalising}
          serverErr={serverErr}
          onMigDateChange={setMigDate}
          onNotesChange={setNotes}
          onLineTypeChange={handleLineTypeChange}
          onAccountSelect={handleAccountSelect}
          onCustomerSelect={handleCustomerSelect}
          onVendorSelect={handleVendorSelect}
          onBankSelect={handleBankSelect}
          onUpdateLine={updateLine}
          onRemoveLine={removeLine}
          onAddLine={addLine}
          onSaveDraft={saveDraft}
          onFinalise={finalise}
          onClose={() => setDrawerOpen(false)}
        />
      )}

      {/* ── Delete Confirmation ───────────────────────────────────────────────── */}
      {delOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setDelOpen(false)}
          />
          <div className="relative bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-base font-semibold text-slate-900 mb-2">Delete Opening Balance?</h3>
            <p className="text-sm text-slate-600 mb-4">
              This will permanently delete the draft opening balance and all its lines.
              This action cannot be undone.
            </p>
            {delErr && (
              <p className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {delErr}
              </p>
            )}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => { setDelOpen(false); setDelErr(null); }}
                className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: "DRAFT" | "FINALISED" }) {
  return (
    <span className={cn(
      "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
      status === "DRAFT"
        ? "bg-amber-100 text-amber-800"
        : "bg-green-100 text-green-800",
    )}>
      {status === "DRAFT" ? "Draft" : "Finalised"}
    </span>
  );
}

function SummaryCard({
  label, value, color,
}: {
  label: string;
  value: string;
  color: "blue" | "purple" | "green" | "red";
}) {
  const colors = {
    blue:   "border-blue-200   bg-blue-50",
    purple: "border-purple-200 bg-purple-50",
    green:  "border-green-200  bg-green-50",
    red:    "border-red-200    bg-red-50",
  };
  const textColors = {
    blue:   "text-blue-900",
    purple: "text-purple-900",
    green:  "text-green-900",
    red:    "text-red-900",
  };
  return (
    <div className={cn("rounded-xl border p-4", colors[color])}>
      <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">{label}</p>
      <p className={cn("text-base font-semibold tabular-nums", textColors[color])}>{value}</p>
    </div>
  );
}

// ─── Edit Drawer ──────────────────────────────────────────────────────────────

function mapCoaTypeToCategory(type: string, subtype: string | null): string {
  const sub = (subtype ?? "").toLowerCase();
  if (sub.includes("receivable"))   return "Accounts Receivable";
  if (sub.includes("payable"))      return "Accounts Payable";
  if (sub.includes("bank") || sub.includes("cash")) return "Bank/Cash";
  switch (type) {
    case "ASSET":     return "Asset";
    case "LIABILITY": return "Liability";
    case "EQUITY":    return "Equity";
    case "INCOME":    return "Income";
    case "EXPENSE":   return "Expense";
    default:          return "";
  }
}

interface DrawerProps {
  batch:           OpeningBalanceBatchRow | null;
  migDate:         string;
  notes:           string;
  lines:           DraftLine[];
  coaAccounts:     CoaAccount[];
  customers:       Customer[];
  vendors:         Vendor[];
  bankAccounts:    BankAccount[];
  tenantCurrency:  string;
  draftSummary:    OpeningBalanceSummary;
  saving:          boolean;
  finalising:      boolean;
  serverErr:       string | null;
  onMigDateChange: (v: string) => void;
  onNotesChange:   (v: string) => void;
  onLineTypeChange: (key: string, t: string) => void;
  onAccountSelect:  (key: string, id: string) => void;
  onCustomerSelect: (key: string, id: string) => void;
  onVendorSelect:   (key: string, id: string) => void;
  onBankSelect:     (key: string, id: string) => void;
  onUpdateLine:    (key: string, patch: Partial<DraftLine>) => void;
  onRemoveLine:    (key: string) => void;
  onAddLine:       () => void;
  onSaveDraft:     (opts?: { closeOnSuccess?: boolean }) => Promise<string | null>;
  onFinalise:      (batchId: string) => void;
  onClose:         () => void;
}

function EditDrawer({
  batch, migDate, notes, lines, coaAccounts, customers, vendors, bankAccounts,
  tenantCurrency, draftSummary, saving, finalising, serverErr,
  onMigDateChange, onNotesChange, onLineTypeChange,
  onAccountSelect, onCustomerSelect, onVendorSelect, onBankSelect,
  onUpdateLine, onRemoveLine, onAddLine, onSaveDraft, onFinalise, onClose,
}: DrawerProps) {

  const isEditingExisting = !!batch;

  function formatDrawerCurrency(amount: number) {
    return new Intl.NumberFormat("en", {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(amount);
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <aside className="fixed right-0 top-0 h-full w-full max-w-3xl bg-white shadow-2xl z-50 flex flex-col">
        {/* Drawer header */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900">
            {isEditingExisting ? "Edit Opening Balances" : "Set Opening Balances"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Drawer body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

          {/* Server error */}
          {serverErr && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-red-500" />
              {serverErr}
            </div>
          )}

          {/* Migration Date + Notes */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Migration Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={migDate}
                onChange={(e) => onMigDateChange(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25 focus:border-[var(--finos-accent)] bg-white text-slate-900"
              />
              <p className="mt-1 text-xs text-slate-400">
                The date your accounting migrated to FINOS.
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => onNotesChange(e.target.value)}
                rows={2}
                placeholder="Optional notes about this migration"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25 focus:border-[var(--finos-accent)] bg-white text-slate-900 resize-none"
              />
            </div>
          </div>

          {/* Lines table */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-800">Account Balances</h3>
              <button
                type="button"
                onClick={onAddLine}
                className="flex items-center gap-1.5 text-xs font-medium text-[var(--finos-accent)] hover:opacity-80 transition-opacity"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Line
              </button>
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-xs min-w-[800px]">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-3 py-2 font-medium text-slate-500 w-28">Type</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-500">Account / Name</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-500 w-32">Category</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-500 w-20">Currency</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-500 w-20">Rate</th>
                    <th className="text-right px-3 py-2 font-medium text-slate-500 w-28">Debit</th>
                    <th className="text-right px-3 py-2 font-medium text-slate-500 w-28">Credit</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-3 py-6 text-center text-slate-400">
                        No lines yet. Click &ldquo;Add Line&rdquo; above.
                      </td>
                    </tr>
                  )}
                  {lines.map((line) => (
                    <tr key={line._key} className="border-t border-slate-100">
                      {/* Line type */}
                      <td className="px-2 py-1.5">
                        <select
                          value={line.lineType}
                          onChange={(e) => onLineTypeChange(line._key, e.target.value)}
                          className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-[var(--finos-accent)] bg-white"
                        >
                          <option value="ACCOUNT">Account</option>
                          <option value="CUSTOMER">Customer</option>
                          <option value="VENDOR">Vendor</option>
                          <option value="BANK">Bank</option>
                        </select>
                      </td>

                      {/* Entity selector */}
                      <td className="px-2 py-1.5">
                        {line.lineType === "ACCOUNT" && (
                          <select
                            value={line.accountId}
                            onChange={(e) => onAccountSelect(line._key, e.target.value)}
                            className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-[var(--finos-accent)] bg-white"
                          >
                            <option value="">Select account…</option>
                            {["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"].map((type) => {
                              const group = coaAccounts.filter((a) => a.type === type);
                              if (group.length === 0) return null;
                              return (
                                <optgroup key={type} label={type.charAt(0) + type.slice(1).toLowerCase()}>
                                  {group.map((a) => (
                                    <option key={a.id} value={a.id}>
                                      {a.code} — {a.name}
                                    </option>
                                  ))}
                                </optgroup>
                              );
                            })}
                          </select>
                        )}
                        {line.lineType === "CUSTOMER" && (
                          <div className="space-y-1">
                            <select
                              value={line.customerId}
                              onChange={(e) => onCustomerSelect(line._key, e.target.value)}
                              className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-[var(--finos-accent)] bg-white"
                            >
                              <option value="">Select customer…</option>
                              {customers.map((c) => (
                                <option key={c.id} value={c.id}>{c.companyName}</option>
                              ))}
                            </select>
                            <select
                              value={line.accountId}
                              onChange={(e) => onUpdateLine(line._key, { accountId: e.target.value })}
                              className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-[var(--finos-accent)] bg-white"
                            >
                              <option value="">AR Account (required)…</option>
                              {coaAccounts
                                .filter((a) => a.type === "ASSET")
                                .map((a) => (
                                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                                ))}
                            </select>
                          </div>
                        )}
                        {line.lineType === "VENDOR" && (
                          <div className="space-y-1">
                            <select
                              value={line.vendorId}
                              onChange={(e) => onVendorSelect(line._key, e.target.value)}
                              className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-[var(--finos-accent)] bg-white"
                            >
                              <option value="">Select vendor…</option>
                              {vendors.map((v) => (
                                <option key={v.id} value={v.id}>{v.companyName}</option>
                              ))}
                            </select>
                            <select
                              value={line.accountId}
                              onChange={(e) => onUpdateLine(line._key, { accountId: e.target.value })}
                              className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-[var(--finos-accent)] bg-white"
                            >
                              <option value="">AP Account (required)…</option>
                              {coaAccounts
                                .filter((a) => a.type === "LIABILITY")
                                .map((a) => (
                                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                                ))}
                            </select>
                          </div>
                        )}
                        {line.lineType === "BANK" && (
                          <select
                            value={line.bankAccountId}
                            onChange={(e) => onBankSelect(line._key, e.target.value)}
                            className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-[var(--finos-accent)] bg-white"
                          >
                            <option value="">Select bank account…</option>
                            {bankAccounts.map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.accountName} ({b.bankName})
                              </option>
                            ))}
                          </select>
                        )}
                      </td>

                      {/* Account Category */}
                      <td className="px-2 py-1.5">
                        <select
                          value={line.accountCategory}
                          onChange={(e) => onUpdateLine(line._key, { accountCategory: e.target.value })}
                          className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-[var(--finos-accent)] bg-white"
                        >
                          <option value="">Category…</option>
                          {ACCOUNT_CATEGORIES.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </td>

                      {/* Currency */}
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          maxLength={3}
                          value={line.currency}
                          onChange={(e) =>
                            onUpdateLine(line._key, { currency: e.target.value.toUpperCase() })
                          }
                          className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-[var(--finos-accent)] bg-white uppercase"
                        />
                      </td>

                      {/* Exchange Rate */}
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          min="0.000001"
                          step="any"
                          value={line.exchangeRate}
                          onChange={(e) => onUpdateLine(line._key, { exchangeRate: e.target.value })}
                          className={cn(
                            "w-full px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-[var(--finos-accent)] bg-white",
                            line.currency === tenantCurrency && "opacity-50",
                          )}
                          readOnly={line.currency === tenantCurrency}
                        />
                      </td>

                      {/* Debit */}
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={line.debit}
                          onChange={(e) => {
                            onUpdateLine(line._key, {
                              debit:  e.target.value,
                              credit: e.target.value && parseFloat(e.target.value) > 0 ? "" : line.credit,
                            });
                          }}
                          className={cn(
                            "w-full px-2 py-1 text-xs border rounded text-right focus:outline-none focus:ring-1 focus:ring-[var(--finos-accent)] bg-white",
                            line.credit && parseFloat(line.credit) > 0
                              ? "border-slate-100 text-slate-300"
                              : "border-slate-200 text-slate-900",
                          )}
                        />
                      </td>

                      {/* Credit */}
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={line.credit}
                          onChange={(e) => {
                            onUpdateLine(line._key, {
                              credit: e.target.value,
                              debit:  e.target.value && parseFloat(e.target.value) > 0 ? "" : line.debit,
                            });
                          }}
                          className={cn(
                            "w-full px-2 py-1 text-xs border rounded text-right focus:outline-none focus:ring-1 focus:ring-[var(--finos-accent)] bg-white",
                            line.debit && parseFloat(line.debit) > 0
                              ? "border-slate-100 text-slate-300"
                              : "border-slate-200 text-slate-900",
                          )}
                        />
                      </td>

                      {/* Remove */}
                      <td className="px-1 py-1.5 text-center">
                        <button
                          type="button"
                          onClick={() => onRemoveLine(line._key)}
                          className="text-slate-300 hover:text-red-500 transition-colors p-0.5"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>

                {/* Running totals in drawer */}
                {lines.length > 0 && (
                  <tfoot className="border-t-2 border-slate-300 bg-slate-50">
                    <tr>
                      <td colSpan={5} className="px-3 py-2 text-xs font-semibold text-slate-700 uppercase tracking-wide">
                        Total
                      </td>
                      <td className="px-2 py-2 text-right text-xs font-semibold tabular-nums text-slate-800">
                        {formatDrawerCurrency(draftSummary.totalDebit)}
                      </td>
                      <td className="px-2 py-2 text-right text-xs font-semibold tabular-nums text-slate-800">
                        {formatDrawerCurrency(draftSummary.totalCredit)}
                      </td>
                      <td />
                    </tr>
                    <tr>
                      <td colSpan={5} className="px-3 pb-2 text-xs text-slate-500">
                        Difference
                      </td>
                      <td colSpan={2} className="px-2 pb-2 text-right">
                        <span className={cn(
                          "text-xs font-semibold tabular-nums",
                          draftSummary.isBalanced ? "text-green-600" : "text-red-500",
                        )}>
                          {draftSummary.isBalanced
                            ? "✓ Balanced"
                            : `${formatDrawerCurrency(draftSummary.difference)} unbalanced`
                          }
                        </span>
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* Unbalanced finalise warning */}
          {!draftSummary.isBalanced && lines.length > 0 && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
              Opening balances must be balanced before they can be finalised.
              Current difference: <strong className="ml-1">
                {formatDrawerCurrency(draftSummary.difference)}
              </strong>
            </div>
          )}
        </div>

        {/* Drawer footer */}
        <div className="shrink-0 border-t border-slate-200 px-6 py-4 flex items-center justify-between gap-3 bg-white">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onSaveDraft({ closeOnSuccess: true })}
              disabled={saving || finalising}
              className="px-5 py-2 text-sm font-medium border border-[var(--finos-accent)] text-[var(--finos-accent)] rounded-lg hover:bg-[var(--finos-accent)]/5 disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving…" : "Save Draft"}
            </button>
            <button
              type="button"
              onClick={async () => {
                const batchId = await onSaveDraft({ closeOnSuccess: false });
                if (batchId) onFinalise(batchId);
              }}
              disabled={
                saving || finalising || !draftSummary.isBalanced || lines.length === 0
              }
              title={
                !draftSummary.isBalanced
                  ? "Opening balances must be balanced before finalising"
                  : undefined
              }
              className={cn(
                "flex items-center gap-2 px-5 py-2 text-sm font-medium text-white rounded-lg transition-colors",
                draftSummary.isBalanced && lines.length > 0
                  ? "bg-green-600 hover:bg-green-700 disabled:opacity-50"
                  : "bg-slate-300 cursor-not-allowed",
              )}
            >
              <Lock className="h-3.5 w-3.5" />
              {finalising ? "Finalising…" : "Finalise Opening Balances"}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
