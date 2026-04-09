// @ts-nocheck — reference implementation for other products; not compiled as part of FINOS
/**
 * ============================================================
 * PRODUCT-SIDE: Pre-Approval Page
 * ============================================================
 * Copy this file to: app/oauth/pre-approve/page.tsx
 * in each of your other SaaS products (Revflow, XpenxFlow, EARNMARK360).
 *
 * This page is shown to the user after FINOS discovers their account.
 * It validates the pre-auth token, shows "Connect to FINOS?" and on approval
 * generates an OAuth authorization code and redirects back to FINOS.
 *
 * Required env vars:
 *   FINOS_OAUTH_CLIENT_ID=finos-production   (matches OAUTH_CONFIGS.*.clientId in FINOS)
 *   NEXT_PUBLIC_APP_URL=https://your-product.com
 * ============================================================
 */
import { redirect } from "next/navigation";
import { randomBytes } from "crypto";
// ↓ Import consumePreAuthToken from your api/discover/route.ts
import { consumePreAuthToken } from "@/app/api/discover/route";
// ↓ Replace with your product's Prisma import + auth
import { prisma } from "@/lib/prisma";

// ── Auth code store (single-use, 10-min TTL) ─────────────────────────────────
// In production, store these in your DB instead of in-memory.
const AUTH_CODES = new Map<string, { userId: string; orgId: string; expiresAt: number }>();

function generateAuthCode(userId: string, orgId: string): string {
  const code      = randomBytes(32).toString("hex");
  const expiresAt = Date.now() + 10 * 60 * 1000;
  AUTH_CODES.set(code, { userId, orgId, expiresAt });
  return code;
}

/** Called by your OAuth token endpoint to exchange the code for tokens */
export function consumeAuthCode(code: string) {
  const data = AUTH_CODES.get(code);
  if (!data)                        return null;
  if (data.expiresAt < Date.now())  { AUTH_CODES.delete(code); return null; }
  AUTH_CODES.delete(code);
  return data;
}

// ── Server component ──────────────────────────────────────────────────────────

interface PageProps {
  searchParams: { token?: string; finosState?: string; finosCallback?: string };
}

export default async function PreApprovePage({ searchParams }: PageProps) {
  const { token, finosState, finosCallback } = searchParams;

  if (!token || !finosState || !finosCallback) {
    return <ErrorPage message="Invalid or missing parameters." />;
  }

  const preAuth = consumePreAuthToken(token);
  if (!preAuth) {
    return <ErrorPage message="This link has expired or already been used." />;
  }

  // Render the approval form (the POST action handles the redirect)
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-8 max-w-md w-full space-y-6 shadow-sm">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-slate-900">Connect FINOS</h1>
          <p className="text-sm text-slate-500">
            FINOS Financial OS wants read-only access to your account.
          </p>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Organisation</p>
          <p className="text-sm font-semibold text-slate-900">{preAuth.orgName}</p>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Access requested</p>
          <ul className="space-y-1 text-sm text-slate-700">
            {["Read your data (read-only)", "Sync automatically on schedule", "No write access"].map((s) => (
              <li key={s} className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                {s}
              </li>
            ))}
          </ul>
        </div>

        {/* Approval form — server action generates code and redirects */}
        <form action={async () => {
          "use server";
          const code         = generateAuthCode(preAuth.userId, preAuth.orgId);
          const callbackUrl  = new URL(decodeURIComponent(finosCallback));
          callbackUrl.searchParams.set("code",  code);
          callbackUrl.searchParams.set("state", finosState);
          redirect(callbackUrl.toString());
        }}>
          <div className="flex gap-3">
            <button
              type="submit"
              className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-700 rounded-lg transition-colors"
            >
              Approve Access
            </button>
            <a
              href="/"
              className="flex-1 text-center px-4 py-2.5 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Cancel
            </a>
          </div>
        </form>

        <p className="text-xs text-center text-slate-400">
          You can revoke access at any time from Settings → Connected Apps.
        </p>
      </div>
    </div>
  );
}

function ErrorPage({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="bg-white rounded-2xl border border-red-200 p-8 max-w-md w-full text-center space-y-3">
        <p className="text-base font-semibold text-red-700">Connection failed</p>
        <p className="text-sm text-slate-600">{message}</p>
        <a href="/" className="text-sm text-slate-500 underline">Return to dashboard</a>
      </div>
    </div>
  );
}
