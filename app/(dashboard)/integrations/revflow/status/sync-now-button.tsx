"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface SyncNowButtonProps {
  /** "full" shows "Full Sync" label; default shows "Sync Now" */
  variant?: "full";
}

export function SyncNowButton({ variant }: SyncNowButtonProps) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "syncing" | "done" | "error">("idle");

  async function handleSync() {
    setState("syncing");
    try {
      const res = await fetch("/api/integrations/revflow/sync", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ syncType: variant === "full" ? "full" : "incremental" }),
      });
      if (res.ok) {
        setState("done");
        setTimeout(() => { setState("idle"); router.refresh(); }, 2000);
      } else {
        setState("error");
        setTimeout(() => setState("idle"), 3000);
      }
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 3000);
    }
  }

  const label =
    state === "syncing" ? "Syncing…"
    : state === "done"  ? "Queued ✓"
    : state === "error" ? "Error"
    : variant === "full" ? "Full Sync"
    : "Sync Now";

  return (
    <button
      onClick={handleSync}
      disabled={state === "syncing" || state === "done"}
      className={
        "px-4 py-2 text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed " +
        (variant === "full"
          ? "text-slate-700 border border-slate-200 hover:bg-slate-50"
          : "text-white bg-slate-900 hover:bg-slate-700")
      }
    >
      {label}
    </button>
  );
}
