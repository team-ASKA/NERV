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
import { QUEUE_RESUME_INGEST, type ResumeIngestJob } from '../../shared/ingestion.js';
import { checkRequirements, config, fatalMissing, hasModelProvider, logger } from './config.js';
import { closeDb, pingDb, query } from './db.js';
import { processResumeIngest } from './jobs/resumeIngest.js';
import { closeQueues } from './queues.js';
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

function startSweeper(): void {
  const timer = setInterval(() => {
    void query<{ reap_stalled_jobs: number }>('select reap_stalled_jobs() as reap_stalled_jobs')
      .then((rows) => {
        const reaped = rows[0]?.reap_stalled_jobs ?? 0;
        if (reaped > 0) logger.warn({ reaped }, 'reaped stalled jobs');
      })
      .catch((err) => logger.warn({ err: (err as Error).message }, 'sweeper failed'));
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
        const [redis, db, storage] = await Promise.all([
          missing.length ? Promise.resolve(false) : pingRedis(),
          missing.length ? Promise.resolve(false) : pingDb(),
          missing.length ? Promise.resolve(false) : pingStorage(),
        ]);
        const ready = consuming && redis && db && storage;
        res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify(
            {
              ready,
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
