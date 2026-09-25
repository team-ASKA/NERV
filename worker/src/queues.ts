/**
 * Queue handles.
 *
 * The worker keeps producer handles too: the sweeper needs to inspect counts,
 * the resume pipeline enqueues simulations once an ingest lands, and the
 * simulation agents enqueue their own follow-up rounds.
 */

import { Queue } from 'bullmq';
import {
  QUEUE_INTERVIEW_SIM,
  QUEUE_RESUME_INGEST,
  RESUME_JOB_OPTIONS,
  type ResumeIngestJob,
} from '../../shared/ingestion.js';
import { SIM_JOB_OPTIONS, type InterviewSimJob } from '../../shared/simulation.js';
import { sharedRedis } from './redis.js';

let ingestQueue: Queue<ResumeIngestJob> | null = null;
let simQueue: Queue<InterviewSimJob> | null = null;

export function resumeIngestQueue(): Queue<ResumeIngestJob> {
  if (!ingestQueue) {
    ingestQueue = new Queue<ResumeIngestJob>(QUEUE_RESUME_INGEST, {
      connection: sharedRedis(),
      defaultJobOptions: { ...RESUME_JOB_OPTIONS },
    });
  }
  return ingestQueue;
}

export function interviewSimQueue(): Queue<InterviewSimJob> {
  if (!simQueue) {
    simQueue = new Queue<InterviewSimJob>(QUEUE_INTERVIEW_SIM, {
      connection: sharedRedis(),
      defaultJobOptions: { ...SIM_JOB_OPTIONS },
    });
  }
  return simQueue;
}

export async function closeQueues(): Promise<void> {
  const open = [ingestQueue, simQueue].filter((q): q is Queue => q !== null);
  ingestQueue = null;
  simQueue = null;
  await Promise.all(open.map((q) => q.close()));
}
