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
import { parseZohoExpenseCsv, MappedExpense } from "@/lib/expenses/csv-map"

type ImportResult = {
  imported: number
  updated: number
  skipped: number
  errors: Array<{ row: number; ref: string; error: string }>
}

const statusColors: Record<string, string> = {
  DRAFT:      "bg-slate-100 text-slate-600",
  PENDING:    "bg-amber-100 text-amber-700",
  APPROVED:   "bg-blue-100 text-blue-700",
  REIMBURSED: "bg-emerald-100 text-emerald-700",
  REJECTED:   "bg-red-100 text-red-700",
}

export default function ExpenseImportPage() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  const [dragging, setDragging]       = useState(false)
  const [fileName, setFileName]       = useState<string | null>(null)
  const [allExpenses, setAllExpenses] = useState<MappedExpense[]>([])
  const [preview, setPreview]         = useState<MappedExpense[]>([])
  const [loading, setLoading]         = useState(false)
  const [result, setResult]           = useState<ImportResult | null>(null)

  const processFile = useCallback((file: File) => {
    setFileName(file.name)
    setResult(null)

    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const { expenses, skipped } = parseZohoExpenseCsv(text)

      if (!expenses.length) {
        toast.error("No expenses found — check the file format")
        return
      }
      if (skipped > 0) {
        toast.warning(`${skipped} row(s) skipped (missing Reference ID or Category)`)
      }

      const withCampaign = expenses.filter((ex) => ex.campaignRef).length
      if (withCampaign > 0) {
        toast.info(`${withCampaign} expense${withCampaign !== 1 ? "s" : ""} have a campaign reference`)
      }

      setAllExpenses(expenses)
      setPreview(expenses.slice(0, 10))
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
    if (!allExpenses.length) return
    setLoading(true)
    try {
      const res = await fetch("/api/expenses/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expenses: allExpenses }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || "Import failed"); return }
      setResult(data)
      if (data.errors.length === 0) {
        toast.success(`Imported ${data.imported} expense${data.imported !== 1 ? "s" : ""}`)
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
    setAllExpenses([])
    setPreview([])
    setResult(null)
    if (fileRef.current) fileRef.current.value = ""
  }

  const totalValue    = allExpenses.reduce((s, e) => s + e.totalAmount, 0)
  const withCampaign  = allExpenses.filter((e) => e.campaignRef).length

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/expenses"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-8 px-2")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Import Expenses</h1>
          <p className="text-sm text-slate-500">
            Upload a Zoho Expense export CSV — one row per expense, deduplicated on re-import
          </p>
        </div>
      </div>

      {/* Upload zone */}
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
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
          <Upload className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-600 font-medium">Drop your Zoho Expense export CSV here</p>
          <p className="text-sm text-slate-400 mt-1">
            Zoho Expense → Reports → Expense Details → Export as CSV
          </p>
        </div>
      )}

      {/* Preview */}
      {fileName && !result && (
        <div className="space-y-4">
          {/* File info bar */}
          <div className="flex items-center justify-between border border-slate-200 rounded-lg px-4 py-3 bg-white">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-slate-400" />
              <div>
                <p className="text-sm font-medium text-slate-900">{fileName}</p>
                <p className="text-xs text-slate-500">
                  {allExpenses.length} expenses · {formatCurrency(totalValue)} total
                  {withCampaign > 0 && ` · ${withCampaign} with campaign`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="secondary" className="bg-blue-100 text-blue-700 border-blue-200">
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
              Preview (first {preview.length} expenses)
            </p>
            <div className="border border-slate-200 rounded-xl overflow-x-auto bg-white shadow-sm">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-slate-600">Ref ID</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-600">Date</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-600">Description</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-600">Category</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-600">Vendor</th>
                    <th className="text-right px-3 py-2 font-medium text-slate-600">Total</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-600">Campaign</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-600">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {preview.map((exp, i) => (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono text-slate-400 max-w-[100px] truncate">
                        {exp.externalExpenseId}
                      </td>
                      <td className="px-3 py-2 text-slate-500">{formatDate(exp.expenseDate)}</td>
                      <td className="px-3 py-2 text-slate-700 max-w-[180px] truncate">{exp.description}</td>
                      <td className="px-3 py-2 text-slate-600 max-w-[120px] truncate">{exp.categoryName}</td>
                      <td className="px-3 py-2 text-slate-500 max-w-[100px] truncate">{exp.vendor ?? "—"}</td>
                      <td className="px-3 py-2 text-right font-medium text-slate-900">
                        {formatCurrency(exp.totalAmount)}
                      </td>
                      <td className="px-3 py-2">
                        {exp.campaignRef ? (
                          <span className="inline-flex items-center gap-1 text-purple-700">
                            <Tag className="h-3 w-3" />
                            <span className="truncate max-w-[80px]">{exp.campaignRef}</span>
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", statusColors[exp.status] ?? "bg-slate-100 text-slate-600")}>
                          {exp.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {allExpenses.length > 10 && (
              <p className="text-xs text-slate-400 mt-1 text-right">
                +{allExpenses.length - 10} more expenses not shown
              </p>
            )}
          </div>

          {/* Warning */}
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
            <strong>Before importing:</strong> expense categories must already exist in FINOS (matched by name).
            Any expense with an unrecognised category will be skipped. Create missing categories under{" "}
            <Link href="/expenses/categories" className="underline">Expenses → Categories</Link> first.
          </div>

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={reset} disabled={loading}>Cancel</Button>
            <Button onClick={handleImport} disabled={loading || !allExpenses.length}>
              {loading ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Importing…</>
              ) : (
                `Import ${allExpenses.length} expense${allExpenses.length !== 1 ? "s" : ""}`
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
                  {result.errors.length} expense{result.errors.length !== 1 ? "s" : ""} skipped
                </p>
              </div>
              <div className="divide-y divide-slate-100">
                {result.errors.slice(0, 20).map((e, i) => (
                  <div key={i} className="px-4 py-2.5 flex items-start gap-3 text-sm">
                    <span className="font-mono text-xs text-slate-400 w-32 shrink-0 truncate">{e.ref}</span>
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
            <Button onClick={() => router.push("/expenses")}>View Expenses</Button>
          </div>
        </div>
      )}
    </div>
  )
}
