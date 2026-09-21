/**
 * Queue handles.
 *
 * The worker keeps producer handles too: the sweeper needs to inspect counts,
 * and the interview-simulation agents enqueue follow-up work for themselves.
 */

import { Queue } from 'bullmq';
import {
  QUEUE_RESUME_INGEST,
  RESUME_JOB_OPTIONS,
  type ResumeIngestJob,
} from '../../shared/ingestion.js';
import { sharedRedis } from './redis.js';

let ingestQueue: Queue<ResumeIngestJob> | null = null;

export function resumeIngestQueue(): Queue<ResumeIngestJob> {
  if (!ingestQueue) {
    ingestQueue = new Queue<ResumeIngestJob>(QUEUE_RESUME_INGEST, {
      connection: sharedRedis(),
      defaultJobOptions: { ...RESUME_JOB_OPTIONS },
    });
  }
  return ingestQueue;
}

export async function closeQueues(): Promise<void> {
  if (ingestQueue) {
    await ingestQueue.close();
    ingestQueue = null;
  }
}
