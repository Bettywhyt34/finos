/**
 * POST /api/integrations/bettywhyt/sync
 * Runs BettyWhyt sync inline (no BullMQ worker needed on Vercel serverless).
 * Body: { syncType?: "incremental" | "full" }
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isBettywhytOrg } from "@/lib/integrations/bettywhyt/guard";
import { processBettywhyt } from "@/lib/integrations/bettywhyt/processor";
import { completeSyncJob } from "@/lib/integrations/sync-engine";
import type { SyncType } from "@/lib/integrations/bullmq-queue";

export const maxDuration = 300; // Vercel Pro max; capped at plan limit automatically

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = session.user.tenantId;

  if (!isBettywhytOrg(orgId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body     = await req.json().catch(() => ({}));
  const syncType = (body?.syncType === "full" ? "full" : "incremental") as SyncType;
  const userId   = session.user.id ?? "system";

  const connection = await prisma.integrationConnection.findUnique({
    where: { tenantId_sourceApp: { tenantId: orgId, sourceApp: "bettywhyt" } },
  });

  if (!connection) {
    return NextResponse.json({ error: "BettyWhyt not connected" }, { status: 400 });
  }

  const cursorFrom = syncType === "incremental"
    ? (connection.lastSyncCursor ?? undefined)
    : undefined;

  // Create sync log
  const syncLog = await prisma.syncLog.create({
    data: {
      tenantId: orgId,
      connectionId:   connection.id,
      sourceApp:      "bettywhyt",
      syncType,
      status:         "RUNNING",
      triggeredBy:    userId,
      cursorFrom:     cursorFrom ?? null,
    },
  });

  // Mark connection as syncing
  await prisma.integrationConnection.update({
    where: { id: connection.id },
    data:  { status: "CONNECTING" },
  });

  // Run processor inline — no BullMQ worker needed
  try {
    const result = await processBettywhyt({
      syncLogId:      syncLog.id,
      tenantId: orgId,
      sourceApp:      "bettywhyt",
      syncType,
      connectionId:   connection.id,
      cursor:         cursorFrom,
    });

    await completeSyncJob(syncLog.id, connection.id, result);
    return NextResponse.json({ ok: true, syncLogId: syncLog.id, ...result });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await completeSyncJob(syncLog.id, connection.id, {
      processed: 0, created: 0, updated: 0, failed: 0, quarantined: 0, error,
    });
    return NextResponse.json({ error }, { status: 500 });
  }
}
