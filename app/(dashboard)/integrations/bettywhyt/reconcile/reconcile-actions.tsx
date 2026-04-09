"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ReconcileActionsProps {
  itemId:   string;
  itemCode: string;
}

export function ReconcileActions({ itemId, itemCode }: ReconcileActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleManualSync() {
    setLoading(true);
    try {
      await fetch("/api/integrations/bettywhyt/sync", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ syncType: "full" }),
      });
      setTimeout(() => { setLoading(false); router.refresh(); }, 1500);
    } catch {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleManualSync}
      disabled={loading}
      title={`Trigger full sync to refresh ${itemCode}`}
      className="text-xs text-slate-500 hover:text-slate-800 underline disabled:opacity-50"
    >
      {loading ? "Syncing…" : "Sync"}
    </button>
  );
}
