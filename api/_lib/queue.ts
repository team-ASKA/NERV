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

/**
 * Whether BullMQ still holds a job under this id, in any state.
 *
 * Used to heal the one case the database cannot see: a row that says `queued`
 * while Redis has no such job — an enqueue that failed after the row was
 * written, or a flushed instance. Without this the row would sit queued
 * forever, because the claim function correctly reports it as neither new nor
 * revived and nothing would ever push it again.
 */
export async function resumeJobExists(idempotencyKey: string): Promise<boolean> {
  const job = await resumeQueue().getJob(idempotencyKey);
  return Boolean(job);
}
