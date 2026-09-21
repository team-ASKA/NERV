/**
 * Producer-side BullMQ handle for the serverless API.
 *
 * Connections are cached in module scope. A warm Vercel instance reuses them
 * across invocations; a cold one pays a single connect. We never call
 * `queue.close()` — closing after each request would mean a TCP + AUTH
 * round trip on every upload, which is most of the endpoint's latency budget.
 *
 * Nothing here consumes jobs. The consumer is the long-running `worker/`
 * service; a serverless function is frozen the moment it responds and cannot
 * hold a blocking read open.
 */

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import {
  QUEUE_RESUME_INGEST,
  RESUME_JOB_OPTIONS,
  type ResumeIngestJob,
} from '../../shared/ingestion';

let connection: IORedis | null = null;
let ingest: Queue<ResumeIngestJob> | null = null;

export function hasQueue(): boolean {
  return Boolean(process.env.REDIS_URL);
}

function redis(): IORedis {
  if (connection) return connection;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set on the server.');

  connection = new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    // Buffer commands issued before the socket is up, so the first request
    // after a cold start doesn't fail on a race with the handshake.
    enableOfflineQueue: true,
    // Fail fast rather than hanging: the client is waiting on this request,
    // and a queue outage should surface as a clear error, not a timeout.
    connectTimeout: 5_000,
    retryStrategy: (times) => (times > 3 ? null : Math.min(times * 150, 600)),
    ...(url.startsWith('rediss://') ? { tls: { rejectUnauthorized: true } } : {}),
  });

  connection.on('error', (err) => console.error('[queue] redis error:', err.message));
  return connection;
}

export function resumeQueue(): Queue<ResumeIngestJob> {
  if (!ingest) {
    ingest = new Queue<ResumeIngestJob>(QUEUE_RESUME_INGEST, {
      connection: redis(),
      defaultJobOptions: { ...RESUME_JOB_OPTIONS },
    });
  }
  return ingest;
}

/**
 * Enqueue an ingestion.
 *
 * `jobId` is the idempotency key, so BullMQ itself refuses a duplicate even if
 * the database check somehow let two through — belt and braces on the one
 * operation that would otherwise bill us twice for the same parse.
 */
export async function enqueueResumeIngest(
  idempotencyKey: string,
  data: ResumeIngestJob,
): Promise<void> {
  await resumeQueue().add('ingest', data, { jobId: idempotencyKey });
}
