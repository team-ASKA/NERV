/**
 * Producer-side BullMQ handle for the serverless API.
 *
 * The `Queue` is cached in module scope and shares the connection from
 * `redis.ts` with the rate limiter — see that module on why the API keeps one
 * socket per instance. We never call `queue.close()`: closing after each
 * request would mean a TCP + AUTH round trip on every upload, which is most of
 * the endpoint's latency budget.
 *
 * Nothing here consumes jobs. The consumer is the long-running `worker/`
 * service; a serverless function is frozen the moment it responds and cannot
 * hold a blocking read open.
 */

import { Queue } from 'bullmq';
import {
  QUEUE_RESUME_INGEST,
  RESUME_JOB_OPTIONS,
  type ResumeIngestJob,
} from '../../shared/ingestion';
import { hasRedis, redis } from './redis';

let ingest: Queue<ResumeIngestJob> | null = null;

export function hasQueue(): boolean {
  return hasRedis();
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
 * `dbKey` is the readable idempotency key (may contain colons); the BullMQ
 * job ID is the derived safe hex form. Redis retries of a retained failed job
 * use a NEW run ID so a tombstone can never swallow a user's retry (P0-2).
 */
export async function enqueueResumeIngest(
  dbKey: string,
  bullId: string,
  data: ResumeIngestJob,
): Promise<void> {
  await resumeQueue().add('ingest', data, { jobId: bullId });
  void dbKey;
}

/**
 * Whether BullMQ still holds a RUNNABLE job under this id.
 *
 * Existence alone is not enough (P0-2): a retained failed job exists but can
 * never run again, so a revived DB claim must reset/retry it or take a new
 * attempt ID. Returns 'runnable' | 'failed-retained' | 'missing'.
 */
export async function resumeJobState(bullId: string): Promise<'runnable' | 'failed-retained' | 'missing'> {
  const job = await resumeQueue().getJob(bullId);
  if (!job) return 'missing';
  try {
    const state = await job.getState();
    if (state === 'failed') return 'failed-retained';
    if (state === 'completed') return 'missing';
    return 'runnable';
  } catch {
    return 'missing';
  }
}

export async function resumeJobExists(bullId: string): Promise<boolean> {
  return (await resumeJobState(bullId)) === 'runnable';
}

/** Explicitly retry a retained failed job so a user correction can run. */
export async function retryResumeJob(bullId: string): Promise<void> {
  const job = await resumeQueue().getJob(bullId);
  if (job) await job.retry();
}
