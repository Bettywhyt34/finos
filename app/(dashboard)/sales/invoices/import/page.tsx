"use client"

import { useState, useRef, useCallback, useEffect } from "react"
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
  Users,
  ChevronRight,
  UserPlus,
  ArrowRightLeft,
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

type CustomerResolution =
  | { action: "map"; customerId: string; customerName: string }
  | { action: "create" }

type ExistingCustomer = { id: string; companyName: string }

type ImportResult = {
  imported: number
  skipped: number
  errors: Array<{ invoiceNumber: string; error: string }>
}

// ─── Step indicator ───────────────────────────────────────────────────────────

function Steps({ current }: { current: 1 | 2 | 3 }) {
  const steps = ["Upload & Preview", "Resolve Customers", "Import"]
  return (
    <div className="flex items-center gap-1 text-xs text-slate-500">
      {steps.map((label, i) => {
        const num = (i + 1) as 1 | 2 | 3
        const active = num === current
        const done = num < current
        return (
          <div key={label} className="flex items-center gap-1">
            <span
              className={cn(
                "flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold",
                done ? "bg-emerald-500 text-white" : active ? "bg-indigo-600 text-white" : "bg-slate-200 text-slate-500"
              )}
            >
              {done ? "✓" : num}
            </span>
            <span className={cn("font-medium", active ? "text-slate-800" : "text-slate-400")}>
              {label}
            </span>
            {i < steps.length - 1 && <ChevronRight className="h-3 w-3 text-slate-300 mx-0.5" />}
          </div>
        )
      })}
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function InvoiceImportPage() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  // Step 1 state
  const [dragging, setDragging] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [format, setFormat] = useState<"finos" | "zoho" | null>(null)
  const [records, setRecords] = useState<InvoiceImportRecord[]>([])
  const [rawLineCount, setRawLineCount] = useState(0)

  // Step 2 state
  const [unknownCustomers, setUnknownCustomers] = useState<string[]>([])
  const [existingCustomers, setExistingCustomers] = useState<ExistingCustomer[]>([])
  const [resolutions, setResolutions] = useState<Record<string, CustomerResolution>>({})
  const [loadingCustomers, setLoadingCustomers] = useState(false)

  // Step 3 / result state
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)

  // Derived step
  const step: 1 | 2 | 3 = result ? 3 : unknownCustomers.length > 0 ? 2 : 1

  // ── File processing ──────────────────────────────────────────────────────────

  const processFile = useCallback((file: File) => {
    setFileName(file.name)
    setResult(null)
    setUnknownCustomers([])
    setResolutions({})
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const { headers, rows } = parseCSV(text)
      if (!headers.length) { toast.error("Could not parse CSV file"); return }

      setRawLineCount(rows.length)
      const detected = detectInvoiceFormat(headers)
      setFormat(detected)
      const grouped = detected === "zoho" ? groupZohoRows(rows) : groupFinosRows(rows)
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

  // ── Check for unknown customers once records are loaded ───────────────────────

  async function checkCustomers() {
    if (!records.length) return
    setLoadingCustomers(true)
    try {
      const res = await fetch("/api/customers")
      const data = await res.json()
      const customers: ExistingCustomer[] = data.customers ?? []
      setExistingCustomers(customers)

      const knownNames = new Set(customers.map((c) => c.companyName.toLowerCase().trim()))
      const csvNames = Array.from(new Set(records.map((r) => r.customerName.toLowerCase().trim())))
      const unknown = csvNames
        .filter((n) => n && !knownNames.has(n))
        .map((n) => records.find((r) => r.customerName.toLowerCase().trim() === n)!.customerName)

      if (unknown.length === 0) {
        // No unknowns — go straight to import
        await doImport({})
      } else {
        setUnknownCustomers(unknown)
      }
    } catch {
      toast.error("Could not verify customers — please try again")
    } finally {
      setLoadingCustomers(false)
    }
  }

  // ── Import ────────────────────────────────────────────────────────────────────

  async function doImport(customerResolutions: Record<string, CustomerResolution>) {
    setLoading(true)
    try {
      // Strip the display customerName from resolutions before sending
      const payload: Record<string, { action: string; customerId?: string }> = {}
      for (const [name, res] of Object.entries(customerResolutions)) {
        payload[name] = res.action === "map"
          ? { action: "map", customerId: res.customerId }
          : { action: "create" }
      }
      const res = await fetch("/api/invoices/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records, customerResolutions: payload }),
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

  function handleConfirmResolutions() {
    // Validate all unknowns are resolved
    const unresolved = unknownCustomers.filter((n) => !resolutions[n])
    if (unresolved.length) {
      toast.error(`Please resolve all customers before importing`)
      return
    }
    doImport(resolutions)
  }

  const reset = () => {
    setFileName(null)
    setFormat(null)
    setRecords([])
    setRawLineCount(0)
    setResult(null)
    setUnknownCustomers([])
    setResolutions({})
    if (fileRef.current) fileRef.current.value = ""
  }

  const totalLines = records.reduce((s, r) => s + r.lines.length, 0)
  const preview = records.slice(0, 8)
  const allResolved = unknownCustomers.length > 0 && unknownCustomers.every((n) => !!resolutions[n])

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
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-slate-900">Import Invoices</h1>
          <p className="text-sm text-slate-500">
            Upload a FINOS CSV or Zoho Books export — all invoices land as{" "}
            <span className="font-medium text-slate-700">DRAFT</span>
          </p>
        </div>
        {fileName && !result && <Steps current={step === 1 ? 1 : step === 2 ? 2 : 3} />}
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-800">
        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-blue-500" />
        <div className="space-y-1">
          <p><span className="font-medium">Payment data is not imported.</span> Invoice values and line items are imported in full. After reviewing, use <span className="font-medium">Post to Ledger</span> on the invoices list to raise GL journal entries.</p>
          <p><span className="font-medium">Re-import safe:</span> If your CSV includes a <span className="font-medium">Transaction ID</span> column, FINOS uses it to skip already-imported records — you can re-upload the same file without creating duplicates.</p>
        </div>
      </div>

      {/* ── STEP 1: Upload Zone ─────────────────────────────────────────────── */}
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
          <p className="text-sm text-slate-400 mt-1">Accepts FINOS native CSV or Zoho Books invoice export</p>
        </div>
      )}

      {/* ── STEP 1: Preview ─────────────────────────────────────────────────── */}
      {fileName && step === 1 && !result && (
        <div className="space-y-4">
          {/* File info */}
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
                    <th className="text-left px-3 py-2 font-medium text-slate-600">Campaign ID</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-600">Transaction ID</th>
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
                        <td className="px-3 py-2 text-slate-500 max-w-[120px] truncate">
                          {rec.campaignId || <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-2 font-mono text-slate-500 max-w-[140px] truncate">
                          {rec.externalTxnId || <span className="text-slate-300">—</span>}
                        </td>
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

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={reset} disabled={loadingCustomers}>
              Cancel
            </Button>
            <Button onClick={checkCustomers} disabled={loadingCustomers || !records.length}>
              {loadingCustomers ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Checking customers…
                </>
              ) : (
                <>
                  Continue
                  <ChevronRight className="h-4 w-4 ml-1" />
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP 2: Resolve Customers ────────────────────────────────────────── */}
      {step === 2 && !result && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
            <Users className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
            <div>
              <span className="font-medium">{unknownCustomers.length} customer{unknownCustomers.length !== 1 ? "s" : ""} not found in FINOS.</span>{" "}
              For each one, either map it to an existing customer or create it as a new customer.
            </div>
          </div>

          <div className="border border-slate-200 rounded-xl bg-white shadow-sm divide-y divide-slate-100">
            {unknownCustomers.map((csvName) => {
              const resolution = resolutions[csvName]
              return (
                <CustomerResolutionRow
                  key={csvName}
                  csvName={csvName}
                  existingCustomers={existingCustomers}
                  resolution={resolution}
                  onChange={(res) => setResolutions((prev) => ({ ...prev, [csvName]: res }))}
                />
              )
            })}
          </div>

          <div className="flex justify-between gap-3">
            <Button
              variant="outline"
              onClick={() => { setUnknownCustomers([]); setResolutions({}) }}
              disabled={loading}
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
            <Button onClick={handleConfirmResolutions} disabled={loading || !allResolved}>
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

      {/* ── STEP 3: Result ───────────────────────────────────────────────────── */}
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

// ─── Customer Resolution Row ──────────────────────────────────────────────────

function CustomerResolutionRow({
  csvName,
  existingCustomers,
  resolution,
  onChange,
}: {
  csvName: string
  existingCustomers: ExistingCustomer[]
  resolution: CustomerResolution | undefined
  onChange: (r: CustomerResolution) => void
}) {
  const [search, setSearch] = useState("")
  const [open, setOpen] = useState(false)

  const filtered = existingCustomers.filter((c) =>
    c.companyName.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="px-4 py-3 flex items-center gap-4 flex-wrap sm:flex-nowrap">
      {/* CSV name */}
      <div className="w-full sm:w-56 shrink-0">
        <p className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">In CSV</p>
        <p className="text-sm font-semibold text-slate-800 truncate">{csvName}</p>
      </div>

      {/* Arrow */}
      <ArrowRightLeft className="h-4 w-4 text-slate-300 shrink-0 hidden sm:block" />

      {/* Resolution picker */}
      <div className="flex-1 min-w-0">
        {!resolution ? (
          <div className="flex items-center gap-2">
            {/* Map to existing */}
            <div className="relative flex-1">
              <input
                type="text"
                placeholder="Search existing customers…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setOpen(true) }}
                onFocus={() => setOpen(true)}
                onBlur={() => setTimeout(() => setOpen(false), 150)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
              {open && filtered.length > 0 && (
                <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {filtered.slice(0, 20).map((c) => (
                    <button
                      key={c.id}
                      onMouseDown={() => {
                        onChange({ action: "map", customerId: c.id, customerName: c.companyName })
                        setSearch("")
                        setOpen(false)
                      }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 text-slate-700"
                    >
                      {c.companyName}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Or create new */}
            <span className="text-xs text-slate-400 shrink-0">or</span>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 text-xs"
              onClick={() => onChange({ action: "create" })}
            >
              <UserPlus className="h-3.5 w-3.5 mr-1" />
              Create new
            </Button>
          </div>
        ) : resolution.action === "map" ? (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-medium">
              <ArrowRightLeft className="h-3 w-3" />
              Mapped to <span className="font-semibold">{resolution.customerName}</span>
            </span>
            <button
              onClick={() => onChange(undefined as unknown as CustomerResolution)}
              className="text-slate-400 hover:text-slate-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium">
              <UserPlus className="h-3 w-3" />
              Will be created as new customer
            </span>
            <button
              onClick={() => onChange(undefined as unknown as CustomerResolution)}
              className="text-slate-400 hover:text-slate-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Status badge */}
      <div className="w-6 shrink-0 flex justify-center">
        {resolution ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        ) : (
          <div className="h-4 w-4 rounded-full border-2 border-slate-200" />
        )}
      </div>
    </div>
  )
}
