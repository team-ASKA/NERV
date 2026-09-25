/**
 * Interview simulation — the contracts for the offline agents that interview a
 * synthetic candidate with the *production* persona.
 *
 * Two jobs, deliberately different in cost, because at 10k users the difference
 * between "always" and "sometimes" is the whole budget:
 *
 *   PRIME  — three LLM calls, runs after every successful resume ingest. It
 *            generates the opening question for each round and stores it, so
 *            the candidate's very first question is already written when they
 *            press Start. That turn is the one the user waits on with nothing
 *            to look at, and priming removes it entirely.
 *
 *   AUDIT  — a full loop-back interview: a candidate agent answers in a chosen
 *            persona, the interviewer responds with the real prompt, and a
 *            critic grades the *interviewer*. Sampled, not universal. This is
 *            how a bad prompt is caught by us instead of by a candidate.
 *
 * The interviewer used in both is imported from `./interview.js` — the same
 * module the deployed handler imports. A simulation of a different interviewer
 * would be worse than none: it would report confidently on somebody who does
 * not exist.
 *
 * Dependency-free, runtime-agnostic, `.js` specifiers (the worker compiles this
 * tree as real Node ESM).
 */

import type { Round } from './interview.js';
import { ROUNDS } from './interview.js';

// ---------------------------------------------------------------------------
// Job lifecycle
// ---------------------------------------------------------------------------

export type SimPurpose = 'prime' | 'audit';

export type SimStatus =
  | 'queued'
  | 'running'
  | 'critiquing'
  | 'done'
  | 'failed'
  | 'cancelled';

export const SIM_TERMINAL_STATUSES: readonly SimStatus[] = ['done', 'failed', 'cancelled'];

export function isSimTerminal(status: SimStatus): boolean {
  return SIM_TERMINAL_STATUSES.includes(status);
}

export const SIM_JOB_ATTEMPTS = 2;

/**
 * Retry policy. Fewer attempts than resume ingestion on purpose: nobody is
 * waiting on a simulation, and every retry spends real tokens. One retry covers
 * a transient provider blip; a second would mostly re-pay for a genuine fault.
 *
 * As with ingestion, the producer sets this and the consumer reads
 * `job.opts.attempts` to recognise its last attempt, so the two must agree.
 */
export const SIM_JOB_OPTIONS = {
  attempts: SIM_JOB_ATTEMPTS,
  backoff: { type: 'exponential', delay: 10_000 },
  removeOnComplete: { age: 3_600, count: 500 },
  removeOnFail: { age: 86_400, count: 2_000 },
} as const;

export interface InterviewSimJob {
  /** Row id in `interview_sims`. The worker writes status against this. */
  simId: string;
  userId: string;
  purpose: SimPurpose;
  /** sha256 of the resume this sim was built from — the version identifier. */
  contentHash: string;
  /** Audit only. Ignored for `prime`, which has no candidate. */
  persona?: SimPersona;
  /**
   * The round this job runs. A sim covers all three, but one job per round:
   * each finishes in seconds instead of a minute, a failure re-runs a third of
   * the work, and the queue stays responsive under load. The job for the last
   * round is the one that triggers the critique.
   */
  round: Round;
  /**
   * One pass through the three rounds. See `simJobId` — this is what makes a
   * chained job's queue id deterministic within a run and distinct across runs.
   */
  runId: string;
}

/**
 * A fresh run identifier. Not a uuid on purpose: it only has to be unique among
 * the runs of one simulation, and it ends up inside a queue key.
 */
export function newSimRunId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * The BullMQ job id for one round.
 *
 * Deterministic in (sim, run, round) because these jobs enqueue each other: if a
 * round finishes its work, enqueues its successor, and is then killed before
 * BullMQ marks it complete, the retry re-enqueues the *same* id and BullMQ drops
 * it. Without that, one crash would fork the chain — two `core` jobs, then four
 * `hr` jobs — and each fork costs a full round of tokens.
 *
 * The run id is in the key because a completed job id is not reusable while it
 * is still in the queue's history. A revived simulation gets a new run, so its
 * first round is not silently swallowed as a duplicate of the run that failed.
 */
export function simJobId(simId: string, runId: string, round: Round): string {
  return `${simId}:${runId}:${round}`;
}

/**
 * Rounds in the order a sim walks them, and the helper that chains one job to
 * the next. Returning `null` at the end is what stops the loop — the agents
 * enqueue their own follow-up work, so a missing terminator is an infinite
 * queue, not a stuck job.
 */
export function nextSimRound(round: Round): Round | null {
  const i = ROUNDS.indexOf(round);
  if (i < 0 || i >= ROUNDS.length - 1) return null;
  return ROUNDS[i + 1] ?? null;
}

/**
 * Idempotency key. Scoped to user + resume version + purpose + persona, so:
 *   • re-uploading the same resume does not re-run a sim that already exists,
 *   • a new resume version does,
 *   • prime and audit never collide,
 *   • two personas can audit the same resume independently.
 * The round is not part of the key: all three rounds belong to one sim row.
 */
export function simIdempotencyKey(
  userId: string,
  contentHash: string,
  purpose: SimPurpose,
  persona?: SimPersona,
): string {
  const suffix = purpose === 'audit' ? `:${persona ?? 'average'}` : '';
  return `sim:${userId}:${contentHash}:${purpose}${suffix}`;
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

/** Share of ingests that also get a full audit. Tune with SIM_AUDIT_RATE. */
export const SIM_AUDIT_SAMPLE_RATE = 0.05;

/**
 * Whether this resume should be audited as well as primed.
 *
 * Derived from the content hash rather than `Math.random()` so the answer is
 * stable: a retried or duplicated enqueue makes the same decision, which is
 * what keeps the idempotency key meaningful. A coin flip here would let one
 * upload create an audit on its second attempt that its first attempt decided
 * against.
 */
export function shouldAudit(contentHash: string, rate = SIM_AUDIT_SAMPLE_RATE): boolean {
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  // Top 4 hex digits → 0..65535. Uniform for a sha256, and cheap.
  const bucket = parseInt(contentHash.slice(0, 4), 16);
  if (!Number.isFinite(bucket)) return false;
  return bucket / 0x10000 < rate;
}

/**
 * Which synthetic candidate audits this resume.
 *
 * Deterministic for the same reason `shouldAudit` is: the persona is part of the
 * idempotency key, so a retried enqueue that picked a different one would create
 * a second audit rather than folding into the first. Drawn from a different slice
 * of the hash than `shouldAudit` so the sampled population is not skewed toward
 * one persona — the low buckets that pass sampling would otherwise all map to
 * the same candidate.
 */
export function pickAuditPersona(contentHash: string): SimPersona {
  const bucket = parseInt(contentHash.slice(4, 8), 16);
  const index = Number.isFinite(bucket) ? bucket % SIM_PERSONAS.length : 0;
  return SIM_PERSONAS[index] ?? 'average';
}

// ---------------------------------------------------------------------------
// Candidate personas
// ---------------------------------------------------------------------------

export type SimPersona = 'strong' | 'average' | 'weak' | 'rambling';

export const SIM_PERSONAS: readonly SimPersona[] = ['strong', 'average', 'weak', 'rambling'];

export interface SimPersonaSpec {
  id: SimPersona;
  label: string;
  /** Dropped into the candidate agent's system prompt verbatim. */
  behaviour: string;
  /** Rough answer length the agent is asked to hit. */
  words: readonly [number, number];
  /**
   * What `estimateAnswerQuality` should read this persona as, most of the time.
   * The audit compares this against the real scores: a persona that never lands
   * in its expected band means the heuristic has drifted, and the heuristic is
   * what drives difficulty adaptation for everyone.
   */
  expectedQuality: readonly [number, number];
}

/**
 * Four candidates chosen to exercise the adaptation path end to end, not to be
 * realistic portraits: one who should make the interviewer press, one it should
 * hold steady on, one it should ease off for, and one whose answers are long
 * but empty — the case a naive length-based quality heuristic gets wrong.
 */
export const PERSONA_SPECS: Record<SimPersona, SimPersonaSpec> = {
  strong: {
    id: 'strong',
    label: 'Strong candidate',
    behaviour:
      'You are an excellent candidate. Answer precisely and concretely: name the actual approach, give complexity or numbers where they apply, and explain one trade-off you weighed. Stay on the question. Never pad.',
    words: [70, 130],
    expectedQuality: [0.65, 1],
  },
  average: {
    id: 'average',
    label: 'Average candidate',
    behaviour:
      'You are a competent but unpolished candidate. Answer correctly in broad strokes, with one concrete detail and some vagueness elsewhere. Occasionally hedge. Do not volunteer complexity analysis unless asked.',
    words: [45, 80],
    expectedQuality: [0.42, 0.7],
  },
  weak: {
    id: 'weak',
    label: 'Struggling candidate',
    behaviour:
      'You are out of your depth on anything beyond the basics. Give short, uncertain answers. On roughly one question in three, admit you do not know rather than guessing. Never invent confident-sounding detail.',
    words: [10, 30],
    expectedQuality: [0, 0.42],
  },
  rambling: {
    id: 'rambling',
    label: 'Rambling candidate',
    behaviour:
      'You talk at length and say little. Restate the question, drift into background and context, use filler ("basically", "you know", "kind of"), and reach the actual point only glancingly, if at all. Stay polite and enthusiastic.',
    words: [150, 260],
    expectedQuality: [0, 0.55],
  },
};

/** Turns the candidate agent answers per round. Matches the live default. */
export const SIM_TURNS_PER_ROUND = 5;

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface SimTurn {
  round: Round;
  /** 0-based position within the round. */
  index: number;
  role: 'interviewer' | 'candidate';
  text: string;
  /** Wall-clock ms the generating call took. Absent for replayed text. */
  latencyMs?: number;
  /** Interviewer turns only: `estimateAnswerQuality` of the answer it followed. */
  priorAnswerScore?: number;
}

export interface SimRoundResult {
  round: Round;
  /** The opening question — what `prime` exists to produce. */
  opener: string;
  turns: SimTurn[];
  findings: SimFinding[];
}

/** What the Dashboard reads so question one costs no LLM time. */
export type PrimedOpeners = Partial<Record<Round, string>>;

// ---------------------------------------------------------------------------
// Critique
// ---------------------------------------------------------------------------

export type SimFindingCode =
  | 'too_long'
  | 'multi_question'
  | 'formatting'
  | 'persona_break'
  | 'repeated'
  | 'ungrounded'
  | 'hostile'
  | 'off_round'
  | 'ignored_answer';

export type SimSeverity = 'info' | 'warn' | 'error';

export interface SimFinding {
  code: SimFindingCode;
  severity: SimSeverity;
  /** Which interviewer turn it is about. */
  turnIndex: number;
  round: Round;
  detail: string;
  /** True when a local rule produced it rather than the critic model. */
  deterministic: boolean;
}

export interface SimCritique {
  /** 0..1. Share of interviewer turns with no error-level finding. */
  score: number;
  findings: SimFinding[];
  /** One or two sentences from the critic model. Empty when unavailable. */
  verdict: string;
}

// ---------------------------------------------------------------------------
// Deterministic inspection
// ---------------------------------------------------------------------------

/**
 * The rules that need no model.
 *
 * Length, stacked questions, markdown leaking into speech and persona breaks
 * are all mechanically checkable, and checking them locally means they are
 * caught on every turn of every sim for free — rather than depending on a
 * critic model that costs money and sometimes overlooks them. The critic is
 * left with the judgement calls it is actually needed for: whether a question
 * was grounded in the resume, whether it belonged to this round, and whether it
 * was unkind.
 */

/** Persona says 1–3 sentences, 15–45 words. Past 60 the TTS reply drags. */
const MAX_WORDS = 60;
const WARN_WORDS = 50;
const MAX_SENTENCES = 3;

const MARKDOWN = /(^|\n)\s*(?:[-*•]\s|#{1,6}\s|\d+\.\s)|\*\*|`|^>\s/m;
// eslint-disable-next-line no-misleading-character-class
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
const AI_TELL =
  /\b(as an ai|language model|i am an ai|my (?:training|prompt|instructions)|system prompt|as a large language model|i cannot (?:see|hear) you because i am)\b/i;
const STAGE_DIRECTION = /(^|\s)[[(]\s*(?:pause|smiles?|nods?|laughs?|beat)\b/i;

const STOPWORDS = new Set([
  'a', 'about', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'could', 'did',
  'do', 'does', 'for', 'from', 'had', 'has', 'have', 'how', 'i', 'if', 'in', 'is', 'it', 'its',
  'just', 'me', 'my', 'of', 'on', 'or', 'so', 'that', 'the', 'their', 'them', 'then', 'there',
  'these', 'they', 'this', 'to', 'up', 'was', 'we', 'were', 'what', 'when', 'where', 'which',
  'who', 'why', 'will', 'with', 'would', 'you', 'your',
]);

function contentTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

/**
 * Jaccard overlap of content words. Crude, but it reliably catches the failure
 * that actually happens — the same question asked again in different words —
 * without an embedding call per turn.
 */
export function questionSimilarity(a: string, b: string): number {
  const ta = contentTokens(a);
  const tb = contentTokens(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / (ta.size + tb.size - shared);
}

/** Above this, two questions are the same question. */
export const REPEAT_THRESHOLD = 0.6;

function countSentences(text: string): number {
  return (text.match(/[.!?]+(?:\s|$)/g) ?? []).length || 1;
}

/**
 * Check one interviewer turn against the mechanical rules. Pure, so the browser
 * can run it too — the live `/api/interview/next` path uses it to notice a
 * malformed reply before speaking it.
 */
export function inspectQuestion(
  text: string,
  round: Round,
  turnIndex: number,
  priorQuestions: readonly string[] = [],
): SimFinding[] {
  const findings: SimFinding[] = [];
  const add = (code: SimFindingCode, severity: SimSeverity, detail: string) =>
    findings.push({ code, severity, turnIndex, round, detail, deterministic: true });

  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;

  if (words > MAX_WORDS) {
    add('too_long', 'error', `${words} words; the persona caps a spoken turn at about 45.`);
  } else if (words > WARN_WORDS) {
    add('too_long', 'warn', `${words} words — long for speech.`);
  }

  const sentences = countSentences(trimmed);
  if (sentences > MAX_SENTENCES) {
    add('too_long', 'warn', `${sentences} sentences; the persona allows up to ${MAX_SENTENCES}.`);
  }

  const questionMarks = (trimmed.match(/\?/g) ?? []).length;
  if (questionMarks > 1) {
    add('multi_question', 'error', `${questionMarks} questions stacked into one turn.`);
  }

  if (MARKDOWN.test(trimmed)) {
    add('formatting', 'error', 'Markdown in a reply that gets read aloud.');
  }
  if (EMOJI.test(trimmed)) {
    add('formatting', 'warn', 'Emoji in a spoken reply.');
  }
  if (STAGE_DIRECTION.test(trimmed)) {
    add('formatting', 'warn', 'Stage direction in a spoken reply.');
  }
  if (AI_TELL.test(trimmed)) {
    add('persona_break', 'error', 'The interviewer referred to being an AI or to its instructions.');
  }

  for (const prior of priorQuestions) {
    const sim = questionSimilarity(prior, trimmed);
    if (sim >= REPEAT_THRESHOLD) {
      add('repeated', 'error', `${(sim * 100).toFixed(0)}% overlap with an earlier question.`);
      break;
    }
  }

  return findings;
}

/** Share of interviewer turns that drew no error-level finding. */
export function scoreFindings(findings: readonly SimFinding[], interviewerTurns: number): number {
  if (interviewerTurns <= 0) return 0;
  const bad = new Set(findings.filter((f) => f.severity === 'error').map((f) => `${f.round}:${f.turnIndex}`));
  return Math.max(0, (interviewerTurns - bad.size) / interviewerTurns);
}
