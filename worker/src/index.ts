/**
 * Worker entrypoint.
 *
 * Boots the BullMQ consumers, exposes /healthz and /readyz for the platform,
 * and shuts down without dropping work in flight.
 *
 * Deliberate choice: missing configuration does not crash the process. A
 * crash-looping container tells an operator only that it crashed; this one
 * stays up, serves a /readyz that names the exact variables it needs, and
 * starts consuming the moment they appear on the next deploy.
 */

import { Worker, type Job } from 'bullmq';
import { createServer, type Server } from 'node:http';
import {
  QUEUE_INTERVIEW_SIM,
  QUEUE_RESUME_INGEST,
  type ResumeIngestJob,
} from '../../shared/ingestion.js';
import type { InterviewSimJob } from '../../shared/simulation.js';
import { checkRequirements, config, fatalMissing, hasModelProvider, logger } from './config.js';
import { closeDb, pingDb, query } from './db.js';
import { processInterviewSim } from './jobs/interviewSim.js';
import { processResumeIngest } from './jobs/resumeIngest.js';
import { processReport } from './jobs/report.js';
import { dispatchOutbox, reconcile } from './jobs/outbox.js';
import { closeQueues, QUEUE_REPORT } from './queues.js';
import { closeRedis, createRedis, pingRedis } from './redis.js';
import { pingStorage } from './storage.js';

/** How often the DB-side sweeper looks for jobs orphaned by a dead pod. */
const REAP_INTERVAL_MS = 60_000;

const workers: Worker[] = [];
const timers: NodeJS.Timeout[] = [];
let httpServer: Server | null = null;
let shuttingDown = false;
let consuming = false;

// ---------------------------------------------------------------------------
// Consumers
// ---------------------------------------------------------------------------

function startResumeIngest(): void {
  const worker = new Worker<ResumeIngestJob>(QUEUE_RESUME_INGEST, processResumeIngest, {
    connection: createRedis(QUEUE_RESUME_INGEST),
    concurrency: config.ingestConcurrency,
    /** Vision jobs are slow; give the lock room before BullMQ calls a job
     *  stalled and hands it to a second pod. */
    lockDuration: 120_000,
    stalledInterval: 60_000,
    maxStalledCount: 2,
  });

  worker.on('failed', (job: Job<ResumeIngestJob> | undefined, err: Error) => {
    logger.error({ bullId: job?.id, jobId: job?.data?.jobId, err: err.message }, 'job failed');
  });
  worker.on('error', (err) => logger.error({ err: err.message }, 'worker error'));

  workers.push(worker);
  logger.info({ queue: QUEUE_RESUME_INGEST, concurrency: config.ingestConcurrency }, 'consumer started');
}

/**
 * The simulation consumer.
 *
 * A separate worker rather than a second queue name on the same one, so a burst
 * of audits — tens of model calls each — cannot starve resume ingestion, which
 * is the queue a user is actually waiting on. The real ceiling on both is the
 * shared token bucket in `llm/groq.ts`, not these concurrency numbers.
 */
function startInterviewSim(): void {
  const worker = new Worker<InterviewSimJob>(QUEUE_INTERVIEW_SIM, processInterviewSim, {
    connection: createRedis(QUEUE_INTERVIEW_SIM),
    concurrency: config.simConcurrency,
    /** An audit round is ~10 sequential model calls; a stall handed to a second
     *  pod would re-pay for all of them. */
    lockDuration: 300_000,
    stalledInterval: 120_000,
    maxStalledCount: 1,
  });

  worker.on('failed', (job: Job<InterviewSimJob> | undefined, err: Error) => {
    logger.error(
      { bullId: job?.id, simId: job?.data?.simId, round: job?.data?.round, err: err.message },
      'sim job failed',
    );
  });
  worker.on('error', (err) => logger.error({ err: err.message }, 'sim worker error'));

  workers.push(worker);
  logger.info({ queue: QUEUE_INTERVIEW_SIM, concurrency: config.simConcurrency }, 'consumer started');
}

function startReportWorker(): void {
  const worker = new Worker<{ sessionId: string; runId: string }>(QUEUE_REPORT, processReport as never, {
    connection: createRedis(QUEUE_REPORT),
    concurrency: 2,
    lockDuration: 300_000,
    stalledInterval: 120_000,
    maxStalledCount: 1,
  });
  worker.on('failed', (job, err: Error) => {
    logger.error({ bullId: job?.id, err: err.message }, 'report job failed');
  });
  worker.on('error', (err) => logger.error({ err: err.message }, 'report worker error'));
  workers.push(worker);
  logger.info('report consumer started');
}

function startSweeper(): void {
  const timer = setInterval(() => {
    void dispatchOutbox(20)
      .then((n) => {
        if (n > 0) logger.info({ n }, 'outbox dispatched');
      })
      .catch((err) => logger.warn({ err: (err as Error).message }, 'outbox dispatch failed'));
    void reconcile().catch((err) => logger.warn({ err: (err as Error).message }, 'reconcile failed'));
    void query('select cleanup_expired_jobs() as c')
      .then(() => undefined)
      .catch(() => undefined);

    if (!config.enableInterviewSim) return;
    void query<{ reap_stalled_sims: number }>('select reap_stalled_sims() as reap_stalled_sims')
      .then((rows) => {
        const reaped = rows[0]?.reap_stalled_sims ?? 0;
        if (reaped > 0) logger.warn({ reaped }, 'reaped stalled sims');
      })
      .catch((err) => logger.warn({ err: (err as Error).message }, 'sim sweeper failed'));
  }, REAP_INTERVAL_MS);
  timer.unref?.();
  timers.push(timer);
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

function startHealthServer(): void {
  httpServer = createServer((req, res) => {
    const url = req.url ?? '/';

    if (url === '/healthz') {
      // Liveness: the process is running. Never depends on a dependency, or a
      // Redis blip would get the container killed instead of retried.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, consuming }));
      return;
    }

    if (url === '/readyz') {
      void (async () => {
        const missing = fatalMissing();
        // Bounded probes: readiness must never hang indefinitely.
        const withDeadline = async <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> => {
          try {
            return await Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('deadline')), ms))]);
          } catch {
            return fallback;
          }
        };
        const [redis, db, storage] = await Promise.all([
          missing.length ? Promise.resolve(false) : withDeadline(pingRedis(), 5_000, false),
          missing.length ? Promise.resolve(false) : withDeadline(pingDb(), 5_000, false),
          missing.length ? Promise.resolve(false) : withDeadline(pingStorage(), 5_000, false),
        ]);
        const infraReady = consuming && redis && db && storage;
        // Readiness distinguishes healthy infra from usable interview/extraction
        // capability: a worker without a model provider is honestly "degraded".
        const capability = hasModelProvider() ? 'full' : 'infra-only';
        res.writeHead(infraReady ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify(
            {
              ready: infraReady,
              capability,
              consuming,
              missing,
              checks: { redis, db, storage, modelProvider: hasModelProvider() },
              requirements: checkRequirements(),
            },
            null,
            2,
          ),
        );
      })();
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  httpServer.listen(config.port, () => logger.info({ port: config.port }, 'health server listening'));
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  consuming = false;
  logger.info({ signal }, 'shutting down');

  for (const timer of timers) clearInterval(timer);

  // `close()` stops taking new jobs and waits for the active ones. A job
  // interrupted here would be retried anyway — the pipeline is idempotent —
  // but finishing cleanly saves the user a duplicate parse.
  const graceful = Promise.all(workers.map((w) => w.close()));
  const deadline = new Promise((resolve) => setTimeout(resolve, 25_000));
  await Promise.race([graceful, deadline]);

  await closeQueues().catch(() => undefined);
  await closeRedis().catch(() => undefined);
  await closeDb().catch(() => undefined);

  await new Promise<void>((resolve) => {
    if (!httpServer) return resolve();
    httpServer.close(() => resolve());
  });

  logger.info('shutdown complete');
  process.exit(0);
}

function main(): void {
  startHealthServer();

  const requirements = checkRequirements();
  for (const r of requirements) {
    if (r.present) continue;
    const message = `${r.name} is not set — ${r.note}`;
    if (r.fatal) logger.error({ variable: r.name }, message);
    else logger.warn({ variable: r.name }, message);
  }

  const missing = fatalMissing();
  if (missing.length > 0) {
    logger.error(
      { missing },
      'not consuming: required configuration is missing. /readyz lists what is needed; the worker will pick it up on the next deploy.',
    );
    return;
  }

  if (!hasModelProvider()) {
    logger.warn(
      'no model provider configured: resumes will be parsed with heuristics only, and scanned PDFs will be rejected.',
    );
  }

  startResumeIngest();
  startReportWorker();

  if (config.enableInterviewSim) {
    if (hasModelProvider()) {
      startInterviewSim();
    } else {
      // Every turn of a simulation is a model call. Consuming the queue without
      // a provider would spend the retry budget producing nothing but canned
      // fallbacks, and then mark the openers `done`.
      logger.warn('interview simulation is enabled but no model provider is configured; not consuming.');
    }
  } else {
    logger.info('interview simulation disabled (ENABLE_INTERVIEW_SIM)');
  }

  startSweeper();
  consuming = true;
  logger.info({ env: config.env }, 'worker ready');
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason instanceof Error ? reason.message : String(reason) }, 'unhandled rejection');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err: err.message, stack: err.stack }, 'uncaught exception');
  void shutdown('uncaughtException');
});

main();
