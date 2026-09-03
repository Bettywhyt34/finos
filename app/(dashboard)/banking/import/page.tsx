"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Upload, FileText, AlertCircle, CheckCircle2, X, ChevronDown, ChevronRight, Split, WandSparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { cn, formatCurrency } from "@/lib/utils";
import {
  postStatementAccountCoding,
  postStatementCustomerPayment,
  postStatementVendorPayment,
} from "./actions";

type Direction = "CREDIT" | "DEBIT";
type HandleKind = "" | "ACCOUNT" | "CUSTOMER_PAYMENT" | "VENDOR_PAYMENT" | "SPLIT";

interface ParsedRow {
  clientId: string;
  date: string;
  description: string;
  amount: string;
  type: Direction;
  reference: string;
}

interface Allocation { id: string; targetId: string; amount: number; }
interface ReviewRow extends ParsedRow {
  selected: boolean;
  handleKind: HandleKind;
  targetId: string;
  allocations: Allocation[];
  whtAmount: number;
  exchangeRate: number;
  expanded: boolean;
}

interface ColumnMap { date: string; description: string; amount: string; type: string; reference: string; }
interface ContextData {
  bankAccount: { id: string; accountName: string; bankName: string; currency: string; ledgerAccountId: string | null };
  accounts: { id: string; code: string; name: string; type: string; financialCategory: string | null }[];
  customers: { id: string; companyName: string; currency: string; invoices: { id: string; number: string; currency: string; outstanding: number; dueDate: string }[] }[];
  vendors: { id: string; companyName: string; currency: string; bills: { id: string; number: string; currency: string; outstanding: number; dueDate: string }[] }[];
  bankAccounts: { id: string; accountName: string; bankName: string; currency: string }[];
}
interface ImportResult {
  success?: boolean;
  error?: string;
  count?: number;
  skipped?: number;
  received?: number;
  results?: { clientId: string; status: "imported" | "duplicate"; bankTransactionId: string }[];
}

function parseCSV(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  return lines.map((line) => {
    const fields: string[] = [];
    let inQuote = false;
    let current = "";
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"' && line[i + 1] === '"' && inQuote) { current += '"'; i++; }
      else if (char === '"') inQuote = !inQuote;
      else if (char === "," && !inQuote) { fields.push(current.trim()); current = ""; }
      else current += char;
    }
    fields.push(current.trim());
    return fields;
  });
}

function parseMappedRow(row: string[], colMap: ColumnMap, index: number): ParsedRow {
  const rawAmt = parseFloat(row[Number(colMap.amount)]?.replace(/[^0-9.-]/g, "") ?? "0");
  const typeFromCol = colMap.type ? row[Number(colMap.type)]?.toLowerCase() : "";
  const type: Direction = typeFromCol?.includes("cr") || typeFromCol?.includes("credit")
    ? "CREDIT"
    : typeFromCol?.includes("dr") || typeFromCol?.includes("debit")
      ? "DEBIT"
      : rawAmt >= 0 ? "CREDIT" : "DEBIT";
  return {
    clientId: `statement-row-${index + 1}`,
    date: row[Number(colMap.date)] ?? "",
    description: row[Number(colMap.description)] ?? "",
    amount: String(Math.abs(rawAmt)),
    type,
    reference: colMap.reference ? (row[Number(colMap.reference)] ?? "") : "",
  };
}

function money(value: number, currency: string) {
  return formatCurrency(value, currency);
}

export default function BankImportPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const accountId = searchParams.get("accountId") ?? "";
  const fileRef = useRef<HTMLInputElement>(null);

  const [dragging, setDragging] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [colMap, setColMap] = useState<ColumnMap>({ date: "", description: "", amount: "", type: "", reference: "" });
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [contextData, setContextData] = useState<ContextData | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);
  const [posting, setPosting] = useState(false);
  const [fileName, setFileName] = useState("");
  const [bulkAccountId, setBulkAccountId] = useState("");

  const currency = contextData?.bankAccount.currency ?? "NGN";

  function resetFile() {
    setRawRows([]); setHeaders([]); setRows([]); setFileName(""); setContextData(null);
  }

  function processFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".csv")) { toast.error("Please upload a CSV file"); return; }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const parsed = parseCSV(String(event.target?.result ?? ""));
      if (parsed.length < 2) { toast.error("CSV must have a header row and at least one transaction"); return; }
      setHeaders(parsed[0]);
      setRawRows(parsed.slice(1));
      setRows([]);
      const autoMap: ColumnMap = { date: "", description: "", amount: "", type: "", reference: "" };
      parsed[0].forEach((header, index) => {
        const lower = header.toLowerCase();
        if (lower.includes("date")) autoMap.date = String(index);
        else if (lower.includes("desc") || lower.includes("narr") || lower.includes("detail")) autoMap.description = String(index);
        else if (lower.includes("amount") || lower.includes("value")) autoMap.amount = String(index);
        else if (lower.includes("type") || lower.includes("dr") || lower.includes("cr")) autoMap.type = String(index);
        else if (lower.includes("ref") || lower.includes("id")) autoMap.reference = String(index);
      });
      setColMap(autoMap);
    };
    reader.readAsText(file);
  }

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault(); setDragging(false);
    const file = event.dataTransfer.files[0]; if (file) processFile(file);
  }, []);

  async function buildReviewGrid() {
    if (!accountId) { toast.error("Open Import Statement from a bank account first"); return; }
    if (!colMap.date || !colMap.description || !colMap.amount) { toast.error("Map Date, Description and Amount"); return; }
    setLoadingContext(true);
    const response = await fetch(`/api/banking/import/context?accountId=${encodeURIComponent(accountId)}`);
    const data = await response.json();
    setLoadingContext(false);
    if (!response.ok || data?.error) { toast.error(data?.error ?? "Could not load FINOS accounts"); return; }
    setContextData(data);
    const defaultRate = data.bankAccount.currency === "NGN" ? 1 : 0;
    setRows(rawRows.map((raw, index) => ({
      ...parseMappedRow(raw, colMap, index),
      selected: false,
      handleKind: "",
      targetId: "",
      allocations: [],
      whtAmount: 0,
      exchangeRate: defaultRate,
      expanded: false,
    })));
  }

  function patchRow(clientId: string, patch: Partial<ReviewRow>) {
    setRows((current) => current.map((row) => row.clientId === clientId ? { ...row, ...patch } : row));
  }

  function chooseKind(row: ReviewRow, kind: HandleKind) {
    const amount = Number(row.amount);
    patchRow(row.clientId, {
      handleKind: kind,
      targetId: "",
      allocations: kind === "SPLIT"
        ? [{ id: `${row.clientId}-split-1`, targetId: "", amount }, { id: `${row.clientId}-split-2`, targetId: "", amount: 0 }]
        : [],
      expanded: kind === "CUSTOMER_PAYMENT" || kind === "VENDOR_PAYMENT" || kind === "SPLIT",
    });
  }

  function setCustomer(row: ReviewRow, customerId: string) {
    const customer = contextData?.customers.find((item) => item.id === customerId);
    const gross = Number(row.amount) + Number(row.whtAmount || 0);
    let remaining = gross;
    const allocations = (customer?.invoices ?? []).map((invoice) => {
      const amount = Math.min(remaining, invoice.outstanding);
      remaining = Math.max(0, remaining - amount);
      return { id: invoice.id, targetId: invoice.id, amount: Math.round(amount * 100) / 100 };
    });
    patchRow(row.clientId, { targetId: customerId, allocations, expanded: true });
  }

  function setVendor(row: ReviewRow, vendorId: string) {
    const vendor = contextData?.vendors.find((item) => item.id === vendorId);
    const gross = Number(row.amount) + Number(row.whtAmount || 0);
    let remaining = gross;
    const allocations = (vendor?.bills ?? []).map((bill) => {
      const amount = Math.min(remaining, bill.outstanding);
      remaining = Math.max(0, remaining - amount);
      return { id: bill.id, targetId: bill.id, amount: Math.round(amount * 100) / 100 };
    });
    patchRow(row.clientId, { targetId: vendorId, allocations, expanded: true });
  }

  function recalcSubledger(row: ReviewRow, whtAmount: number) {
    const next = { ...row, whtAmount };
    if (row.handleKind === "CUSTOMER_PAYMENT" && row.targetId) setCustomer(next, row.targetId);
    else if (row.handleKind === "VENDOR_PAYMENT" && row.targetId) setVendor(next, row.targetId);
    else patchRow(row.clientId, { whtAmount });
  }

  function updateAllocation(row: ReviewRow, allocationId: string, amount: number, targetId?: string) {
    patchRow(row.clientId, {
      allocations: row.allocations.map((allocation) => allocation.id === allocationId
        ? { ...allocation, amount, ...(targetId !== undefined ? { targetId } : {}) }
        : allocation),
    });
  }

  function addSplitLine(row: ReviewRow) {
    patchRow(row.clientId, {
      allocations: [...row.allocations, { id: `${row.clientId}-split-${Date.now()}`, targetId: "", amount: 0 }],
    });
  }

  function applyBulkAccount() {
    if (!bulkAccountId) { toast.error("Choose an account first"); return; }
    const selected = rows.filter((row) => row.selected);
    if (!selected.length) { toast.error("Select at least one statement row"); return; }
    setRows((current) => current.map((row) => row.selected ? {
      ...row, handleKind: "ACCOUNT", targetId: bulkAccountId, allocations: [], expanded: false,
    } : row));
    toast.success(`Account applied to ${selected.length} row${selected.length === 1 ? "" : "s"}`);
  }

  function rowState(row: ReviewRow) {
    const amount = Number(row.amount);
    const rateReady = currency === "NGN" || row.exchangeRate > 0;
    if (!rateReady) return { ready: false, label: "Rate needed" };
    if (row.handleKind === "ACCOUNT") return { ready: Boolean(row.targetId), label: row.targetId ? "Ready" : "Choose account" };
    if (row.handleKind === "SPLIT") {
      const total = row.allocations.reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0);
      const valid = row.allocations.length > 1 && row.allocations.every((allocation) => allocation.targetId && allocation.amount > 0) && Math.abs(total - amount) <= 0.01;
      return { ready: valid, label: valid ? "Ready" : "Finish split" };
    }
    if (row.handleKind === "CUSTOMER_PAYMENT" || row.handleKind === "VENDOR_PAYMENT") {
      const gross = amount + Number(row.whtAmount || 0);
      const allocated = row.allocations.reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0);
      const valid = Boolean(row.targetId) && row.allocations.some((allocation) => allocation.amount > 0) && Math.abs(allocated - gross) <= 0.01;
      return { ready: valid, label: valid ? "Ready" : "Allocate" };
    }
    return { ready: false, label: "Needs review" };
  }

  async function handlePostReady() {
    if (!accountId || !rows.length || !contextData) return;
    const readyRows = rows.filter((row) => rowState(row).ready);
    if (!readyRows.length) { toast.error("Code at least one row before posting"); return; }
    setPosting(true);

    try {
      const importResponse = await fetch("/api/banking/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          transactions: rows.map((row) => ({
            clientId: row.clientId,
            date: row.date,
            description: row.description,
            amount: row.amount,
            type: row.type,
            reference: row.reference,
          })),
        }),
      });
      const imported: ImportResult = await importResponse.json();
      if (!importResponse.ok || imported.error) throw new Error(imported.error ?? "Statement import failed");
      const ids = new Map((imported.results ?? []).map((result) => [result.clientId, result.bankTransactionId]));

      let posted = 0;
      const errors: string[] = [];
      for (const row of readyRows) {
        const bankTransactionId = ids.get(row.clientId);
        if (!bankTransactionId) { errors.push(`${row.description}: imported row ID not returned`); continue; }
        let result: { success?: boolean; error?: string };
        if (row.handleKind === "ACCOUNT") {
          result = await postStatementAccountCoding({
            bankTransactionId,
            exchangeRate: row.exchangeRate || 1,
            allocations: [{ accountId: row.targetId, amount: Number(row.amount) }],
          });
        } else if (row.handleKind === "SPLIT") {
          result = await postStatementAccountCoding({
            bankTransactionId,
            exchangeRate: row.exchangeRate || 1,
            allocations: row.allocations.map((allocation) => ({ accountId: allocation.targetId, amount: allocation.amount })),
          });
        } else if (row.handleKind === "CUSTOMER_PAYMENT") {
          result = await postStatementCustomerPayment({
            bankTransactionId,
            customerId: row.targetId,
            exchangeRate: row.exchangeRate || 1,
            whtAmount: row.whtAmount,
            invoiceAllocations: row.allocations.filter((allocation) => allocation.amount > 0).map((allocation) => ({ invoiceId: allocation.targetId, amount: allocation.amount })),
          });
        } else if (row.handleKind === "VENDOR_PAYMENT") {
          result = await postStatementVendorPayment({
            bankTransactionId,
            vendorId: row.targetId,
            exchangeRate: row.exchangeRate || 1,
            whtAmount: row.whtAmount,
            billAllocations: row.allocations.filter((allocation) => allocation.amount > 0).map((allocation) => ({ billId: allocation.targetId, amount: allocation.amount })),
          });
        } else continue;
        if (result?.error) errors.push(`${row.description}: ${result.error}`); else posted++;
      }

      const unresolved = rows.length - readyRows.length;
      if (errors.length) {
        toast.error(`${posted} posted; ${errors.length} coded row${errors.length === 1 ? "" : "s"} need review. Statement rows were still imported safely.`);
        console.error("FINOS statement posting errors", errors);
      } else {
        toast.success(`${posted} coded row${posted === 1 ? "" : "s"} posted${unresolved ? ` · ${unresolved} left for review` : ""}`);
      }
      router.push(`/banking/${accountId}`);
      router.refresh();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Could not post statement review");
    } finally {
      setPosting(false);
    }
  }

  const readyCount = rows.filter((row) => rowState(row).ready).length;
  const selectedCount = rows.filter((row) => row.selected).length;

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 pb-24">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[32px] font-medium tracking-[-0.02em] text-[var(--text-primary)]">Import bank statement</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Upload once, then code the statement like a spreadsheet. FINOS handles the debit and credit logic underneath.</p>
        </div>
        {contextData ? <div className="text-right text-sm"><p className="font-medium text-[var(--text-primary)]">{contextData.bankAccount.bankName} · {contextData.bankAccount.accountName}</p><p className="text-[var(--text-secondary)]">{currency}</p></div> : null}
      </div>

      {!rawRows.length ? (
        <div onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop} onClick={() => fileRef.current?.click()}
          className={cn("grid min-h-72 cursor-pointer place-items-center rounded-xl border-2 border-dashed transition-colors", dragging ? "border-[var(--finos-accent)] bg-[var(--surface-muted)]" : "border-[var(--app-border)] bg-white hover:bg-[var(--surface-muted)]")}>
          <div className="text-center"><Upload className="mx-auto h-9 w-9 text-[var(--text-secondary)]" /><p className="mt-4 font-medium text-[var(--text-primary)]">Drop CSV here or click to browse</p><p className="mt-1 text-sm text-[var(--text-secondary)]">Bank statement CSV · up to 10,000 rows</p></div>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(event) => event.target.files?.[0] && processFile(event.target.files[0])} />
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-[var(--app-border)] bg-white px-4 py-3"><FileText className="h-5 w-5 text-[var(--finos-accent)]" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{fileName}</p><p className="text-xs text-[var(--text-secondary)]">{rawRows.length} statement rows</p></div><Button variant="ghost" size="icon-sm" onClick={resetFile}><X className="h-4 w-4" /></Button></div>
      )}

      {headers.length > 0 && rows.length === 0 ? (
        <section className="rounded-xl border border-[var(--app-border)] bg-white p-5">
          <div className="mb-4"><h2 className="font-medium text-[var(--text-primary)]">Map statement columns</h2><p className="mt-1 text-xs text-[var(--text-secondary)]">FINOS has guessed what it can. Confirm the mapping once.</p></div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
            {([ ["date", "Date *"], ["description", "Description *"], ["amount", "Amount *"], ["type", "Credit / Debit"], ["reference", "Reference"] ] as [keyof ColumnMap, string][]).map(([field, label]) => (
              <div key={field} className="space-y-1.5"><Label className="text-xs">{label}</Label><select value={colMap[field]} onChange={(event) => setColMap((current) => ({ ...current, [field]: event.target.value }))} className="h-9 w-full rounded-md border border-[var(--app-border)] bg-white px-2 text-xs"><option value="">Select…</option>{headers.map((header, index) => <option key={`${header}-${index}`} value={String(index)}>{header}</option>)}</select></div>
            ))}
          </div>
          <Button className="mt-4" size="sm" onClick={buildReviewGrid} disabled={loadingContext}>{loadingContext ? "Preparing…" : `Open review grid · ${rawRows.length} rows`}</Button>
        </section>
      ) : null}

      {rows.length > 0 && contextData ? (
        <>
          <section className="sticky top-0 z-20 flex flex-wrap items-center gap-3 rounded-xl border border-[var(--app-border)] bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
            <div className="mr-auto"><p className="text-sm font-medium text-[var(--text-primary)]">{readyCount} ready · {rows.length - readyCount} need review</p><p className="text-xs text-[var(--text-secondary)]">Unresolved rows are still imported as bank evidence and remain available for later review.</p></div>
            <span className="text-xs text-[var(--text-secondary)]">{selectedCount} selected</span>
            <select value={bulkAccountId} onChange={(event) => setBulkAccountId(event.target.value)} className="h-9 min-w-56 rounded-md border border-[var(--app-border)] bg-white px-2 text-xs"><option value="">Bulk code to account…</option>{contextData.accounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select>
            <Button variant="outline" size="sm" onClick={applyBulkAccount}><WandSparkles className="mr-1.5 h-3.5 w-3.5" />Apply</Button>
            <Button size="sm" onClick={handlePostReady} disabled={posting || readyCount === 0}>{posting ? "Posting…" : `Review & Post ${readyCount} Ready`}</Button>
          </section>

          <section className="overflow-hidden rounded-xl border border-[var(--app-border)] bg-white">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1180px] border-collapse text-sm">
                <thead className="sticky top-[69px] z-10 bg-[var(--surface-muted)] text-left text-xs text-[var(--text-secondary)]">
                  <tr><th className="w-10 px-3 py-2"><Checkbox checked={rows.every((row) => row.selected)} onCheckedChange={(checked) => setRows((current) => current.map((row) => ({ ...row, selected: Boolean(checked) })))} /></th><th className="w-28 px-3 py-2 font-medium">Date</th><th className="px-3 py-2 font-medium">Description</th><th className="w-36 px-3 py-2 text-right font-medium">Money In</th><th className="w-36 px-3 py-2 text-right font-medium">Money Out</th><th className="w-[370px] px-3 py-2 font-medium">Handle As</th><th className="w-28 px-3 py-2 font-medium">Status</th></tr>
                </thead>
                <tbody className="divide-y divide-[var(--app-border)]">
                  {rows.map((row) => {
                    const state = rowState(row);
                    const amount = Number(row.amount);
                    const customer = contextData.customers.find((item) => item.id === row.targetId);
                    const vendor = contextData.vendors.find((item) => item.id === row.targetId);
                    const allocated = row.allocations.reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0);
                    const gross = amount + Number(row.whtAmount || 0);
                    return (
                      <tr key={row.clientId} className="align-top hover:bg-[var(--app-bg)]">
                        <td className="px-3 py-3"><Checkbox checked={row.selected} onCheckedChange={(checked) => patchRow(row.clientId, { selected: Boolean(checked) })} /></td>
                        <td className="whitespace-nowrap px-3 py-3 text-xs text-[var(--text-secondary)]">{row.date}</td>
                        <td className="max-w-[320px] px-3 py-3"><p className="truncate font-medium text-[var(--text-primary)]" title={row.description}>{row.description}</p><p className="mt-0.5 truncate font-code text-[11px] text-[var(--text-secondary)]">{row.reference || "No reference"}</p></td>
                        <td className="px-3 py-3 text-right font-financial tabular-nums text-[var(--text-primary)]">{row.type === "CREDIT" ? money(amount, currency) : "—"}</td>
                        <td className="px-3 py-3 text-right font-financial tabular-nums text-[var(--text-primary)]">{row.type === "DEBIT" ? money(amount, currency) : "—"}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <select value={row.handleKind} onChange={(event) => chooseKind(row, event.target.value as HandleKind)} className="h-8 w-40 rounded-md border border-[var(--app-border)] bg-white px-2 text-xs">
                              <option value="">Select…</option>
                              {row.type === "CREDIT" ? <option value="CUSTOMER_PAYMENT">Customer payment</option> : null}
                              {row.type === "DEBIT" ? <option value="VENDOR_PAYMENT">Vendor payment</option> : null}
                              <option value="ACCOUNT">Account</option><option value="SPLIT">Split</option>
                            </select>
                            {row.handleKind === "ACCOUNT" ? <select value={row.targetId} onChange={(event) => patchRow(row.clientId, { targetId: event.target.value })} className="h-8 min-w-48 flex-1 rounded-md border border-[var(--app-border)] bg-white px-2 text-xs"><option value="">Choose account…</option>{contextData.accounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select> : null}
                            {row.handleKind === "CUSTOMER_PAYMENT" ? <select value={row.targetId} onChange={(event) => setCustomer(row, event.target.value)} className="h-8 min-w-48 flex-1 rounded-md border border-[var(--app-border)] bg-white px-2 text-xs"><option value="">Choose customer…</option>{contextData.customers.filter((item) => item.invoices.some((invoice) => invoice.currency === currency)).map((item) => <option key={item.id} value={item.id}>{item.companyName}</option>)}</select> : null}
                            {row.handleKind === "VENDOR_PAYMENT" ? <select value={row.targetId} onChange={(event) => setVendor(row, event.target.value)} className="h-8 min-w-48 flex-1 rounded-md border border-[var(--app-border)] bg-white px-2 text-xs"><option value="">Choose vendor…</option>{contextData.vendors.filter((item) => item.bills.some((bill) => bill.currency === currency)).map((item) => <option key={item.id} value={item.id}>{item.companyName}</option>)}</select> : null}
                            {row.handleKind && row.handleKind !== "ACCOUNT" ? <Button variant="ghost" size="icon-sm" onClick={() => patchRow(row.clientId, { expanded: !row.expanded })}>{row.expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</Button> : null}
                          </div>

                          {currency !== "NGN" ? <div className="mt-2 flex items-center gap-2 text-xs"><span className="text-[var(--text-secondary)]">1 {currency} =</span><Input type="number" min="0.000001" step="0.000001" value={row.exchangeRate || ""} onChange={(event) => patchRow(row.clientId, { exchangeRate: Number(event.target.value) })} className="h-7 w-32 text-xs" /><span className="text-[var(--text-secondary)]">NGN</span></div> : null}

                          {row.expanded && row.handleKind === "CUSTOMER_PAYMENT" && customer ? (
                            <div className="mt-3 rounded-lg border border-[var(--app-border)] bg-[var(--surface-muted)] p-3">
                              <div className="mb-2 flex items-center justify-between"><div><p className="text-xs font-medium">{customer.companyName} · invoice allocation</p><p className="text-[11px] text-[var(--text-secondary)]">Cash {money(amount, currency)}{row.whtAmount ? ` + WHT ${money(row.whtAmount, currency)}` : ""}</p></div><div className="flex items-center gap-2"><Label className="text-[11px]">WHT</Label><Input type="number" min="0" step="0.01" value={row.whtAmount} onChange={(event) => recalcSubledger(row, Number(event.target.value))} className="h-7 w-28 text-xs" /></div></div>
                              <div className="space-y-1.5">{customer.invoices.filter((invoice) => invoice.currency === currency).map((invoice) => { const allocation = row.allocations.find((item) => item.id === invoice.id) ?? { id: invoice.id, targetId: invoice.id, amount: 0 }; return <div key={invoice.id} className="grid grid-cols-[1fr_130px_120px] items-center gap-2 text-xs"><span>{invoice.number}</span><span className="text-right text-[var(--text-secondary)]">Due {money(invoice.outstanding, currency)}</span><Input type="number" min="0" max={invoice.outstanding} step="0.01" value={allocation.amount} onChange={(event) => { const exists = row.allocations.some((item) => item.id === invoice.id); patchRow(row.clientId, { allocations: exists ? row.allocations.map((item) => item.id === invoice.id ? { ...item, amount: Number(event.target.value) } : item) : [...row.allocations, { id: invoice.id, targetId: invoice.id, amount: Number(event.target.value) }] }); }} className="h-7 text-right text-xs" /></div>; })}</div>
                              <p className={cn("mt-2 text-right text-[11px]", Math.abs(allocated - gross) <= 0.01 ? "text-emerald-700" : "text-amber-700")}>Allocated {money(allocated, currency)} / {money(gross, currency)}</p>
                            </div>
                          ) : null}

                          {row.expanded && row.handleKind === "VENDOR_PAYMENT" && vendor ? (
                            <div className="mt-3 rounded-lg border border-[var(--app-border)] bg-[var(--surface-muted)] p-3">
                              <div className="mb-2 flex items-center justify-between"><div><p className="text-xs font-medium">{vendor.companyName} · bill allocation</p><p className="text-[11px] text-[var(--text-secondary)]">Bank payment {money(amount, currency)}{row.whtAmount ? ` + WHT ${money(row.whtAmount, currency)}` : ""}</p></div><div className="flex items-center gap-2"><Label className="text-[11px]">WHT</Label><Input type="number" min="0" step="0.01" value={row.whtAmount} onChange={(event) => recalcSubledger(row, Number(event.target.value))} className="h-7 w-28 text-xs" /></div></div>
                              <div className="space-y-1.5">{vendor.bills.filter((bill) => bill.currency === currency).map((bill) => { const allocation = row.allocations.find((item) => item.id === bill.id) ?? { id: bill.id, targetId: bill.id, amount: 0 }; return <div key={bill.id} className="grid grid-cols-[1fr_130px_120px] items-center gap-2 text-xs"><span>{bill.number}</span><span className="text-right text-[var(--text-secondary)]">Due {money(bill.outstanding, currency)}</span><Input type="number" min="0" max={bill.outstanding} step="0.01" value={allocation.amount} onChange={(event) => { const exists = row.allocations.some((item) => item.id === bill.id); patchRow(row.clientId, { allocations: exists ? row.allocations.map((item) => item.id === bill.id ? { ...item, amount: Number(event.target.value) } : item) : [...row.allocations, { id: bill.id, targetId: bill.id, amount: Number(event.target.value) }] }); }} className="h-7 text-right text-xs" /></div>; })}</div>
                              <p className={cn("mt-2 text-right text-[11px]", Math.abs(allocated - gross) <= 0.01 ? "text-emerald-700" : "text-amber-700")}>Allocated {money(allocated, currency)} / {money(gross, currency)}</p>
                            </div>
                          ) : null}

                          {row.expanded && row.handleKind === "SPLIT" ? (
                            <div className="mt-3 rounded-lg border border-[var(--app-border)] bg-[var(--surface-muted)] p-3">
                              <div className="mb-2 flex items-center justify-between"><div><p className="flex items-center gap-1.5 text-xs font-medium"><Split className="h-3.5 w-3.5" />Split {money(amount, currency)}</p><p className="text-[11px] text-[var(--text-secondary)]">Allocate this bank row across multiple ledger accounts.</p></div><Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => addSplitLine(row)}>Add line</Button></div>
                              <div className="space-y-1.5">{row.allocations.map((allocation) => <div key={allocation.id} className="grid grid-cols-[1fr_130px_28px] gap-2"><select value={allocation.targetId} onChange={(event) => updateAllocation(row, allocation.id, allocation.amount, event.target.value)} className="h-8 rounded-md border border-[var(--app-border)] bg-white px-2 text-xs"><option value="">Choose account…</option>{contextData.accounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select><Input type="number" min="0" step="0.01" value={allocation.amount} onChange={(event) => updateAllocation(row, allocation.id, Number(event.target.value))} className="h-8 text-right text-xs" /><Button variant="ghost" size="icon-sm" onClick={() => patchRow(row.clientId, { allocations: row.allocations.filter((item) => item.id !== allocation.id) })}><X className="h-3.5 w-3.5" /></Button></div>)}</div>
                              <p className={cn("mt-2 text-right text-[11px]", Math.abs(allocated - amount) <= 0.01 ? "text-emerald-700" : "text-amber-700")}>Split {money(allocated, currency)} / {money(amount, currency)}</p>
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-3"><span className={cn("whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-medium", state.ready ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")}>{state.ready ? <CheckCircle2 className="mr-1 inline h-3 w-3" /> : <AlertCircle className="mr-1 inline h-3 w-3" />}{state.label}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
