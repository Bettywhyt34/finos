/**
 * POST /api/integrations/earnmark360/sync
 * Triggers an incremental or full EARNMARK360 sync job.
 * Body: { syncType?: "incremental" | "full" }
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { startSync } from "@/lib/integrations/sync-engine";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body     = await req.json().catch(() => ({}));
  const syncType = body?.syncType === "full" ? "full" : "incremental";
  const userId   = session.user.id ?? "system";

  const { syncLogId, jobId } = await startSync(
    session.user.tenantId,
    "earnmark360",
    syncType,
    userId,
  );

  return NextResponse.json({ ok: true, syncLogId, jobId });
}
