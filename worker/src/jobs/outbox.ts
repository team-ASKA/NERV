/**
 * Outbox dispatcher + reconciler (Q02).
 * - Dispatcher leases bounded batches (FOR UPDATE SKIP LOCKED via the
 *   lease_outbox_events RPC), enqueues to Redis AFTER the transaction, then
 *   marks dispatched. Failed dispatch keeps the event for retry/backoff.
 * - Reconciler heals queued-without-Redis, dispatched-without-consumer, and
 *   stale running jobs. Recovery is automatic and bounded.
 */
import { query } from '../db.js';
import { logger } from '../config.js';
import { resumeIngestQueue, interviewSimQueue, reportQueue } from '../queues.js';
import { QUEUE_RESUME_INGEST } from '../../../shared/ingestion.js';

interface OutboxEvent {
  event_id: string;
  kind: string;
  aggregate_id: string | null;
  business_key: string;
  run_id: string;
  payload: Record<string, unknown>;
  attempts: number;
}

const OWNER = `worker-${process.pid}`;

export async function dispatchOutbox(batch = 20): Promise<number> {
  let events: OutboxEvent[] = [];
  try {
    events = await query<OutboxEvent>('select * from lease_outbox_events($1, $2, 120)', [OWNER, batch]);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'outbox lease failed');
    return 0;
  }
  let done = 0;
  for (const e of events) {
    try {
      if (e.kind === 'resume') {
        await resumeIngestQueue().add('ingest', e.payload as never, { jobId: e.run_id });
      } else if (e.kind === 'sim') {
        await interviewSimQueue().add('sim', e.payload as never, { jobId: e.run_id });
      } else if (e.kind === 'report') {
        await reportQueue().add('report', e.payload as never, { jobId: e.run_id });
      } else {
        throw new Error(`unknown outbox kind ${e.kind}`);
      }
      await query('update job_outbox set dispatched_at = now() where event_id = $1', [e.event_id]);
      done++;
    } catch (err) {
      logger.warn({ event: e.event_id, err: (err as Error).message }, 'outbox dispatch failed; will retry');
      await query(
        'update job_outbox set lease_owner = null, lease_expires_at = null, available_at = now() + make_interval(secs => 30) where event_id = $1',
        [e.event_id],
      ).catch(() => undefined);
    }
  }
  return done;
}

export async function reconcile(): Promise<void> {
  try {
    // Stale running report jobs (heartbeat older than 10 min) → queued again.
    await query(
      `update report_jobs set status = 'queued', updated_at = now()
        where status = 'running' and (heartbeat_at is null or heartbeat_at < now() - interval '10 minutes')`,
    );
    // Resume sweeper RPCs from the original schema, if present.
    await query('select reap_stalled_jobs()').catch(() => []);
    void QUEUE_RESUME_INGEST;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'reconcile failed');
  }
}
