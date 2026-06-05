"use client"

import { useState, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  Upload, FileText, CheckCircle2, AlertCircle,
  ArrowLeft, X, Loader2, Tag, ChevronRight,
  Building2, UserPlus, ArrowRightLeft,
} from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { cn, formatCurrency, formatDate } from "@/lib/utils"
import { parseZohoBillCsv, MappedBill } from "@/lib/bills/csv-map"

// ─── Types ────────────────────────────────────────────────────────────────────

type VendorResolution =
  | { action: "map"; vendorId: string; vendorName: string }
  | { action: "create" }

type ExistingVendor = { id: string; companyName: string; vendorCode: string }

type ImportResult = {
  imported: number
  updated: number
  skipped: number
  errors: Array<{ row: number; bill: string; error: string }>
}

// ─── Step indicator ───────────────────────────────────────────────────────────

function Steps({ current }: { current: 1 | 2 | 3 }) {
  const steps = ["Upload & Preview", "Resolve Vendors", "Import"]
  return (
    <div className="flex items-center gap-1 text-xs text-slate-500">
      {steps.map((label, i) => {
        const num = (i + 1) as 1 | 2 | 3
        const active = num === current
        const done = num < current
        return (
          <div key={label} className="flex items-center gap-1">
            <span className={cn(
              "flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold",
              done    ? "bg-emerald-500 text-white"
              : active ? "bg-amber-600 text-white"
              :          "bg-slate-200 text-slate-500"
            )}>
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

// ─── Status badge colours ──────────────────────────────────────────────────────

const statusColors: Record<string, string> = {
  DRAFT:    "bg-slate-100 text-slate-600",
  RECORDED: "bg-blue-100 text-blue-700",
  PARTIAL:  "bg-amber-100 text-amber-700",
  PAID:     "bg-emerald-100 text-emerald-700",
  OVERDUE:  "bg-red-100 text-red-700",
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function BillImportPage() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  // Step 1
  const [dragging, setDragging]   = useState(false)
  const [fileName, setFileName]   = useState<string | null>(null)
  const [allBills, setAllBills]   = useState<MappedBill[]>([])
  const [preview, setPreview]     = useState<MappedBill[]>([])

  // Step 2
  const [unknownVendors, setUnknownVendors]     = useState<string[]>([])
  const [existingVendors, setExistingVendors]   = useState<ExistingVendor[]>([])
  const [resolutions, setResolutions]           = useState<Record<string, VendorResolution>>({})
  const [loadingVendors, setLoadingVendors]     = useState(false)

  // Step 3 / result
  const [loading, setLoading]   = useState(false)
  const [result, setResult]     = useState<ImportResult | null>(null)

  // Derived step
  const step: 1 | 2 | 3 = result ? 3 : unknownVendors.length > 0 ? 2 : 1

  // ── File processing ───────────────────────────────────────────────────────

  const processFile = useCallback((file: File) => {
    setFileName(file.name)
    setResult(null)
    setUnknownVendors([])
    setResolutions({})

    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const { bills, skipped } = parseZohoBillCsv(text)

      if (!bills.length) {
        toast.error("No bills found — check the file format")
        return
      }
      if (skipped > 0) {
        toast.warning(`${skipped} row(s) skipped (missing Bill ID or Vendor Name)`)
      }

      setAllBills(bills)
      setPreview(bills.slice(0, 10))
    }
    reader.readAsText(file)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault(); setDragging(false)
      const file = e.dataTransfer.files[0]
      if (file?.name.endsWith(".csv")) processFile(file)
      else toast.error("Please upload a .csv file")
    },
    [processFile]
  )

  // ── Check vendors (transition Step 1 → Step 2 or straight to import) ─────

  async function checkVendors() {
    if (!allBills.length) return
    setLoadingVendors(true)
    try {
      const res = await fetch("/api/vendors")
      const data = await res.json()
      const vendors: ExistingVendor[] = data.vendors ?? []
      setExistingVendors(vendors)

      const knownNames = new Set(vendors.map((v) => v.companyName.toLowerCase().trim()))
      const csvNames = Array.from(new Set(allBills.map((b) => b.vendorName.toLowerCase().trim())))
      const unknown = csvNames
        .filter((n) => n && !knownNames.has(n))
        .map((n) => allBills.find((b) => b.vendorName.toLowerCase().trim() === n)!.vendorName)

      if (unknown.length === 0) {
        await doImport({})
      } else {
        setUnknownVendors(unknown)
      }
    } catch {
      toast.error("Could not verify vendors — please try again")
    } finally {
      setLoadingVendors(false)
    }
  }

  // ── Import ────────────────────────────────────────────────────────────────

  async function doImport(vendorResolutions: Record<string, VendorResolution>) {
    setLoading(true)
    try {
      const payload: Record<string, { action: string; vendorId?: string }> = {}
      for (const [name, res] of Object.entries(vendorResolutions)) {
        payload[name] = res.action === "map"
          ? { action: "map", vendorId: res.vendorId }
          : { action: "create" }
      }
      const res = await fetch("/api/purchases/bills/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bills: allBills, vendorResolutions: payload }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || "Import failed"); return }
      setResult(data)
      if (data.errors.length === 0) {
        toast.success(`Imported ${data.imported} bill${data.imported !== 1 ? "s" : ""}`)
      } else {
        toast.warning(`Import complete with ${data.errors.length} error(s)`)
      }
    } catch {
      toast.error("Network error — import failed")
    } finally {
      setLoading(false)
    }
  }

  function handleConfirmResolutions() {
    const unresolved = unknownVendors.filter((n) => !resolutions[n])
    if (unresolved.length) {
      toast.error("Please resolve all vendors before importing")
      return
    }
    doImport(resolutions)
  }

  const reset = () => {
    setFileName(null); setAllBills([]); setPreview([])
    setResult(null); setUnknownVendors([]); setResolutions({})
    if (fileRef.current) fileRef.current.value = ""
  }

  const totalValue   = allBills.reduce((s, b) => s + b.totalAmount, 0)
  const withCampaign = allBills.filter((b) => b.campaignRef).length
  const allResolved  = unknownVendors.length > 0 && unknownVendors.every((n) => !!resolutions[n])

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/purchases/bills"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-8 px-2")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-slate-900">Import Bills</h1>
          <p className="text-sm text-slate-500">
            Upload a Zoho Books bill export CSV — grouped by Bill ID, deduplicated on re-import
          </p>
        </div>
        {fileName && !result && <Steps current={step} />}
      </div>

      {/* ── STEP 1: Upload ───────────────────────────────────────────────────── */}
      {!fileName && (
        <div
          className={cn(
            "border-2 border-dashed rounded-xl p-12 text-center transition-colors cursor-pointer",
            dragging
              ? "border-amber-400 bg-amber-50"
              : "border-slate-200 hover:border-amber-300 hover:bg-slate-50"
          )}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
        >
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f) }} />
          <Upload className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-600 font-medium">Drop your Zoho bill export CSV here</p>
          <p className="text-sm text-slate-400 mt-1">
            Zoho Books → Purchases → Bills → Export as CSV
          </p>
        </div>
      )}

      {/* ── STEP 1: Preview ──────────────────────────────────────────────────── */}
      {fileName && step === 1 && !result && (
        <div className="space-y-4">
          <div className="flex items-center justify-between border border-slate-200 rounded-lg px-4 py-3 bg-white">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-slate-400" />
              <div>
                <p className="text-sm font-medium text-slate-900">{fileName}</p>
                <p className="text-xs text-slate-500">
                  {allBills.length} bills · {formatCurrency(totalValue)} total
                  {withCampaign > 0 && ` · ${withCampaign} with campaign`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="secondary" className="bg-orange-100 text-orange-700 border-orange-200">
                Zoho Export
              </Badge>
              <button onClick={reset} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
              Preview (first {preview.length} bills)
            </p>
            <div className="border border-slate-200 rounded-xl overflow-x-auto bg-white shadow-sm">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-slate-600">Bill #</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-600">Vendor</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-600">Date</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-600">Due</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-600">Lines</th>
                    <th className="text-right px-3 py-2 font-medium text-slate-600">Total</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-600">Campaign</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-600">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {preview.map((bill, i) => (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono text-slate-500">{bill.billNumber}</td>
                      <td className="px-3 py-2 font-medium text-slate-900 max-w-[140px] truncate">{bill.vendorName}</td>
                      <td className="px-3 py-2 text-slate-500">{formatDate(bill.billDate)}</td>
                      <td className="px-3 py-2 text-slate-500">{formatDate(bill.dueDate)}</td>
                      <td className="px-3 py-2 text-slate-500">{bill.lines.length}</td>
                      <td className="px-3 py-2 text-right font-medium text-slate-900">
                        {formatCurrency(bill.totalAmount)}
                      </td>
                      <td className="px-3 py-2">
                        {bill.campaignRef ? (
                          <span className="inline-flex items-center gap-1 text-purple-700">
                            <Tag className="h-3 w-3" />
                            <span className="truncate max-w-[80px]">{bill.campaignRef}</span>
                          </span>
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", statusColors[bill.status] ?? "bg-slate-100 text-slate-600")}>
                          {bill.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {allBills.length > 10 && (
              <p className="text-xs text-slate-400 mt-1 text-right">
                +{allBills.length - 10} more bills not shown
              </p>
            )}
          </div>

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={reset} disabled={loadingVendors}>Cancel</Button>
            <Button onClick={checkVendors} disabled={loadingVendors || !allBills.length}>
              {loadingVendors ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Checking vendors…</>
              ) : (
                <>Continue <ChevronRight className="h-4 w-4 ml-1" /></>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP 2: Resolve Vendors ───────────────────────────────────────────── */}
      {step === 2 && !result && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
            <Building2 className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
            <div>
              <span className="font-medium">
                {unknownVendors.length} vendor{unknownVendors.length !== 1 ? "s" : ""} not found in FINOS.
              </span>{" "}
              Map each one to an existing vendor or create it as a new vendor record.
            </div>
          </div>

          <div className="border border-slate-200 rounded-xl bg-white shadow-sm divide-y divide-slate-100">
            {unknownVendors.map((csvName) => (
              <VendorResolutionRow
                key={csvName}
                csvName={csvName}
                existingVendors={existingVendors}
                resolution={resolutions[csvName]}
                onChange={(res) => setResolutions((prev) => ({ ...prev, [csvName]: res }))}
              />
            ))}
          </div>

          <div className="flex justify-between gap-3">
            <Button
              variant="outline"
              onClick={() => { setUnknownVendors([]); setResolutions({}) }}
              disabled={loading}
            >
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
            <Button onClick={handleConfirmResolutions} disabled={loading || !allResolved}>
              {loading ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Importing…</>
              ) : (
                `Import ${allBills.length} bill${allBills.length !== 1 ? "s" : ""}`
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
          </div>

          {result.errors.length > 0 && (
            <div className="border border-red-200 rounded-xl overflow-hidden bg-white shadow-sm">
              <div className="px-4 py-3 bg-red-50 border-b border-red-200">
                <p className="text-sm font-medium text-red-700">
                  {result.errors.length} bill{result.errors.length !== 1 ? "s" : ""} skipped
                </p>
              </div>
              <div className="divide-y divide-slate-100">
                {result.errors.slice(0, 20).map((e, i) => (
                  <div key={i} className="px-4 py-2.5 flex items-start gap-3 text-sm">
                    <span className="font-mono text-xs text-slate-400 w-20 shrink-0">{e.bill}</span>
                    <span className="text-red-600">{e.error}</span>
                  </div>
                ))}
                {result.errors.length > 20 && (
                  <div className="px-4 py-2 text-xs text-slate-400">
                    +{result.errors.length - 20} more errors…
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={reset}>Import Another File</Button>
            <Button onClick={() => router.push("/purchases/bills")}>View Bills</Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Vendor Resolution Row ────────────────────────────────────────────────────

function VendorResolutionRow({
  csvName,
  existingVendors,
  resolution,
  onChange,
}: {
  csvName: string
  existingVendors: ExistingVendor[]
  resolution: VendorResolution | undefined
  onChange: (r: VendorResolution) => void
}) {
  const [search, setSearch] = useState("")
  const [open, setOpen]     = useState(false)

  const filtered = existingVendors.filter((v) =>
    v.companyName.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="px-4 py-3 flex items-center gap-4 flex-wrap sm:flex-nowrap">
      {/* CSV name */}
      <div className="w-full sm:w-56 shrink-0">
        <p className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">In CSV</p>
        <p className="text-sm font-semibold text-slate-800 truncate">{csvName}</p>
      </div>

      <ArrowRightLeft className="h-4 w-4 text-slate-300 shrink-0 hidden sm:block" />

      {/* Picker */}
      <div className="flex-1 min-w-0">
        {!resolution ? (
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                placeholder="Search existing vendors…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setOpen(true) }}
                onFocus={() => setOpen(true)}
                onBlur={() => setTimeout(() => setOpen(false), 150)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400"
              />
              {open && filtered.length > 0 && (
                <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {filtered.slice(0, 20).map((v) => (
                    <button
                      key={v.id}
                      onMouseDown={() => {
                        onChange({ action: "map", vendorId: v.id, vendorName: v.companyName })
                        setSearch(""); setOpen(false)
                      }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-amber-50 text-slate-700 flex items-center justify-between"
                    >
                      <span>{v.companyName}</span>
                      <span className="text-xs text-slate-400 font-mono">{v.vendorCode}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
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
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-medium">
              <ArrowRightLeft className="h-3 w-3" />
              Mapped to <span className="font-semibold">{resolution.vendorName}</span>
            </span>
            <button onClick={() => onChange(undefined as unknown as VendorResolution)} className="text-slate-400 hover:text-slate-600">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium">
              <UserPlus className="h-3 w-3" />
              Will be created as new vendor
            </span>
            <button onClick={() => onChange(undefined as unknown as VendorResolution)} className="text-slate-400 hover:text-slate-600">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Status dot */}
      <div className="w-6 shrink-0 flex justify-center">
        {resolution
          ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          : <div className="h-4 w-4 rounded-full border-2 border-slate-200" />}
      </div>
    </div>
  )
}
