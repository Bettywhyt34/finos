/**
 * Sync engine — orchestrates all data sync operations across Revflow,
 * XpenxFlow, and EARNMARK360.
 *
 * Responsibilities:
 *   1. Create an audit SyncLog row before every sync
 *   2. Enqueue the job to BullMQ
 *   3. Update SyncLog + IntegrationConnection on completion / failure
 *   4. Quarantine records that fail to parse / map — never block the batch
 *
 * server-only — uses Prisma and encrypted credentials.
 */
import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { enqueueSync, type SourceApp, type SyncType, type SyncJobPayload } from "./bullmq-queue";

type JsonObject = Prisma.InputJsonObject;

// ─── Public result type ───────────────────────────────────────────────────────

export interface SyncResult {
  processed: number;
  created: number;
  updated: number;
  failed: number;
  quarantined: number;
  nextCursor?: string;
  error?: string;
}

// ─── Start a sync ─────────────────────────────────────────────────────────────

/**
 * Creates a SyncLog, enqueues the job, and returns the log ID + BullMQ job ID.
 * Safe to call from server actions or API routes.
 */
export async function startSync(
  tenantId: string,
  sourceApp: SourceApp,
  syncType: SyncType = "incremental",
  triggeredBy = "system"
): Promise<{ syncLogId: string; jobId: string }> {
  // 1. Verify the connection exists and is eligible for sync
  const connection = await prisma.integrationConnection.findUnique({
    where: { tenantId_sourceApp: { tenantId, sourceApp } },
  });

  if (!connection) {
    throw new Error(
      `No ${sourceApp} integration found for this organization. Connect it first.`
    );
  }
  if (!connection.syncEnabled) {
    throw new Error(`Sync is disabled for ${sourceApp}. Enable it in Integration Settings.`);
  }
  if (connection.status === "ERROR" && syncType === "incremental") {
    throw new Error(
      `${sourceApp} is in ERROR state. Run a manual (full) sync to reset.`
    );
  }
  if (!connection.apiKeyEncrypted) {
    throw new Error(`${sourceApp} has no API key configured.`);
  }

  // 2. Create an immutable sync log row
  const cursorFrom =
    syncType === "incremental" ? (connection.lastSyncCursor ?? undefined) : undefined;

  const syncLog = await prisma.syncLog.create({
    data: {
      tenantId,
      connectionId: connection.id,
      sourceApp,
      syncType,
      status: "RUNNING",
      triggeredBy,
      cursorFrom: cursorFrom ?? null,
    },
  });

  // 3. Mark connection as "syncing" so the dashboard shows the right state
  await prisma.integrationConnection.update({
    where: { id: connection.id },
    data: { status: "CONNECTING" },
  });

  // 4. Enqueue the BullMQ job
  const payload: SyncJobPayload = {
    syncLogId: syncLog.id,
    tenantId,
    sourceApp,
    syncType,
    connectionId: connection.id,
    cursor: cursorFrom,
  };

  const jobId = await enqueueSync(payload);

  return { syncLogId: syncLog.id, jobId };
}

// ─── Complete a sync (called by the worker) ───────────────────────────────────

/**
 * Finalises a sync run: updates SyncLog status, advances the cursor,
 * and sets IntegrationConnection.status to CONNECTED or ERROR.
 */
export async function completeSyncJob(
  syncLogId: string,
  connectionId: string,
  result: SyncResult
): Promise<void> {
  const status: string = result.error
    ? "FAILED"
    : result.quarantined > 0
    ? "PARTIAL"
    : "SUCCESS";

  await prisma.$transaction([
    prisma.syncLog.update({
      where: { id: syncLogId },
      data: {
        status,
        completedAt: new Date(),
        cursorTo: result.nextCursor ?? null,
        recordsProcessed: result.processed,
        recordsCreated: result.created,
        recordsUpdated: result.updated,
        recordsFailed: result.failed,
        recordsQuarantined: result.quarantined,
        errorMessage: result.error ?? null,
      },
    }),
    prisma.integrationConnection.update({
      where: { id: connectionId },
      data: {
        status: result.error ? "ERROR" : "CONNECTED",
        lastSyncAt: new Date(),
        lastSyncCursor: result.nextCursor ?? undefined,
        lastError: result.error ?? null,
      },
    }),
  ]);
}

// ─── Quarantine a failed record ───────────────────────────────────────────────

/**
 * Saves a record that could not be processed so it can be reviewed and retried.
 * Always call this instead of throwing — it keeps the batch moving.
 */
export async function quarantineRecord(
  tenantId: string,
  syncLogId: string,
  sourceApp: SourceApp,
  sourceTable: string,
  sourceId: string,
  rawData: JsonObject,
  errorReason: string
): Promise<void> {
  await prisma.syncQuarantine.create({
    data: {
      tenantId,
      syncLogId,
      sourceApp,
      sourceTable,
      sourceId,
      rawData,
      errorReason,
    },
  });
}

// ─── Upsert cached record ─────────────────────────────────────────────────────

/**
 * Write-through cache for synced source records (avoids repeated API round-trips).
 * Called by each source-specific sync handler after parsing a valid record.
 */
export async function upsertCache(
  tenantId: string,
  sourceApp: SourceApp,
  sourceTable: string,
  sourceId: string,
  data: JsonObject,
  recognitionPeriod?: string
): Promise<void> {
  await prisma.unifiedTransactionsCache.upsert({
    where: {
      tenantId_sourceApp_sourceTable_sourceId: {
        tenantId,
        sourceApp,
        sourceTable,
        sourceId,
      },
    },
    create: {
      tenantId,
      sourceApp,
      sourceTable,
      sourceId,
      dataJson: data,
      recognitionPeriod: recognitionPeriod ?? null,
      syncedAt: new Date(),
    },
    update: {
      dataJson: data,
      recognitionPeriod: recognitionPeriod ?? null,
      syncedAt: new Date(),
    },
  });
}

// ─── Account mapping helpers ──────────────────────────────────────────────────

/** Resolves a source account code to a FINOS ChartOfAccounts ID. */
export async function resolveAccountMapping(
  tenantId: string,
  sourceApp: SourceApp,
  sourceAccountCode: string
): Promise<string | null> {
  const mapping = await prisma.accountMapping.findUnique({
    where: {
      tenantId_sourceApp_sourceAccountCode: {
        tenantId,
        sourceApp,
        sourceAccountCode,
      },
    },
    select: { finosAccountId: true, isActive: true },
  });

  if (!mapping || !mapping.isActive) return null;
  return mapping.finosAccountId;
}

/** Bulk-resolves multiple source account codes in one DB query. */
export async function resolveAccountMappings(
  tenantId: string,
  sourceApp: SourceApp,
  sourceAccountCodes: string[]
): Promise<Map<string, string>> {
  const mappings = await prisma.accountMapping.findMany({
    where: {
      tenantId,
      sourceApp,
      sourceAccountCode: { in: sourceAccountCodes },
      isActive: true,
    },
    select: { sourceAccountCode: true, finosAccountId: true },
  });

  return new Map(mappings.map((m) => [m.sourceAccountCode, m.finosAccountId]));
}

// ─── Integration status queries ───────────────────────────────────────────────

/** Returns connection status + recent sync logs for the integration dashboard. */
export async function getIntegrationStatus(tenantId: string) {
  const [connections, recentLogs, quarantineCount] = await Promise.all([
    prisma.integrationConnection.findMany({
      where: { tenantId },
      orderBy: { sourceApp: "asc" },
    }),
    prisma.syncLog.findMany({
      where: { tenantId },
      orderBy: { startedAt: "desc" },
      take: 30,
    }),
    prisma.syncQuarantine.count({
      where: { tenantId, resolved: false },
    }),
  ]);

  return { connections, recentLogs, quarantineCount };
}

/** Returns unresolved quarantine records, optionally filtered by source. */
export async function getQuarantineRecords(
  tenantId: string,
  sourceApp?: SourceApp,
  page = 1,
  pageSize = 50
) {
  const where = {
    tenantId,
    resolved: false,
    ...(sourceApp ? { sourceApp } : {}),
  };

  const [records, total] = await Promise.all([
    prisma.syncQuarantine.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.syncQuarantine.count({ where }),
  ]);

  return { records, total, pages: Math.ceil(total / pageSize) };
}

// ─── Retry quarantined records ────────────────────────────────────────────────

/**
 * Marks quarantine records as retry-eligible and enqueues a manual sync
 * for the source app. The worker will re-attempt these records.
 */
export async function retryQuarantine(
  tenantId: string,
  sourceApp: SourceApp,
  quarantineIds: string[],
  userId: string
): Promise<void> {
  await prisma.syncQuarantine.updateMany({
    where: {
      id: { in: quarantineIds },
      tenantId,
      sourceApp,
      resolved: false,
    },
    data: { retryCount: { increment: 1 } },
  });

  await startSync(tenantId, sourceApp, "manual", userId);
}

// ─── Mark quarantine records resolved ────────────────────────────────────────

export async function resolveQuarantine(
  tenantId: string,
  quarantineIds: string[]
): Promise<void> {
  await prisma.syncQuarantine.updateMany({
    where: { id: { in: quarantineIds }, tenantId },
    data: { resolved: true, resolvedAt: new Date() },
  });
}
