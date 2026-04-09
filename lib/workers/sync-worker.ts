/**
 * BullMQ worker process — runs OUTSIDE Next.js, as a long-lived Node.js process.
 *
 * Start with:
 *   npx tsx lib/workers/sync-worker.ts
 *   OR in production: pm2 start lib/workers/sync-worker.ts --interpreter tsx
 *
 * Processes jobs from all three source queues concurrently.
 * Each job is dispatched to the appropriate source-specific processor.
 */
import "dotenv/config"; // load .env.local for local dev
import { Worker, type Job } from "bullmq";
import { createRedisConnection, QUEUE_NAMES, type SyncJobPayload } from "@/lib/integrations/bullmq-queue";
import { completeSyncJob } from "@/lib/integrations/sync-engine";
import { processRevflow }    from "@/lib/integrations/revflow/processor";
import { processXpenxflow }  from "@/lib/integrations/xpenxflow/processor";
import { processEarnmark360 } from "@/lib/integrations/earnmark360/processor";
import { processBettywhyt }  from "@/lib/integrations/bettywhyt/processor";

// ─── Source processor registry ────────────────────────────────────────────────

type SyncProcessor = (payload: SyncJobPayload) => Promise<{
  processed: number;
  created: number;
  updated: number;
  failed: number;
  quarantined: number;
  nextCursor?: string;
}>;

const PROCESSORS: Record<string, SyncProcessor> = {
  revflow:     processRevflow,
  xpenxflow:   processXpenxflow,
  earnmark360: processEarnmark360,
  bettywhyt:   processBettywhyt,
};

// ─── Job handler ─────────────────────────────────────────────────────────────

async function handleJob(job: Job<SyncJobPayload>): Promise<void> {
  const payload = job.data;
  const { syncLogId, connectionId, sourceApp } = payload;

  console.log(
    `[sync-worker] Starting job ${job.id}: ${sourceApp} ${payload.syncType} (log: ${syncLogId})`
  );

  const processor = PROCESSORS[sourceApp];
  if (!processor) {
    const error = `No processor registered for source: ${sourceApp}`;
    await completeSyncJob(syncLogId, connectionId, {
      processed: 0, created: 0, updated: 0, failed: 0, quarantined: 0, error,
    });
    throw new Error(error);
  }

  try {
    const result = await processor(payload);
    await completeSyncJob(syncLogId, connectionId, result);
    console.log(
      `[sync-worker] Completed ${job.id}: ${result.processed} processed, ` +
        `${result.created} created, ${result.failed} failed, ${result.quarantined} quarantined`
    );
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[sync-worker] Job ${job.id} failed:`, error);
    await completeSyncJob(syncLogId, connectionId, {
      processed: 0, created: 0, updated: 0, failed: 1, quarantined: 0, error,
    });
    throw err; // re-throw so BullMQ marks it failed and schedules retry
  }
}

// ─── Start workers (one per queue) ───────────────────────────────────────────

const workers: Worker[] = [];

for (const [sourceApp, queueName] of Object.entries(QUEUE_NAMES)) {
  const worker = new Worker<SyncJobPayload>(queueName, handleJob, {
    connection: createRedisConnection(),
    concurrency: 1, // one sync per source per org at a time (ordered by FIFO)
    limiter: { max: 5, duration: 60_000 }, // max 5 jobs/minute per source (rate limiting)
  });

  worker.on("completed", (job) => {
    console.log(`[${sourceApp}] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[${sourceApp}] Job ${job?.id} failed:`, err.message);
  });

  worker.on("error", (err) => {
    console.error(`[${sourceApp}] Worker error:`, err.message);
  });

  workers.push(worker);
  console.log(`[sync-worker] Started worker for queue: ${queueName}`);
}

console.log("[sync-worker] All workers running. Waiting for jobs...");

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown(signal: string) {
  console.log(`[sync-worker] Received ${signal}, shutting down gracefully...`);
  await Promise.all(workers.map((w) => w.close()));
  console.log("[sync-worker] All workers closed.");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
