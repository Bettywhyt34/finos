"use client"

import { useState, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  Upload, FileText, CheckCircle2, AlertCircle,
  ArrowLeft, X, Loader2, Tag,
} from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { cn, formatCurrency, formatDate } from "@/lib/utils"
import { parseZohoBillCsv, MappedBill } from "@/lib/bills/csv-map"

type ImportResult = {
  imported: number
  updated: number
  skipped: number
  errors: Array<{ row: number; bill: string; error: string }>
}

const statusColors: Record<string, string> = {
  DRAFT:    "bg-slate-100 text-slate-600",
  RECORDED: "bg-blue-100 text-blue-700",
  PARTIAL:  "bg-amber-100 text-amber-700",
  PAID:     "bg-emerald-100 text-emerald-700",
  OVERDUE:  "bg-red-100 text-red-700",
}

export default function BillImportPage() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  const [dragging, setDragging] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [allBills, setAllBills] = useState<MappedBill[]>([])
  const [preview, setPreview] = useState<MappedBill[]>([])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)

  const processFile = useCallback((file: File) => {
    setFileName(file.name)
    setResult(null)

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

      const withCampaign = bills.filter((b) => b.campaignRef).length
      if (withCampaign > 0) {
        toast.info(`${withCampaign} bill${withCampaign !== 1 ? "s" : ""} have a campaign reference — will be matched automatically`)
      }

      setAllBills(bills)
      setPreview(bills.slice(0, 10))
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
    if (!allBills.length) return
    setLoading(true)
    try {
      const res = await fetch("/api/purchases/bills/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bills: allBills }),
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

  const reset = () => {
    setFileName(null)
    setAllBills([])
    setPreview([])
    setResult(null)
    if (fileRef.current) fileRef.current.value = ""
  }

  // Summary stats for the loaded file
  const totalValue = allBills.reduce((s, b) => s + b.totalAmount, 0)
  const withCampaign = allBills.filter((b) => b.campaignRef).length

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
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Import Bills</h1>
          <p className="text-sm text-slate-500">
            Upload a Zoho Books bill export CSV — grouped by Bill ID, deduplicated on re-import
          </p>
        </div>
      </div>

      {/* Upload Zone */}
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
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
          <Upload className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-600 font-medium">Drop your Zoho bill export CSV here</p>
          <p className="text-sm text-slate-400 mt-1">
            Zoho Books → Purchases → Bills → Export as CSV
          </p>
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

          {/* Preview table */}
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
                      <td className="px-3 py-2 font-medium text-slate-900 max-w-[140px] truncate">
                        {bill.vendorName}
                      </td>
                      <td className="px-3 py-2 text-slate-500">{formatDate(bill.billDate)}</td>
                      <td className="px-3 py-2 text-slate-500">{formatDate(bill.dueDate)}</td>
                      <td className="px-3 py-2 text-slate-500">{bill.lines.length}</td>
                      <td className="px-3 py-2 text-right text-slate-900 font-medium">
                        {formatCurrency(bill.totalAmount)}
                      </td>
                      <td className="px-3 py-2">
                        {bill.campaignRef ? (
                          <span className="inline-flex items-center gap-1 text-purple-700">
                            <Tag className="h-3 w-3" />
                            <span className="truncate max-w-[80px]">{bill.campaignRef}</span>
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
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

          {/* Note about unmatched vendors */}
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
            <strong>Before importing:</strong> vendors must already exist in FINOS (matched by company name).
            Any bill with an unrecognised vendor will be skipped with an error. Run the vendor import first if needed.
          </div>

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={reset} disabled={loading}>Cancel</Button>
            <Button onClick={handleImport} disabled={loading || !allBills.length}>
              {loading ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Importing…</>
              ) : (
                `Import ${allBills.length} bill${allBills.length !== 1 ? "s" : ""}`
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
