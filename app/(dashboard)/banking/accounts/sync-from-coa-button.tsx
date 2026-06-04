"use client"

import { useState, useTransition } from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { syncBankAccountsFromCoa } from "./actions"

export function SyncFromCoaButton() {
  const [pending, startTransition] = useTransition()
  const [ran, setRan] = useState(false)

  function handleSync() {
    startTransition(async () => {
      const result = await syncBankAccountsFromCoa()
      setRan(true)
      if (result.created === 0 && result.skipped === 0) {
        toast.info("No Bank or Cash accounts found in Chart of Accounts")
      } else if (result.created === 0) {
        toast.info(`All ${result.skipped} bank/cash COA accounts already exist`)
      } else {
        toast.success(
          `Created ${result.created} bank account${result.created !== 1 ? "s" : ""}` +
          (result.skipped > 0 ? ` · ${result.skipped} already existed` : ""),
          {
            description: result.names.length > 0
              ? result.names.slice(0, 5).join(", ") + (result.names.length > 5 ? ` +${result.names.length - 5} more` : "")
              : undefined,
          }
        )
      }
    })
  }

  return (
    <Button variant="outline" size="sm" onClick={handleSync} disabled={pending || ran}>
      <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${pending ? "animate-spin" : ""}`} />
      {pending ? "Syncing…" : ran ? "Synced" : "Sync from COA"}
    </Button>
  )
}
