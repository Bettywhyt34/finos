"use client";

/**
 * Reusable "Connect with auto-discovery" UI component.
 *
 * On mount it calls POST /api/integrations/discover with the given source app.
 *  - Account found → show "We found your account" card + [Connect] + [Use Different Account]
 *  - No account    → show standard OAuth form (optional URL input + Connect button)
 *  - Discovery error → same as "no account"
 *
 * On connect, it redirects the user to the appropriate OAuth / pre-auth URL.
 */

import { useEffect, useState } from "react";

type DiscoverState =
  | { phase: "discovering" }
  | { phase: "found";     orgName: string; preAuthUrl: string }
  | { phase: "not_found" }
  | { phase: "connecting" }
  | { phase: "error";    message: string };

interface Props {
  source:       "revflow" | "xpenxflow" | "earnmark360";
  productName:  string;
  connectPath:  string;   // e.g. /api/integrations/revflow/connect
  defaultUrl?:  string;   // placeholder for the URL input
  scopes:       string[];
}

export function ConnectWithDiscovery({
  source,
  productName,
  connectPath,
  defaultUrl,
  scopes,
}: Props) {
  const [state, setState] = useState<DiscoverState>({ phase: "discovering" });
  const [customUrl, setCustomUrl] = useState("");

  // Read ?error= from the URL (set by the callback handler on failure)
  useEffect(() => {
    const sp  = new URLSearchParams(window.location.search);
    const err = sp.get("error");
    if (err) {
      setState({ phase: "error", message: decodeURIComponent(err) });
      return;
    }
    runDiscovery();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function runDiscovery() {
    setState({ phase: "discovering" });
    try {
      const res  = await fetch("/api/integrations/discover", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ source }),
      });
      const data = await res.json();

      if (data.found && data.preAuthUrl) {
        setState({ phase: "found", orgName: data.orgName, preAuthUrl: data.preAuthUrl });
      } else {
        setState({ phase: "not_found" });
      }
    } catch {
      setState({ phase: "not_found" });
    }
  }

  async function handleAutoConnect(preAuthUrl: string) {
    setState({ phase: "connecting" });
    window.location.href = preAuthUrl;
  }

  async function handleManualConnect() {
    setState({ phase: "connecting" });
    try {
      const body: Record<string, string> = {};
      if (customUrl.trim()) body.apiUrl = customUrl.trim();

      const res  = await fetch(connectPath, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok || !data.authUrl) {
        setState({ phase: "error", message: data.error ?? "Failed to initiate connection" });
        return;
      }
      window.location.href = data.authUrl;
    } catch {
      setState({ phase: "error", message: "Network error — please try again" });
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Connect {productName}</h1>
        <p className="text-sm text-slate-500 mt-1">
          Authorize FINOS to sync your {productName} data via OAuth 2.0.
        </p>
      </div>

      {/* ── Discovering ─────────────────────────────────────────────────── */}
      {state.phase === "discovering" && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 flex items-center gap-3">
          <span className="w-5 h-5 rounded-full border-2 border-slate-400 border-t-transparent animate-spin flex-shrink-0" />
          <span className="text-sm text-slate-600">
            Checking for existing {productName} account…
          </span>
        </div>
      )}

      {/* ── Account found ────────────────────────────────────────────────── */}
      {state.phase === "found" && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800">
                {productName} account found
              </p>
              <p className="text-sm text-slate-500">{state.orgName}</p>
            </div>
          </div>

          <p className="text-sm text-slate-600">
            We found a {productName} account matching your email. Click{" "}
            <strong>Connect</strong> to approve read access — no password required.
          </p>

          <div className="flex gap-3">
            <button
              onClick={() => handleAutoConnect((state as Extract<DiscoverState, { phase: "found" }>).preAuthUrl)}
              className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-700 rounded-lg transition-colors"
            >
              Connect {productName}
            </button>
            <button
              onClick={() => setState({ phase: "not_found" })}
              className="px-4 py-2.5 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Use Different Account
            </button>
          </div>
        </div>
      )}

      {/* ── No account found / manual OAuth ─────────────────────────────── */}
      {(state.phase === "not_found" || state.phase === "error") && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          {state.phase === "error" && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {state.message}
            </p>
          )}

          {state.phase === "not_found" && (
            <p className="text-sm text-slate-500">
              No {productName} account found with your email. Authorize below using your{" "}
              {productName} credentials.
            </p>
          )}

          <div className="space-y-1">
            <label className="block text-sm font-medium text-slate-700">
              {productName} URL <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              type="url"
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              placeholder={defaultUrl ?? "https://…"}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            />
            <p className="text-xs text-slate-400">
              Leave blank to use the standard {productName} URL. Only change for self-hosted instances.
            </p>
          </div>

          <button
            onClick={handleManualConnect}
            className="w-full px-5 py-2.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-700 rounded-lg transition-colors"
          >
            Connect with {productName}
          </button>
        </div>
      )}

      {/* ── Connecting (redirecting) ──────────────────────────────────────── */}
      {state.phase === "connecting" && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 flex items-center gap-3">
          <span className="w-5 h-5 rounded-full border-2 border-slate-400 border-t-transparent animate-spin flex-shrink-0" />
          <span className="text-sm text-slate-600">Redirecting to {productName}…</span>
        </div>
      )}

      {/* ── Scopes info ──────────────────────────────────────────────────── */}
      {state.phase !== "connecting" && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
          <p className="text-sm font-medium text-slate-700">What FINOS will access</p>
          <ul className="text-sm text-slate-600 space-y-1">
            {scopes.map((s) => (
              <li key={s} className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 flex-shrink-0" />
                {s}
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-400 mt-2">
            FINOS never writes to {productName}. Read-only scopes only.
          </p>
        </div>
      )}
    </div>
  );
}
