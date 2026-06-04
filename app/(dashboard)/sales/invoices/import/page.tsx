"use client"

import { useState, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
  X,
  Loader2,
} from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { cn, formatCurrency } from "@/lib/utils"
import {
  detectInvoiceFormat,
  groupZohoRows,
  groupFinosRows,
  InvoiceImportRecord,
} from "@/lib/invoices/csv-map"

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
      } else if (ch === "," && !q) {
        fields.push(field)
        field = ""
      } else {
        field += ch
      }
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

// ─── Types ────────────────────────────────────────────────────────────────────

type ImportResult = {
  imported: number
  skipped: number
  errors: Array<{ invoiceNumber: string; error: string }>
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function InvoiceImportPage() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  const [dragging, setDragging] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [format, setFormat] = useState<"finos" | "zoho" | null>(null)
  const [records, setRecords] = useState<InvoiceImportRecord[]>([])
  const [rawLineCount, setRawLineCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)

  const processFile = useCallback((file: File) => {
    setFileName(file.name)
    setResult(null)
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const { headers, rows } = parseCSV(text)
      if (!headers.length) { toast.error("Could not parse CSV file"); return }

      setRawLineCount(rows.length)
      const detected = detectInvoiceFormat(headers)
      setFormat(detected)

      const grouped =
        detected === "zoho" ? groupZohoRows(rows) : groupFinosRows(rows)
      setRecords(grouped)
    }
    reader.readAsText(file)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const file = e.dataTransfer.files[0]
      if (file?.name.endsWith(".csv")) processFile(file)
      else toast.error("Please upload a .csv file")
    },
    [processFile]
  )

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
  }

  const handleImport = async () => {
    if (!records.length) return
    setLoading(true)
    try {
      const res = await fetch("/api/invoices/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || "Import failed"); return }
      setResult(data)
      if (data.errors.length === 0) {
        toast.success(`Imported ${data.imported} invoices as DRAFT`)
      } else {
        toast.warning(`Import complete — ${data.errors.length} error(s)`)
      }
    } catch {
      toast.error("Network error — import failed")
    } finally {
      setLoading(false)
    }
  }

  const reset = () => {
    setFileName(null)
    setFormat(null)
    setRecords([])
    setRawLineCount(0)
    setResult(null)
    if (fileRef.current) fileRef.current.value = ""
  }

  const totalLines = records.reduce((s, r) => s + r.lines.length, 0)
  const preview = records.slice(0, 8)

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/sales/invoices"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-8 px-2")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Import Invoices</h1>
          <p className="text-sm text-slate-500">
            Upload a FINOS CSV or Zoho Books export — all invoices land as{" "}
            <span className="font-medium text-slate-700">DRAFT</span>, ready for you to review and post to ledger
          </p>
        </div>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-800">
        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-blue-500" />
        <div>
          <span className="font-medium">Payment data is not imported.</span> Invoice values and line items are
          imported in full. After reviewing, use <span className="font-medium">Post to Ledger</span> on the
          invoices list to raise GL journal entries and activate invoices in the books.
        </div>
      </div>

      {/* Upload Zone */}
      {!fileName && (
        <div
          className={cn(
            "border-2 border-dashed rounded-xl p-12 text-center transition-colors cursor-pointer",
            dragging
              ? "border-emerald-400 bg-emerald-50"
              : "border-slate-200 hover:border-emerald-300 hover:bg-slate-50"
          )}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
        >
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
          <Upload className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-600 font-medium">Drop your CSV here or click to browse</p>
          <p className="text-sm text-slate-400 mt-1">
            Accepts FINOS native CSV or Zoho Books invoice export
          </p>
        </div>
      )}

      {/* File Loaded — Preview */}
      {fileName && !result && (
        <div className="space-y-4">
          {/* File + Format Info */}
          <div className="flex items-center justify-between border border-slate-200 rounded-lg px-4 py-3 bg-white">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-slate-400" />
              <div>
                <p className="text-sm font-medium text-slate-900">{fileName}</p>
                <p className="text-xs text-slate-500">
                  {rawLineCount} raw rows → <span className="font-medium">{records.length} invoices</span>,{" "}
                  {totalLines} line items
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {format && (
                <Badge
                  variant="outline"
                  className={
                    format === "zoho"
                      ? "bg-orange-50 text-orange-700 border-orange-200"
                      : "bg-emerald-50 text-emerald-700 border-emerald-200"
                  }
                >
                  {format === "zoho" ? "Zoho Export" : "FINOS CSV"}
                </Badge>
              )}
              <button onClick={reset} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Preview Table */}
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
              Preview (first {preview.length} invoices)
            </p>
            <div className="border border-slate-200 rounded-xl overflow-x-auto bg-white shadow-sm">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-slate-600">Invoice #</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-600">Customer</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-600">Date</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-600">Due</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-600">Currency</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-600">Lines</th>
                    <th className="text-right px-3 py-2 font-medium text-slate-600">Total</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-600">PO Ref</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {preview.map((rec, i) => {
                    const subtotal = rec.lines.reduce((s, l) => s + l.quantity * l.rate, 0)
                    const tax = rec.lines.reduce((s, l) => s + l.quantity * l.rate * (l.taxRate / 100), 0)
                    const total = subtotal - rec.discountAmount + tax
                    return (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-mono text-slate-700 font-medium">{rec.invoiceNumber}</td>
                        <td className="px-3 py-2 text-slate-600 max-w-[160px] truncate">{rec.customerName}</td>
                        <td className="px-3 py-2 text-slate-500">{rec.invoiceDate}</td>
                        <td className="px-3 py-2 text-slate-500">{rec.dueDate}</td>
                        <td className="px-3 py-2 text-slate-500">{rec.currency}</td>
                        <td className="px-3 py-2 text-center">
                          <Badge variant="secondary" className="text-xs">{rec.lines.length}</Badge>
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-medium text-slate-900">
                          {formatCurrency(total, rec.currency)}
                        </td>
                        <td className="px-3 py-2 text-slate-400">{rec.reference || "—"}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {records.length > 8 && (
              <p className="text-xs text-slate-400 mt-1 text-right">
                +{records.length - 8} more invoices not shown
              </p>
            )}
          </div>

          {/* Import Button */}
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={reset} disabled={loading}>
              Cancel
            </Button>
            <Button onClick={handleImport} disabled={loading || !records.length}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Importing…
                </>
              ) : (
                `Import ${records.length} invoice${records.length !== 1 ? "s" : ""} as DRAFT`
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
              {result.errors.length === 0 ? (
                <CheckCircle2 className="h-6 w-6 text-green-500" />
              ) : (
                <AlertCircle className="h-6 w-6 text-amber-500" />
              )}
              <h2 className="text-base font-semibold text-slate-900">Import Complete</h2>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="text-center p-3 rounded-lg bg-green-50">
                <p className="text-2xl font-bold text-green-700">{result.imported}</p>
                <p className="text-xs text-green-600 mt-0.5">Imported as DRAFT</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-red-50">
                <p className="text-2xl font-bold text-red-700">{result.skipped}</p>
                <p className="text-xs text-red-600 mt-0.5">Skipped</p>
              </div>
            </div>
            {result.imported > 0 && (
              <p className="text-sm text-slate-500 text-center">
                Go to invoices list → select invoices → <span className="font-medium text-slate-700">Post to Ledger</span> to raise GL journal entries
              </p>
            )}
          </div>

          {result.errors.length > 0 && (
            <div className="border border-red-200 rounded-xl overflow-hidden bg-white shadow-sm">
              <div className="px-4 py-3 bg-red-50 border-b border-red-200">
                <p className="text-sm font-medium text-red-700">
                  {result.errors.length} invoice{result.errors.length !== 1 ? "s" : ""} skipped
                </p>
              </div>
              <div className="divide-y divide-slate-100">
                {result.errors.slice(0, 20).map((e, i) => (
                  <div key={i} className="px-4 py-2.5 flex items-start gap-3 text-sm">
                    <span className="font-mono text-xs text-slate-400 shrink-0 pt-0.5 w-28 truncate">{e.invoiceNumber}</span>
                    <span className="text-red-600">{e.error}</span>
                  </div>
                ))}
                {result.errors.length > 20 && (
                  <div className="px-4 py-2 text-xs text-slate-400">+{result.errors.length - 20} more…</div>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={reset}>Import Another File</Button>
            <Button onClick={() => router.push("/sales/invoices")}>View Invoices</Button>
          </div>
        </div>
      )}
    </div>
  )
}
