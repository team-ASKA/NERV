/**
 * The interview simulation job — the loop-back that interviews a synthetic
 * candidate with the production persona.
 *
 * One job per round, three rounds per simulation, each enqueuing the next:
 *
 *   technical ──► core ──► hr ──► (audit only) critique ──► done
 *
 * Why one job per round rather than one per simulation: a round finishes in
 * seconds instead of a minute, a failure re-runs a third of the work instead of
 * all of it, and the queue stays responsive while an audit is in flight. The
 * chain terminates because `nextSimRound` returns null at `hr` — a self-enqueuing
 * job with no terminator is an infinite queue, not a stuck job.
 *
 * Replay safety is the same story as ingestion: enforced by the database and the
 * queue, not by checking first and hoping.
 *   • `record_sim_turn` upserts on (sim_id, round, idx), so a retried round
 *     overwrites its turns instead of doubling them.
 *   • `finish_sim_round` drops the round's previous findings before appending,
 *     so a retry cannot double-count a finding.
 *   • the follow-up job carries a deterministic id from `simJobId`, so a round
 *     that enqueued its successor and *then* died does not fork the chain.
 */

import { UnrecoverableError, type Job } from 'bullmq';
import { estimateAnswerQuality } from '../../../shared/adaptation.js';
import { coerceResume, type ResumeContext, type Round, type TranscriptTurn } from '../../../shared/interview.js';
import {
  inspectQuestion,
  isSimTerminal,
  nextSimRound,
  scoreFindings,
  simJobId,
  SIM_TURNS_PER_ROUND,
  type InterviewSimJob,
  type SimFinding,
  type SimPersona,
  type SimPurpose,
  type SimStatus,
  type SimTurn,
} from '../../../shared/simulation.js';
import { answerAsCandidate } from '../agents/candidate.js';
import { critiqueRound, summarizeAudit } from '../agents/critic.js';
import { askInterviewer } from '../agents/interviewer.js';
import { logger } from '../config.js';
import { query } from '../db.js';
import { interviewSimQueue } from '../queues.js';

/** Matches the ingestion pipeline. The DB sweeper is the outer safety net. */
const HEARTBEAT_MS = 15_000;

/** Defensive cap on stored turn text. Both agents are capped far below this. */
const MAX_TURN_CHARS = 4_000;

/** A failure that will fail identically on every retry. Never retried. */
class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentError';
  }
}

// ---------------------------------------------------------------------------
// Row bookkeeping
// ---------------------------------------------------------------------------

/** A type alias, not an interface: `query<T>` constrains T to `pg.QueryResultRow`,
 *  and only anonymous types and aliases get the implicit index signature that
 *  satisfies it. */
type SimRow = {
  status: SimStatus;
  purpose: SimPurpose;
  persona: SimPersona | null;
};

async function readSim(simId: string): Promise<SimRow | null> {
  const rows = await query<SimRow>(
    'select status, purpose, persona from interview_sims where id = $1',
    [simId],
  );
  return rows[0] ?? null;
}

/**
 * Advance the simulation's status.
 *
 * Guarded like `setStatus` in the ingestion job: a simulation a sweeper already
 * failed, or that a duplicate worker already finished, must not be dragged back
 * into an in-flight state by a straggler.
 */
async function setSimStatus(simId: string, status: SimStatus, error?: string): Promise<void> {
  await query(
    `update interview_sims
        set status       = $2::sim_status,
            heartbeat_at = now(),
            error        = case when $3::text is null then error else $3::text end,
            finished_at  = case when $2 in ('done','failed','cancelled') then now() else finished_at end
      where id = $1
        and status not in ('done','failed','cancelled')`,
    [simId, status, error ?? null],
  );
}

function startHeartbeat(simId: string): () => void {
  const timer = setInterval(() => {
    void query('select touch_sim_heartbeat($1::uuid)', [simId]).catch((err) =>
      logger.warn({ simId, err: (err as Error).message }, 'sim heartbeat failed'),
    );
  }, HEARTBEAT_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

async function recordTurn(simId: string, turn: SimTurn): Promise<void> {
  await query(
    'select record_sim_turn($1::uuid, $2::text, $3::int, $4::text, $5::text, $6::int, $7::real)',
    [
      simId,
      turn.round,
      turn.index,
      turn.role,
      turn.text.slice(0, MAX_TURN_CHARS),
      turn.latencyMs ?? null,
      turn.priorAnswerScore ?? null,
    ],
  );
}

/**
 * Load the exact resume version this simulation was created for.
 *
 * Scoped by content hash rather than "the user's latest": openers written
 * against a resume the candidate has since replaced would be grounded in work
 * they no longer claim, which is the one thing this product must never do.
 */
async function loadResume(userId: string, contentHash: string): Promise<ResumeContext> {
  const rows = await query<{ resume_data: unknown }>(
    'select resume_data from resumes where user_id = $1 and content_hash = $2 limit 1',
    [userId, contentHash],
  );
  const row = rows[0];
  if (!row) {
    // The resume was pruned (we keep only the N most recent per user) or never
    // landed. Either way this simulation can no longer produce grounded
    // questions, and a retry would read the same empty result.
    throw new PermanentError('The resume this simulation was built from no longer exists.');
  }
  return coerceResume(row.resume_data);
}

// ---------------------------------------------------------------------------
// The rounds
// ---------------------------------------------------------------------------

interface RoundOutcome {
  opener: string;
  turnCount: number;
  findings: SimFinding[];
  degradedTurns: number;
}

/**
 * PRIME: generate this round's opening question and nothing else.
 *
 * Exactly one model call. The prompt is byte-identical to what the live handler
 * builds for an opening turn — empty transcript, no camera read, so
 * `adaptationBlock` contributes nothing on either side — and that is what makes
 * it legitimate to later speak this text to a real candidate as question one.
 */
async function runPrimeRound(
  simId: string,
  round: Round,
  resume: ResumeContext,
): Promise<RoundOutcome> {
  const asked = await askInterviewer({ round, resume, transcript: [] });

  await recordTurn(simId, {
    round,
    index: 0,
    role: 'interviewer',
    text: asked.text,
    latencyMs: asked.latencyMs,
  });

  return {
    opener: asked.text,
    turnCount: 1,
    // Free, and it means a malformed opener is never cached and then spoken to a
    // candidate as though it were fine.
    findings: asked.degraded ? [] : inspectQuestion(asked.text, round, 0, []),
    degradedTurns: asked.degraded ? 1 : 0,
  };
}

/**
 * AUDIT: a full round against the candidate agent.
 *
 * Strictly sequential, because sequence is what is under test — the
 * interviewer's turn N depends on answer N-1, and the question the audit exists
 * to answer is whether difficulty and tone actually track what was said.
 */
async function runAuditRound(
  simId: string,
  round: Round,
  resume: ResumeContext,
  persona: SimPersona,
): Promise<RoundOutcome> {
  const transcript: TranscriptTurn[] = [];
  const turns: SimTurn[] = [];
  const findings: SimFinding[] = [];
  const priorQuestions: string[] = [];
  let opener = '';
  let degradedTurns = 0;
  let priorAnswerScore: number | undefined;

  for (let exchange = 0; exchange < SIM_TURNS_PER_ROUND; exchange++) {
    // Interleaved indices: interviewer on even, candidate on odd. The same index
    // keys the database row, the deterministic finding, and the line number the
    // critic quotes — so every finding traces back to the turn that earned it.
    const questionIndex = exchange * 2;

    const asked = await askInterviewer({ round, resume, transcript });
    if (exchange === 0) opener = asked.text;
    if (asked.degraded) {
      degradedTurns += 1;
      logger.warn({ simId, round, questionIndex, err: asked.error }, 'interviewer degraded');
    }

    const questionTurn: SimTurn = {
      round,
      index: questionIndex,
      role: 'interviewer',
      text: asked.text,
      latencyMs: asked.latencyMs,
      ...(priorAnswerScore === undefined ? {} : { priorAnswerScore }),
    };
    turns.push(questionTurn);
    await recordTurn(simId, questionTurn);

    // Only judge turns the model actually produced. The canned fallback is by
    // construction well-formed, and crediting it as a clean turn would inflate
    // the score of a run that mostly failed to reach a provider.
    if (!asked.degraded) {
      findings.push(...inspectQuestion(asked.text, round, questionIndex, priorQuestions));
      priorQuestions.push(asked.text);
    }

    transcript.push({ role: 'interviewer', text: asked.text });

    const answer = await answerAsCandidate({ persona, round, resume, transcript, question: asked.text });
    if (answer.degraded) {
      logger.warn({ simId, round, questionIndex, err: answer.error }, 'candidate degraded');
    }

    const answerTurn: SimTurn = {
      round,
      index: questionIndex + 1,
      role: 'candidate',
      text: answer.text,
      latencyMs: answer.latencyMs,
    };
    turns.push(answerTurn);
    await recordTurn(simId, answerTurn);

    transcript.push({ role: 'candidate', text: answer.text });
    priorAnswerScore = estimateAnswerQuality(answer.text).score;
  }

  const critique = await critiqueRound({ round, resume, turns });
  if (critique.degraded) {
    logger.warn({ simId, round, err: critique.error }, 'critic unavailable for this round');
  }
  findings.push(...critique.findings);

  return { opener, turnCount: turns.length, findings, degradedTurns };
}

// ---------------------------------------------------------------------------
// Chaining and finalization
// ---------------------------------------------------------------------------

/** Hand the next round to the queue. Returns false when this was the last one. */
async function enqueueNextRound(data: InterviewSimJob): Promise<boolean> {
  const next = nextSimRound(data.round);
  if (!next) return false;

  // Park the row *before* the push. `running` has to mean "a worker is holding
  // this", or the stall sweeper fails simulations that are merely waiting their
  // turn behind a backlog. Writing it after the push would race the next round's
  // own `running` and could stomp it back to `queued`.
  await setSimStatus(data.simId, 'queued');

  const payload: InterviewSimJob = { ...data, round: next };
  await interviewSimQueue().add(`${data.purpose}:${next}`, payload, {
    jobId: simJobId(data.simId, data.runId, next),
  });
  return true;
}

async function readTally(simId: string): Promise<{ findings: SimFinding[]; interviewerTurns: number }> {
  const rows = await query<{ findings: SimFinding[] | null; interviewer_turns: number | null }>(
    `select s.findings,
            (select count(*)::int
               from interview_sim_turns t
              where t.sim_id = s.id and t.role = 'interviewer') as interviewer_turns
       from interview_sims s
      where s.id = $1`,
    [simId],
  );
  const row = rows[0];
  return {
    findings: Array.isArray(row?.findings) ? row.findings : [],
    interviewerTurns: row?.interviewer_turns ?? 0,
  };
}

/**
 * Close the simulation after its last round.
 *
 * A prime sim has nothing to score — its three openers either exist or they
 * don't, and `claim_sim_job` is what notices a `done` prime that is missing one.
 * An audit is scored from the findings already on the row, so the score always
 * matches the findings a reader can see beside it.
 */
async function finalize(simId: string, purpose: SimPurpose): Promise<number | undefined> {
  if (purpose === 'prime') {
    await query('select finish_sim_job($1::uuid, null, null)', [simId]);
    return undefined;
  }

  await setSimStatus(simId, 'critiquing');
  const { findings, interviewerTurns } = await readTally(simId);
  const score = scoreFindings(findings, interviewerTurns);
  const verdict = await summarizeAudit({ score, findings, interviewerTurns });

  await query('select finish_sim_job($1::uuid, $2::real, $3::text)', [simId, score, verdict || null]);
  return score;
}

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------

export interface SimOutcome {
  simId: string;
  round: Round;
  turns: number;
  findings: number;
  /** Present only on the job that closed an audit. */
  score?: number;
  /** True when the simulation was already terminal and this was a replay. */
  skipped?: boolean;
}

export async function processInterviewSim(job: Job<InterviewSimJob>): Promise<SimOutcome> {
  const { simId, userId, purpose, contentHash, round } = job.data;
  const log = logger.child({ simId, round, purpose, bullId: job.id, attempt: job.attemptsMade + 1 });

  const sim = await readSim(simId);
  if (!sim) throw new PermanentError(`Simulation ${simId} no longer exists.`);
  if (isSimTerminal(sim.status)) {
    // Cancelled, already failed, or already finished. Replaying work that landed
    // is what idempotency is for, not an error.
    log.info({ status: sim.status }, 'sim already terminal; skipping');
    return { simId, round, turns: 0, findings: 0, skipped: true };
  }

  const stopHeartbeat = startHeartbeat(simId);
  const started = Date.now();

  try {
    // Counts round attempts, not simulation attempts: a clean prime sim reads 3.
    // That is the number worth watching, because it rises exactly when a round is
    // burning retries — and retries here cost real tokens.
    await query('update interview_sims set attempts = attempts + 1 where id = $1', [simId]);
    await setSimStatus(simId, 'running');

    const resume = await loadResume(userId, contentHash);

    const outcome =
      purpose === 'prime'
        ? await runPrimeRound(simId, round, resume)
        : await runAuditRound(simId, round, resume, sim.persona ?? job.data.persona ?? 'average');

    if (!outcome.opener.trim()) {
      // Both agents substitute a canned line rather than returning nothing, so
      // an empty opener means something upstream of them is wrong.
      throw new Error('the round produced no opening question');
    }

    await query('select finish_sim_round($1::uuid, $2::text, $3::text, $4::jsonb)', [
      simId,
      round,
      outcome.opener,
      JSON.stringify(outcome.findings),
    ]);

    // Enqueued last, after the round's own bookkeeping is durable: a crash
    // between the two would otherwise advance the chain past a round whose turns
    // were never written.
    const chained = await enqueueNextRound(job.data);
    let score: number | undefined;
    if (!chained) {
      score = await finalize(simId, purpose);

      // Best effort, and never allowed to fail a finished simulation. The
      // retention count lives in the migration so there is one policy, not two.
      void query('select prune_user_sims($1::text)', [userId]).catch((err) =>
        log.warn({ err: (err as Error).message }, 'sim prune failed'),
      );
    }

    log.info(
      {
        turns: outcome.turnCount,
        findings: outcome.findings.length,
        degradedTurns: outcome.degradedTurns,
        chained,
        score,
        ms: Date.now() - started,
      },
      chained ? 'sim round complete' : 'sim complete',
    );

    return {
      simId,
      round,
      turns: outcome.turnCount,
      findings: outcome.findings.length,
      ...(score === undefined ? {} : { score }),
    };
  } catch (err) {
    const error = err as Error;
    const permanent = error instanceof PermanentError;
    const attemptsAllowed = job.opts.attempts ?? 1;
    const lastAttempt = job.attemptsMade + 1 >= attemptsAllowed;

    if (permanent || lastAttempt) {
      await query('select fail_sim_job($1::uuid, $2::text)', [simId, error.message]).catch(() => undefined);
    } else {
      // BullMQ will retry. Park the row back in `queued` so the database sweeper
      // does not reap a simulation that is legitimately waiting on its backoff.
      await setSimStatus(simId, 'queued', error.message).catch(() => undefined);
    }

    log.error({ err: error.message, permanent, lastAttempt }, 'sim round failed');

    if (permanent) throw new UnrecoverableError(error.message);
    throw error;
  } finally {
    stopHeartbeat();
  }
}
