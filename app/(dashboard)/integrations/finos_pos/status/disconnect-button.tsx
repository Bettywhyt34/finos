"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function DisconnectButton() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleDisconnect() {
    if (!confirm("Disconnect FINOS POS? Existing FINOS records will be kept.")) return;
    setLoading(true);
    try {
      const res = await fetch("/api/integrations/finos_pos/disconnect", { method: "POST" });
      if (!res.ok) throw new Error();
      toast.success("FINOS POS disconnected");
      router.push("/integrations/finos_pos/connect");
    } catch {
      toast.error("Failed to disconnect");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleDisconnect}
      disabled={loading}
      className="text-red-600 border-red-200 hover:bg-red-50"
    >
      Disconnect
    </Button>
  );
}
