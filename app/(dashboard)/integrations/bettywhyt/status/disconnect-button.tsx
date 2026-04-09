"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DisconnectClientButton() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading,    setLoading]    = useState(false);

  async function handleDisconnect() {
    setLoading(true);
    try {
      await fetch("/api/integrations/bettywhyt/disconnect", { method: "DELETE" });
      router.push("/integrations/bettywhyt/connect");
    } catch {
      setLoading(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="mt-2 text-sm text-red-600 hover:text-red-800 underline"
      >
        Disconnect BettyWhyt
      </button>
    );
  }

  return (
    <div className="mt-2 flex items-center gap-3">
      <span className="text-sm text-slate-600">Are you sure?</span>
      <button
        type="button"
        onClick={handleDisconnect}
        disabled={loading}
        className="text-sm font-semibold text-white bg-red-600 hover:bg-red-700 px-3 py-1.5 rounded-lg disabled:opacity-50"
      >
        {loading ? "Disconnecting…" : "Yes, disconnect"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="text-sm text-slate-500 hover:text-slate-700"
      >
        Cancel
      </button>
    </div>
  );
}
