"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SyncNowButton({ variant }: { variant?: "full" }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSync() {
    setLoading(true);
    try {
      const res = await fetch("/api/integrations/finos_pos/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ syncType: variant === "full" ? "full" : "incremental" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      toast.success(
        `Sync complete — ${data.created ?? 0} created, ${data.updated ?? 0} updated`
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      variant={variant === "full" ? "outline" : "default"}
      size="sm"
      onClick={handleSync}
      disabled={loading}
    >
      {loading ? (
        <Loader2 size={14} className="mr-1 animate-spin" />
      ) : (
        <RefreshCw size={14} className="mr-1" />
      )}
      {variant === "full" ? "Full Sync" : "Sync Now"}
    </Button>
  );
}
