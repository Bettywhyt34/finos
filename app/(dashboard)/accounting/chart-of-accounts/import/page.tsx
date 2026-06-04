"use client"

import { useState, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  Upload, FileText, CheckCircle2, AlertCircle,
  ArrowLeft, X, Loader2, AlertTriangle,
} from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import {
  detectCoaFormat,
  mapZohoCoaRow,
  mapFinosCoaRow,
  topologicalSort,
  CoaImportRow,
} from "@/lib/coa/csv-map"

// ─── CSV Parser ───────────────────────────────────────────────────────────────

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines: string[] = []
  let current = ""
  let inQuote = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      if (inQuote && text[i + 1] === '"') { current += '"'; i++ }
      else inQuote = !inQuote
    } else if ((ch === "\n" || ch === "\r") && !inQuote) {
      if (current.trim() || lines.length > 0) lines.push(current)
      current = ""
      if (ch === "\r" && text[i + 1] === "\n") i++
    } else {
      current += ch
    }
  }
  if (current.trim()) lines.push(current)

  const splitLine = (line: string): string[] => {
    const fields: string[] = []
    let field = ""
    let q = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (q && line[i + 1] === '"') { field += '"'; i++ }
        else q = !q
      } else if (ch === "," && !q) { fields.push(field); field = "" }
      else { field += ch }
    }
    fields.push(field)
    return fields
  }

  if (!lines.length) return { headers: [], rows: [] }
  const headers = splitLine(lines[0]).map((h) => h.trim())
  const rows = lines.slice(1).map((line) => {
    const vals = splitLine(line)
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = vals[i]?.trim() ?? "" })
    return row
  })
  return { headers, rows }
}

// ─── Type badge colours ───────────────────────────────────────────────────────

const TYPE_BADGE: Record<string, string> = {
  ASSET:     "bg-blue-50 text-blue-700",
  LIABILITY: "bg-red-50 text-red-700",
  EQUITY:    "bg-purple-50 text-purple-700",
  INCOME:    "bg-green-50 text-green-700",
  EXPENSE:   "bg-orange-50 text-orange-700",
}

type ImportResult = {
  imported: number
  updated: number
  skipped: number
  errors: Array<{ accountName: string; error: string }>
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CoaImportPage() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  const [dragging, setDragging]   = useState(false)
  const [fileName, setFileName]   = useState<string | null>(null)
  const [format, setFormat]       = useState<"finos" | "zoho" | null>(null)
  const [rows, setRows]           = useState<CoaImportRow[]>([])
  const [loading, setLoading]     = useState(false)
  const [result, setResult]       = useState<ImportResult | null>(null)

  const processFile = useCallback((file: File) => {
    setFileName(file.name)
    setResult(null)
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const { headers, rows: rawRows } = parseCSV(text)
      if (!headers.length) { toast.error("Could not parse CSV"); return }

      const detected = detectCoaFormat(headers)
      setFormat(detected)

      const mapped = rawRows
        .filter((r) => Object.values(r).some((v) => v.trim()))
        .map((r) => detected === "zoho" ? mapZohoCoaRow(r) : mapFinosCoaRow(r))
        .filter((r) => r.accountName.trim())

      // Topological sort client-side so preview shows correct order
      setRows(topologicalSort(mapped))
    }
    reader.readAsText(file)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file?.name.endsWith(".csv")) processFile(file)
    else toast.error("Please upload a .csv file")
  }, [processFile])

  const handleImport = async () => {
    if (!rows.length) return
    setLoading(true)
    try {
      const res = await fetch("/api/coa/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || "Import failed"); return }
      setResult(data)
      if (data.errors.length === 0) toast.success(`Imported ${data.imported} accounts`)
      else toast.warning(`Import complete — ${data.errors.length} error(s)`)
    } catch {
      toast.error("Network error")
    } finally {
      setLoading(false)
    }
  }

  const reset = () => {
    setFileName(null); setFormat(null); setRows([]); setResult(null)
    if (fileRef.current) fileRef.current.value = ""
  }

  const unmapped   = rows.filter((r) => r.typeUnmapped)
  const withParent = rows.filter((r) => r.parentAccountName)
  const preview    = rows.slice(0, 12)

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/accounting/chart-of-accounts"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-8 px-2")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Import Chart of Accounts</h1>
          <p className="text-sm text-slate-500">
            Upload a FINOS CSV or Zoho Books export — parent accounts are inserted before children automatically
          </p>
        </div>
      </div>

      {/* Upload Zone */}
      {!fileName && (
        <div
          className={cn(
            "border-2 border-dashed rounded-xl p-12 text-center transition-colors cursor-pointer",
            dragging ? "border-indigo-400 bg-indigo-50" : "border-slate-200 hover:border-indigo-300 hover:bg-slate-50"
          )}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
        >
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f) }} />
          <Upload className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-600 font-medium">Drop your CSV here or click to browse</p>
          <p className="text-sm text-slate-400 mt-1">Accepts FINOS native CSV or Zoho Books COA export</p>
        </div>
      )}

      {/* File Loaded — Preview */}
      {fileName && !result && (
        <div className="space-y-4">
          {/* File info bar */}
          <div className="flex items-center justify-between border border-slate-200 rounded-lg px-4 py-3 bg-white">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-slate-400" />
              <div>
                <p className="text-sm font-medium text-slate-900">{fileName}</p>
                <p className="text-xs text-slate-500">
                  <span className="font-medium">{rows.length}</span> accounts detected
                  {withParent.length > 0 && <> · <span className="font-medium">{withParent.length}</span> with parent</>}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {format && (
                <Badge variant="outline" className={
                  format === "zoho"
                    ? "bg-orange-50 text-orange-700 border-orange-200"
                    : "bg-indigo-50 text-indigo-700 border-indigo-200"
                }>
                  {format === "zoho" ? "Zoho Export" : "FINOS CSV"}
                </Badge>
              )}
              <button onClick={reset} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Unmapped types warning */}
          {unmapped.length > 0 && (
            <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
              <div>
                <span className="font-medium">{unmapped.length} unknown account type{unmapped.length !== 1 ? "s" : ""}.</span>{" "}
                These will be imported as <span className="font-medium">ASSET</span> with no Financial Category.
                You can reclassify them afterwards at{" "}
                <span className="font-medium">Accounting → Chart of Accounts → Reclassify</span>.
                <div className="mt-1 text-xs text-amber-700">
                  {unmapped.slice(0, 5).map((r) => r.rawZohoType).join(", ")}
                  {unmapped.length > 5 && ` +${unmapped.length - 5} more`}
                </div>
              </div>
            </div>
          )}

          {/* Preview table */}
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
              Preview (first {preview.length}, in insert order)
            </p>
            <div className="border border-slate-200 rounded-xl overflow-x-auto bg-white shadow-sm">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-slate-600">Code</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-600">Account Name</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-600">Type</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-600">Financial Category</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-600">Parent</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-600">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {preview.map((row, i) => (
                    <tr key={i} className={cn("hover:bg-slate-50", row.typeUnmapped && "bg-amber-50/40")}>
                      <td className="px-3 py-2 font-mono text-slate-500">{row.accountCode || <span className="text-slate-300 italic">auto</span>}</td>
                      <td className="px-3 py-2 font-medium text-slate-900 max-w-[180px] truncate">{row.accountName}</td>
                      <td className="px-3 py-2">
                        <span className={cn("text-xs px-1.5 py-0.5 rounded-full font-medium", TYPE_BADGE[row.accountType] ?? "bg-slate-100 text-slate-600")}>
                          {row.accountType}
                        </span>
                        {row.typeUnmapped && <AlertTriangle className="inline h-3 w-3 ml-1 text-amber-500" />}
                      </td>
                      <td className="px-3 py-2 text-slate-500">{row.financialCategory ?? <span className="text-slate-300">—</span>}</td>
                      <td className="px-3 py-2 text-slate-400 max-w-[140px] truncate">{row.parentAccountName ?? "—"}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className={row.isActive ? "bg-green-50 text-green-700 border-green-200" : "bg-slate-50 text-slate-500 border-slate-200"}>
                          {row.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > 12 && (
              <p className="text-xs text-slate-400 mt-1 text-right">+{rows.length - 12} more accounts not shown</p>
            )}
          </div>

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={reset} disabled={loading}>Cancel</Button>
            <Button onClick={handleImport} disabled={loading || !rows.length}>
              {loading ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Importing…</>
              ) : (
                `Import ${rows.length} account${rows.length !== 1 ? "s" : ""}`
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="space-y-4">
          <div className="border border-slate-200 rounded-xl p-6 bg-white shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              {result.errors.length === 0
                ? <CheckCircle2 className="h-6 w-6 text-green-500" />
                : <AlertCircle className="h-6 w-6 text-amber-500" />}
              <h2 className="text-base font-semibold text-slate-900">Import Complete</h2>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-3 rounded-lg bg-green-50">
                <p className="text-2xl font-bold text-green-700">{result.imported}</p>
                <p className="text-xs text-green-600 mt-0.5">New</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-blue-50">
                <p className="text-2xl font-bold text-blue-700">{result.updated}</p>
                <p className="text-xs text-blue-600 mt-0.5">Updated</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-red-50">
                <p className="text-2xl font-bold text-red-700">{result.skipped}</p>
                <p className="text-xs text-red-600 mt-0.5">Skipped</p>
              </div>
            </div>
            {result.imported > 0 && unmapped.length > 0 && (
              <p className="text-sm text-amber-700 text-center mt-4">
                {unmapped.length} account{unmapped.length !== 1 ? "s" : ""} need reclassification —
                go to <span className="font-medium">Reclassify</span> to complete them.
              </p>
            )}
          </div>

          {result.errors.length > 0 && (
            <div className="border border-red-200 rounded-xl overflow-hidden bg-white shadow-sm">
              <div className="px-4 py-3 bg-red-50 border-b border-red-200">
                <p className="text-sm font-medium text-red-700">{result.errors.length} account{result.errors.length !== 1 ? "s" : ""} skipped</p>
              </div>
              <div className="divide-y divide-slate-100">
                {result.errors.slice(0, 20).map((e, i) => (
                  <div key={i} className="px-4 py-2.5 flex items-start gap-3 text-sm">
                    <span className="font-medium text-slate-700 shrink-0 w-44 truncate">{e.accountName}</span>
                    <span className="text-red-600">{e.error}</span>
                  </div>
                ))}
                {result.errors.length > 20 && <div className="px-4 py-2 text-xs text-slate-400">+{result.errors.length - 20} more…</div>}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={reset}>Import Another File</Button>
            <Button onClick={() => router.push("/accounting/chart-of-accounts")}>View Chart of Accounts</Button>
          </div>
        </div>
      )}
    </div>
  )
}
