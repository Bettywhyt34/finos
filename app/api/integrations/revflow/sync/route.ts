/**
 * POST /api/integrations/revflow/sync
 * Triggers a manual (full or incremental) sync.
 * Body: { syncType?: "full" | "incremental" }  (default: "incremental")
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { startSync } from "@/lib/integrations/sync-engine";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orgId  = session.user.tenantId;
  const userId = session.user.id ?? "system";

  const body     = await req.json().catch(() => ({}));
  const syncType = body?.syncType === "full" ? "full" : "incremental";

  try {
    const { syncLogId, jobId } = await startSync(orgId, "revflow", syncType, userId);
    return NextResponse.json({ ok: true, syncLogId, jobId });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 422 }
    );
  }
}
