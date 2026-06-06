"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { ArrowRight, BookOpen, Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { toast } from "sonner"
import { cn, formatCurrency, formatDate, toNGN } from "@/lib/utils"
import { postInvoicesToLedger } from "./actions"

const statusColors: Record<string, string> = {
  DRAFT:       "bg-slate-100 text-slate-600",
  SENT:        "bg-blue-100 text-blue-700",
  PARTIAL:     "bg-amber-100 text-amber-700",
  PAID:        "bg-emerald-100 text-emerald-700",
  OVERDUE:     "bg-red-100 text-red-700",
  WRITTEN_OFF: "bg-slate-100 text-slate-400",
}

const MS_PER_DAY = 86_400_000

function invoiceAgeDays(sentAt: Date | null, paidAt: Date | null, status: string): number | null {
  if (!sentAt) return null
  const end = status === "PAID" && paidAt ? paidAt : new Date()
  return Math.floor((end.getTime() - new Date(sentAt).getTime()) / MS_PER_DAY)
}

type InvoiceRow = {
  id: string
  invoiceNumber: string
  status: string
  currency: string
  exchangeRate: string | number
  totalAmount: string | number
  balanceDue: string | number
  issueDate: Date
  dueDate: Date
  sentAt: Date | null
  paidAt: Date | null
  customer: { companyName: string }
}

export function InvoiceListClient({ invoices }: { invoices: InvoiceRow[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pending, startTransition] = useTransition()

  const draftIds = invoices.filter((i) => i.status === "DRAFT").map((i) => i.id)
  const allDraftSelected =
    draftIds.length > 0 && draftIds.every((id) => selected.has(id))

  const toggleAll = () => {
    if (allDraftSelected) {
      setSelected((prev) => {
        const next = new Set(prev)
        draftIds.forEach((id) => next.delete(id))
        return next
      })
    } else {
      setSelected((prev) => new Set(Array.from(prev).concat(draftIds)))
    }
  }

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handlePostToLedger = () => {
    const ids = Array.from(selected)
    startTransition(async () => {
      const result = await postInvoicesToLedger(ids)
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      setSelected(new Set())
      if (result.errors.length === 0) {
        toast.success(`${result.posted} invoice${result.posted !== 1 ? "s" : ""} posted to ledger`)
      } else {
        toast.warning(`${result.posted} posted, ${result.errors.length} failed`)
      }
    })
  }

  return (
    <div className="space-y-3">
      {/* Bulk action bar — only visible when items selected */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between px-4 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200">
          <span className="text-sm font-medium text-emerald-800">
            {selected.size} invoice{selected.size !== 1 ? "s" : ""} selected
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelected(new Set())}
              disabled={pending}
              className="h-7 text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-100"
            >
              Clear
            </Button>
            <Button
              size="sm"
              onClick={handlePostToLedger}
              disabled={pending}
              className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
            >
              {pending ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Posting…</>
              ) : (
                <><BookOpen className="h-3.5 w-3.5" /> Post to Ledger</>
              )}
            </Button>
          </div>
        </div>
      )}

      <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-emerald-50 border-b border-emerald-100">
            <tr>
              <th className="px-3 py-3 w-10">
                {draftIds.length > 0 && (
                  <input
                    type="checkbox"
                    checked={allDraftSelected}
                    onChange={toggleAll}
                    title="Select all DRAFT invoices"
                    className="rounded border-slate-300 text-emerald-600 cursor-pointer"
                  />
                )}
              </th>
              <th className="text-left px-4 py-3 font-medium text-emerald-700">Number</th>
              <th className="text-left px-4 py-3 font-medium text-emerald-700">Customer</th>
              <th className="text-left px-4 py-3 font-medium text-emerald-700">Date</th>
              <th className="text-left px-4 py-3 font-medium text-emerald-700">Due</th>
              <th className="text-left px-4 py-3 font-medium text-emerald-700">Status</th>
              <th className="text-right px-4 py-3 font-medium text-emerald-700">Age</th>
              <th className="text-right px-4 py-3 font-medium text-emerald-700">Total</th>
              <th className="text-right px-4 py-3 font-medium text-emerald-700">Balance (NGN)</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {invoices.map((inv) => {
              const balance = parseFloat(String(inv.balanceDue))
              const rate = parseFloat(String(inv.exchangeRate))
              const balanceNGN = toNGN(balance, rate)
              const totalNGN = toNGN(parseFloat(String(inv.totalAmount)), rate)
              const isNGN = inv.currency === "NGN"
              const isOverdue =
                new Date(inv.dueDate) < new Date() &&
                inv.status !== "PAID" &&
                inv.status !== "WRITTEN_OFF"
              const statusKey = isOverdue ? "OVERDUE" : inv.status
              const isDraft = inv.status === "DRAFT"
              const isChecked = selected.has(inv.id)
              const ageDays = invoiceAgeDays(inv.sentAt, inv.paidAt, inv.status)

              return (
                <tr
                  key={inv.id}
                  className={cn(
                    "hover:bg-slate-50 transition-colors",
                    isChecked && "bg-emerald-50/60"
                  )}
                >
                  <td className="px-3 py-3 text-center">
                    {isDraft && (
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggle(inv.id)}
                        className="rounded border-slate-300 text-emerald-600 cursor-pointer"
                      />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/sales/invoices/${inv.id}`}
                      className="font-mono text-xs text-blue-600 hover:underline"
                    >
                      {inv.invoiceNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {inv.customer.companyName}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(inv.issueDate)}</td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(inv.dueDate)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[statusKey] ?? ""}`}
                      >
                        {statusKey}
                      </span>
                      {!isNGN && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
                          {inv.currency}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-500 text-xs">
                    {ageDays !== null ? (
                      <span className={ageDays > 60 ? "text-red-500 font-semibold" : ageDays > 30 ? "text-amber-600" : "text-slate-600"}>
                        {ageDays}d
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    <div>{formatCurrency(parseFloat(String(inv.totalAmount)), inv.currency)}</div>
                    {!isNGN && (
                      <div className="text-xs text-slate-400">≈ {formatCurrency(totalNGN)}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    <span className={balanceNGN > 0 ? "text-amber-600 font-semibold" : "text-slate-400"}>
                      {formatCurrency(balanceNGN)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/sales/invoices/${inv.id}`}
                      className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-7 px-2 text-xs")}
                    >
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
