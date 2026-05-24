"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function FinosPosConnectPage() {
  const router  = useRouter();
  const [apiKey,  setApiKey]  = useState("");
  const [baseUrl, setBaseUrl] = useState("https://pos.finos.internal");
  const [state,   setState]   = useState<"idle" | "connecting" | "error">("idle");
  const [errMsg,  setErrMsg]  = useState("");

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setState("connecting");
    setErrMsg("");

    try {
      const res = await fetch("/api/integrations/finos_pos/connect", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ apiKey, baseUrl }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrMsg(data.error ?? "Connection failed.");
        setState("error");
        return;
      }

      router.push("/integrations/finos_pos/status");
    } catch {
      setErrMsg("Network error. Please try again.");
      setState("error");
    }
  }

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Connect FINOS POS</h1>
        <p className="text-sm text-slate-500 mt-1">
          Enter the API key from the FINOS POS system to sync in-store sales, inventory, and
          COGS into FINOS accounting.
        </p>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm">
        <p className="font-semibold text-blue-800">Required Chart of Accounts</p>
        <ul className="mt-2 space-y-0.5 text-blue-700 list-disc list-inside">
          <li><code className="bg-blue-100 px-1 rounded">IN-0011</code> — POS Sales Revenue (Income)</li>
          <li><code className="bg-blue-100 px-1 rounded">OE-005</code> — Cost of Goods Sold (Expense)</li>
          <li><code className="bg-blue-100 px-1 rounded">AS-002</code> — Inventory Asset (Asset)</li>
          <li><code className="bg-blue-100 px-1 rounded">CL-003</code> — VAT Payable (Liability)</li>
        </ul>
      </div>

      <form onSubmit={handleConnect} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="baseUrl">
            FINOS POS Base URL
          </label>
          <input
            id="baseUrl"
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://pos.finos.internal"
            required
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="apiKey">
            API Key
          </label>
          <input
            id="apiKey"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="fpos_..."
            required
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
          <p className="text-xs text-slate-400 mt-1">
            Generate this in FINOS POS → Settings → API Integrations → FINOS Finance Key.
          </p>
        </div>

        {state === "error" && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            {errMsg}
          </div>
        )}

        <button
          type="submit"
          disabled={state === "connecting"}
          className="w-full px-4 py-2.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {state === "connecting" ? "Testing & connecting…" : "Test & Connect"}
        </button>
      </form>

      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm text-slate-600">
        <p className="font-semibold text-slate-700">What gets synced</p>
        <ul className="mt-2 space-y-0.5 list-disc list-inside">
          <li>Products → FINOS Items (SKU-matched, inventory levels updated)</li>
          <li>POS sales → Invoices + GL journal entries (DR Bank / CR Revenue + VAT)</li>
          <li>COGS posted automatically (DR COGS / CR Inventory)</li>
          <li>Inventory movements recorded per sale line</li>
        </ul>
      </div>
    </div>
  );
}
