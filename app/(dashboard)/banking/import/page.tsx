"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Upload, FileText, AlertCircle, CheckCircle2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface ParsedRow {
  date: string;
  description: string;
  amount: string;
  type: "CREDIT" | "DEBIT";
  reference: string;
}

interface ColumnMap {
  date: string;
  description: string;
  amount: string;
  type: string;
  reference: string;
}

function parseCSV(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  return lines.map((line) => {
    const fields: string[] = [];
    let inQuote = false;
    let current = "";
    for (const char of line) {
      if (char === '"') { inQuote = !inQuote; }
      else if (char === "," && !inQuote) { fields.push(current.trim()); current = ""; }
      else { current += char; }
    }
    fields.push(current.trim());
    return fields;
  });
}

async function saveImport(
  accountId: string,
  rows: ParsedRow[]
): Promise<{ success?: boolean; error?: string }> {
  const res = await fetch("/api/banking/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accountId, transactions: rows }),
  });
  return res.json();
}

export default function BankImportPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const accountId = searchParams.get("accountId") ?? "";
  const fileRef = useRef<HTMLInputElement>(null);

  const [dragging, setDragging] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [colMap, setColMap] = useState<ColumnMap>({
    date: "",
    description: "",
    amount: "",
    type: "",
    reference: "",
  });
  const [preview, setPreview] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState("");

  function processFile(file: File) {
    if (!file.name.endsWith(".csv")) {
      toast.error("Please upload a CSV file");
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const rows = parseCSV(text);
      if (rows.length < 2) { toast.error("CSV must have at least a header row and one data row"); return; }
      setHeaders(rows[0]);
      setRawRows(rows.slice(1));
      // Auto-detect columns by common header names
      const autoMap: ColumnMap = { date: "", description: "", amount: "", type: "", reference: "" };
      rows[0].forEach((h, i) => {
        const lower = h.toLowerCase();
        if (lower.includes("date")) autoMap.date = String(i);
        else if (lower.includes("desc") || lower.includes("narr") || lower.includes("detail")) autoMap.description = String(i);
        else if (lower.includes("amount") || lower.includes("value")) autoMap.amount = String(i);
        else if (lower.includes("type") || lower.includes("dr") || lower.includes("cr")) autoMap.type = String(i);
        else if (lower.includes("ref") || lower.includes("id")) autoMap.reference = String(i);
      });
      setColMap(autoMap);
    };
    reader.readAsText(file);
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, []);

  function buildPreview() {
    if (!colMap.date || !colMap.description || !colMap.amount) {
      toast.error("Map at least Date, Description and Amount columns");
      return;
    }
    const rows = rawRows.slice(0, 20).map((row): ParsedRow => {
      const rawAmt = parseFloat(row[Number(colMap.amount)]?.replace(/[^0-9.-]/g, "") ?? "0");
      const typeFromCol = colMap.type ? row[Number(colMap.type)]?.toLowerCase() : "";
      const type: "CREDIT" | "DEBIT" = typeFromCol?.includes("cr") || typeFromCol?.includes("credit")
        ? "CREDIT"
        : rawAmt >= 0
        ? "CREDIT"
        : "DEBIT";
      return {
        date: row[Number(colMap.date)] ?? "",
        description: row[Number(colMap.description)] ?? "",
        amount: String(Math.abs(rawAmt)),
        type,
        reference: colMap.reference ? (row[Number(colMap.reference)] ?? "") : "",
      };
    });
    setPreview(rows);
  }

  async function handleImport() {
    if (!accountId) { toast.error("No bank account selected"); return; }
    if (preview.length === 0) { toast.error("Build preview first"); return; }
    setImporting(true);
    const result = await saveImport(accountId, preview);
    setImporting(false);
    if (result?.error) { toast.error(result.error); return; }
    toast.success(`${preview.length} transactions imported`);
    router.push(`/banking/${accountId}`);
  }

  const ColSelect = ({ field, label }: { field: keyof ColumnMap; label: string }) => (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Select
        value={colMap[field]}
        onValueChange={(v) => setColMap((m) => ({ ...m, [field]: v }))}
      >
        <SelectTrigger size="sm" className="w-full text-xs">
          <SelectValue placeholder="Select column…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">—</SelectItem>
          {headers.map((h, i) => (
            <SelectItem key={i} value={String(i)}>
              {h}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Import Bank Transactions
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Upload a CSV exported from your bank statement.
        </p>
      </div>

      {/* Drop zone */}
      {!rawRows.length ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          className={cn(
            "border-2 border-dashed rounded-xl py-16 flex flex-col items-center justify-center cursor-pointer transition-colors",
            dragging
              ? "border-blue-400 bg-blue-50"
              : "border-slate-200 bg-slate-50 hover:border-slate-300"
          )}
        >
          <Upload className="h-10 w-10 text-slate-300 mb-3" />
          <p className="text-slate-600 font-medium">Drop CSV here or click to browse</p>
          <p className="text-sm text-slate-400 mt-1">Supports bank statement exports (.csv)</p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && processFile(e.target.files[0])}
          />
        </div>
      ) : (
        <div className="flex items-center gap-3 px-4 py-3 bg-green-50 border border-green-200 rounded-lg">
          <FileText className="h-5 w-5 text-green-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-green-800 truncate">{fileName}</p>
            <p className="text-xs text-green-600">{rawRows.length} data rows detected</p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => { setRawRows([]); setHeaders([]); setPreview([]); setFileName(""); }}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Column mapping */}
      {headers.length > 0 && (
        <div className="rounded-lg border border-slate-200 p-4 space-y-4 bg-white">
          <p className="text-sm font-medium text-slate-700">Map CSV Columns</p>
          <div className="grid grid-cols-5 gap-3">
            <ColSelect field="date" label="Date *" />
            <ColSelect field="description" label="Description *" />
            <ColSelect field="amount" label="Amount *" />
            <ColSelect field="type" label="Type (CR/DR)" />
            <ColSelect field="reference" label="Reference" />
          </div>
          <Button size="sm" onClick={buildPreview}>
            Preview ({Math.min(rawRows.length, 20)} rows)
          </Button>
        </div>
      )}

      {/* Preview table */}
      {preview.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-700">
              Preview — {preview.length} rows
            </p>
            <div className="flex items-center gap-1.5 text-green-700 text-xs">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Ready to import
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 overflow-hidden text-xs">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  {["Date", "Description", "Amount", "Type", "Reference"].map(
                    (h) => <th key={h} className="text-left px-3 py-2 font-medium text-slate-600">{h}</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {preview.map((row, i) => (
                  <tr key={i}>
                    <td className="px-3 py-1.5 text-slate-500">{row.date}</td>
                    <td className="px-3 py-1.5 truncate max-w-xs">{row.description}</td>
                    <td className="px-3 py-1.5 font-mono">{row.amount}</td>
                    <td className="px-3 py-1.5">
                      <span className={cn(
                        "px-1.5 py-0.5 rounded-full",
                        row.type === "CREDIT" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                      )}>
                        {row.type}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-slate-400">{row.reference || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!accountId && (
            <div className="flex items-center gap-2 text-amber-700 text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              No bank account selected. Go back to a bank account and click Import CSV.
            </div>
          )}

          <Button onClick={handleImport} disabled={importing || !accountId}>
            {importing ? "Importing…" : `Import ${preview.length} Transactions`}
          </Button>
        </div>
      )}
    </div>
  );
}
