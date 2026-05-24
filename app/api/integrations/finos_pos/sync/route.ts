/**
 * POST /api/integrations/finos_pos/sync
 * Runs FINOS POS sync inline (no BullMQ worker — Vercel serverless).
 * Body: { syncType?: "incremental" | "full" }
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { processFinosPos } from "@/lib/integrations/finos_pos/processor";
import { completeSyncJob } from "@/lib/integrations/sync-engine";
import type { SyncType } from "@/lib/integrations/bullmq-queue";

export const maxDuration = 300;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = session.user.tenantId;
  const body     = await req.json().catch(() => ({}));
  const syncType = (body?.syncType === "full" ? "full" : "incremental") as SyncType;
  const userId   = session.user.id ?? "system";

  const connection = await prisma.integrationConnection.findUnique({
    where: { tenantId_sourceApp: { tenantId, sourceApp: "finos_pos" } },
  });

  if (!connection) {
    return NextResponse.json({ error: "FINOS POS not connected" }, { status: 400 });
  }

  const cursorFrom = syncType === "incremental"
    ? (connection.lastSyncCursor ?? undefined)
    : undefined;

  const syncLog = await prisma.syncLog.create({
    data: {
      tenantId,
      connectionId: connection.id,
      sourceApp:    "finos_pos",
      syncType,
      status:       "RUNNING",
      triggeredBy:  userId,
      cursorFrom:   cursorFrom ?? null,
    },
  });

  await prisma.integrationConnection.update({
    where: { id: connection.id },
    data:  { status: "CONNECTING" },
  });

  try {
    const result = await processFinosPos({
      syncLogId:    syncLog.id,
      tenantId,
      sourceApp:    "finos_pos",
      syncType,
      connectionId: connection.id,
      cursor:       cursorFrom,
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
