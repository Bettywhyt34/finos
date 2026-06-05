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
import { cn } from "@/lib/utils"
import { parseZohoVendorCsv, MappedVendor } from "@/lib/vendors/csv-map"

type ImportResult = {
  imported: number
  updated: number
  skipped: number
  errors: Array<{ row: number; error: string }>
}

export default function VendorImportPage() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  const [dragging, setDragging] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [preview, setPreview] = useState<MappedVendor[]>([])
  const [allRows, setAllRows] = useState<MappedVendor[]>([])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)

  const processFile = useCallback((file: File) => {
    setFileName(file.name)
    setResult(null)

    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const { rows, skipped } = parseZohoVendorCsv(text)

      if (!rows.length) {
        toast.error("No vendor rows found — check the file format")
        return
      }
      if (skipped > 0) {
        toast.warning(`${skipped} row(s) skipped (missing Contact ID or Company Name)`)
      }

      setAllRows(rows)
      setPreview(rows.slice(0, 10))
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
    if (!allRows.length) return
    setLoading(true)
    try {
      const res = await fetch("/api/vendors/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: allRows }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || "Import failed"); return }
      setResult(data)
      if (data.errors.length === 0) {
        toast.success(`Imported ${data.imported} vendor${data.imported !== 1 ? "s" : ""}`)
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
    setPreview([])
    setAllRows([])
    setResult(null)
    if (fileRef.current) fileRef.current.value = ""
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/vendors"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-8 px-2")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Import Vendors</h1>
          <p className="text-sm text-slate-500">
            Upload a Zoho Books vendor export CSV — duplicates are matched by Zoho Contact ID
          </p>
        </div>
      </div>

      {/* Upload Zone */}
      {!fileName && (
        <div
          className={cn(
            "border-2 border-dashed rounded-xl p-12 text-center transition-colors cursor-pointer",
            dragging
              ? "border-blue-400 bg-blue-50"
              : "border-slate-200 hover:border-blue-300 hover:bg-slate-50"
          )}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleFileChange}
          />
          <Upload className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-600 font-medium">Drop your CSV here or click to browse</p>
          <p className="text-sm text-slate-400 mt-1">
            Zoho Books → Contacts → Vendors → Export as CSV
          </p>
        </div>
      )}

      {/* File Loaded — Preview */}
      {fileName && !result && (
        <div className="space-y-4">
          <div className="flex items-center justify-between border border-slate-200 rounded-lg px-4 py-3 bg-white">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-slate-400" />
              <div>
                <p className="text-sm font-medium text-slate-900">{fileName}</p>
                <p className="text-xs text-slate-500">{allRows.length} vendors detected</p>
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

          {/* Preview Table */}
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
              Preview (first {preview.length} rows)
            </p>
            <div className="border border-slate-200 rounded-xl overflow-x-auto bg-white shadow-sm">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-slate-600">Company</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-600">Contact</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-600">Email</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-600">Phone</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-600">Terms</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-600">City</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-600">Curr.</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-600">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {preview.map((row, i) => (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-medium text-slate-900 max-w-[180px] truncate">
                        {row.companyName}
                      </td>
                      <td className="px-3 py-2 text-slate-500">{row.contactName || "—"}</td>
                      <td className="px-3 py-2 text-slate-500">{row.email || "—"}</td>
                      <td className="px-3 py-2 text-slate-500">{row.phone || "—"}</td>
                      <td className="px-3 py-2 text-slate-500">
                        {row.paymentTerms === 0 ? "On receipt" : `Net ${row.paymentTerms}`}
                      </td>
                      <td className="px-3 py-2 text-slate-500">{row.billingCity || "—"}</td>
                      <td className="px-3 py-2 text-slate-500">{row.currency}</td>
                      <td className="px-3 py-2">
                        <Badge
                          variant="outline"
                          className={
                            row.isActive
                              ? "bg-green-50 text-green-700 border-green-200"
                              : "bg-red-50 text-red-700 border-red-200"
                          }
                        >
                          {row.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {allRows.length > 10 && (
              <p className="text-xs text-slate-400 mt-1 text-right">
                +{allRows.length - 10} more rows not shown
              </p>
            )}
          </div>

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={reset} disabled={loading}>
              Cancel
            </Button>
            <Button onClick={handleImport} disabled={loading || !allRows.length}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Importing…
                </>
              ) : (
                `Import ${allRows.length} vendor${allRows.length !== 1 ? "s" : ""}`
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
                  {result.errors.length} row{result.errors.length !== 1 ? "s" : ""} skipped
                </p>
              </div>
              <div className="divide-y divide-slate-100">
                {result.errors.slice(0, 20).map((e, i) => (
                  <div key={i} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                    <span className="font-mono text-xs text-slate-400 w-12">Row {e.row}</span>
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
            <Button variant="outline" onClick={reset}>
              Import Another File
            </Button>
            <Button onClick={() => router.push("/vendors")}>
              View Vendors
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
