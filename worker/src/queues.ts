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
import type { ReportJob } from './jobs/report.js';
import { sharedRedis } from './redis.js';

export const QUEUE_REPORT = 'report-generate';

let ingestQueue: Queue<ResumeIngestJob> | null = null;
let simQueue: Queue<InterviewSimJob> | null = null;
let reportQ: Queue<ReportJob> | null = null;

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
  const open = [ingestQueue, simQueue, reportQ].filter((q): q is Queue => q !== null);
  ingestQueue = null;
  simQueue = null;
  reportQ = null;
  await Promise.all(open.map((q) => q.close()));
}

/** Report queue: separate concurrency so long reports never starve uploads. */
export function reportQueue(): Queue<ReportJob> {
  if (!reportQ) {
    reportQ = new Queue<ReportJob>(QUEUE_REPORT, {
      connection: sharedRedis(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: { age: 3_600, count: 500 },
        removeOnFail: { age: 86_400, count: 2_000 },
      },
    });
  }
  return reportQ;
}
