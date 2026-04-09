/**
 * BullMQ queue configuration with Upstash Redis.
 * server-only — queue handles and connections must never reach the browser.
 *
 * Env variables required:
 *   UPSTASH_REDIS_URL   Full Redis URL, e.g. rediss://default:TOKEN@host:port
 */
import "server-only";
import { Queue, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";

// ─── Source app types ─────────────────────────────────────────────────────────

export const SOURCE_APPS = ["revflow", "xpenxflow", "earnmark360", "bettywhyt"] as const;
export type SourceApp = (typeof SOURCE_APPS)[number];

export const SYNC_TYPES = ["full", "incremental", "manual", "webhook"] as const;
export type SyncType = (typeof SYNC_TYPES)[number];

// ─── Queue names ──────────────────────────────────────────────────────────────

export const QUEUE_NAMES = {
  revflow:     "finos:sync:revflow",
  xpenxflow:   "finos:sync:xpenxflow",
  earnmark360: "finos:sync:earnmark360",
  bettywhyt:   "finos:sync:bettywhyt",
} as const satisfies Record<SourceApp, string>;

// ─── Job payload (serialised into Redis) ─────────────────────────────────────

export interface SyncJobPayload {
  syncLogId: string;
  organizationId: string;
  sourceApp: SourceApp;
  syncType: SyncType;
  connectionId: string;
  cursor?: string; // starting cursor for incremental syncs
}

// ─── Redis connection factory ─────────────────────────────────────────────────
// Each queue / worker needs its own connection.
// Upstash requires:
//   maxRetriesPerRequest: null  (BullMQ blocks commands; non-null causes timeout errors)
//   enableReadyCheck: false     (Upstash is serverless — there is no persistent ready event)

export function createRedisConnection(): IORedis {
  const url = process.env.UPSTASH_REDIS_URL;
  if (!url) throw new Error("UPSTASH_REDIS_URL is not set");

  return new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    // Upstash only accepts TLS (rediss://). If using a plain redis:// URL in dev, omit tls.
    tls: url.startsWith("rediss://") ? {} : undefined,
    // Reconnect automatically on network hiccup
    retryStrategy: (times) => Math.min(times * 500, 10_000),
  });
}

// ─── Default job options ──────────────────────────────────────────────────────

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 5_000 },
  removeOnComplete: { count: 200, age: 60 * 60 * 24 * 7 },  // keep 200 / 7 days
  removeOnFail:    { count: 500, age: 60 * 60 * 24 * 30 },  // keep 500 / 30 days
};

// ─── Lazy queue singletons ────────────────────────────────────────────────────
// Queues are created once per process and reused. In Next.js each serverless
// invocation is a fresh process, so this effectively creates one queue per call
// but ioredis re-uses the connection pool automatically.

const _queues = new Map<SourceApp, Queue>();

export function getQueue(sourceApp: SourceApp): Queue {
  if (!_queues.has(sourceApp)) {
    _queues.set(
      sourceApp,
      new Queue(QUEUE_NAMES[sourceApp], {
        connection: createRedisConnection() as unknown as ConnectionOptions,
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      })
    );
  }
  return _queues.get(sourceApp)!;
}

// ─── Enqueue helpers ──────────────────────────────────────────────────────────

/** Adds a sync job to the queue. Returns the BullMQ job ID. */
export async function enqueueSync(payload: SyncJobPayload): Promise<string> {
  const queue = getQueue(payload.sourceApp);

  // Use a deterministic jobId so a second enqueue for the same sync-log is a no-op.
  const jobId = `${payload.organizationId}:${payload.sourceApp}:${payload.syncLogId}`;

  const job = await queue.add("sync", payload, { jobId });
  return job.id ?? jobId;
}

/** Returns queue-level metrics for the integration health dashboard. */
export async function getQueueMetrics(sourceApp: SourceApp) {
  const queue = getQueue(sourceApp);
  const [waiting, active, completed, failed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
  ]);
  return { waiting, active, completed, failed };
}
