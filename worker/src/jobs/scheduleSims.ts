/**
 * The loop back into the simulation queue.
 *
 * Called once a resume has been ingested successfully. Two things can be
 * scheduled from here, and they cost very different amounts:
 *
 *   PRIME — always. Three model calls that write the opening question of each
 *           round, so the candidate's first question is already on disk when
 *           they press Start. That turn is the one they wait on with nothing to
 *           look at, and this removes it.
 *
 *   AUDIT — sampled (`SIM_AUDIT_RATE`, 5% by default). A full loop-back
 *           interview, roughly 34 model calls. Running it on every upload would
 *           multiply the cost of an ingest by an order of magnitude to learn
 *           something a sample already tells us.
 *
 * Nothing in here is allowed to fail an ingest that has already landed. The
 * resume is the product; the simulation is an optimisation and a test harness,
 * and a queue that is briefly unavailable must not turn a successful upload into
 * a failed one.
 */

import {
  newSimRunId,
  pickAuditPersona,
  shouldAudit,
  simIdempotencyKey,
  simJobId,
  type InterviewSimJob,
  type SimPersona,
  type SimPurpose,
  type SimStatus,
} from '../../../shared/simulation.js';
import { ROUNDS, type Round } from '../../../shared/interview.js';
import { config, hasModelProvider, logger } from '../config.js';
import { query } from '../db.js';
import { interviewSimQueue } from '../queues.js';

/** The round every simulation starts from; the jobs chain on from there. */
const FIRST_ROUND: Round = ROUNDS[0] ?? 'technical';

/** A type alias, not an interface: `query<T>` constrains T to `pg.QueryResultRow`,
 *  and only anonymous types and aliases get the implicit index signature that
 *  satisfies it. */
type ClaimRow = {
  id: string;
  status: SimStatus;
  is_new: boolean;
  requeued: boolean;
};

/**
 * Claim a simulation row and push its first round, or do nothing.
 *
 * `claim_sim_job` is the arbiter: it takes the per-user advisory lock, folds a
 * duplicate into the existing row through the idempotency index, and reports
 * whether this caller is the one that should actually spend tokens. Deciding
 * that here — by reading the table first — would let two pods both decide yes.
 */
async function schedule(
  userId: string,
  contentHash: string,
  purpose: SimPurpose,
  persona?: SimPersona,
): Promise<boolean> {
  const key = simIdempotencyKey(userId, contentHash, purpose, persona);

  const rows = await query<ClaimRow>(
    'select * from claim_sim_job($1::text, $2::text, $3::text, $4::text, $5::text)',
    [userId, key, contentHash, purpose, persona ?? null],
  );
  const claim = rows[0];
  if (!claim) throw new Error('claim_sim_job returned no row');

  if (!claim.is_new && !claim.requeued) {
    // Already queued, already running, or already done for this exact resume
    // version. Re-running it would buy an identical set of openers.
    logger.debug({ userId, purpose, status: claim.status }, 'sim already exists; not enqueuing');
    return false;
  }

  // A new run id on every claim, including a revival: the previous run's job ids
  // may still be in the queue's completed history, and BullMQ would silently
  // drop an add that reused one.
  const payload: InterviewSimJob = {
    simId: claim.id,
    userId,
    purpose,
    contentHash,
    round: FIRST_ROUND,
    runId: newSimRunId(),
    ...(persona ? { persona } : {}),
  };

  await interviewSimQueue()
    .add(`${purpose}:${FIRST_ROUND}`, payload, {
      jobId: simJobId(payload.simId, payload.runId, FIRST_ROUND),
    })
    .catch(async (err: unknown) => {
      // The row is claimed but nothing will ever run it. Leaving it `queued`
      // would turn its idempotency key into a tombstone: every later upload of
      // this resume folds into a simulation that never starts. Failing it is
      // what `claim_sim_job`'s revive path is for. (The sweeper would catch it
      // eventually; doing it here means the next upload works, not the one
      // half an hour from now.)
      await query('select fail_sim_job($1::uuid, $2::text)', [
        claim.id,
        'Could not be enqueued.',
      ]).catch(() => undefined);
      throw err;
    });

  logger.info(
    { simId: claim.id, purpose, persona, revived: claim.requeued },
    'simulation enqueued',
  );
  return true;
}

/**
 * Schedule whatever this resume has earned. Never throws.
 *
 * A failure that leaves a claimed row with no job behind it is unwound by
 * `schedule` itself, and `reap_stalled_sims` is the backstop for the case where
 * this process dies between the claim and the push. Either way the row ends up
 * `failed`, which is a state `claim_sim_job` can revive — `queued` is not.
 */
export async function scheduleSimulations(userId: string, contentHash: string): Promise<void> {
  if (!config.enableInterviewSim) return;
  if (!hasModelProvider()) {
    logger.warn('skipping simulations: no model provider configured');
    return;
  }

  try {
    await schedule(userId, contentHash, 'prime');
  } catch (err) {
    logger.warn({ err: (err as Error).message, userId }, 'could not schedule prime simulation');
  }

  if (!shouldAudit(contentHash, config.simAuditRate)) return;

  try {
    await schedule(userId, contentHash, 'audit', pickAuditPersona(contentHash));
  } catch (err) {
    logger.warn({ err: (err as Error).message, userId }, 'could not schedule audit simulation');
  }
}
