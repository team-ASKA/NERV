/**
 * The critic agent — grades the *interviewer*, not the candidate.
 *
 * It is only asked the questions a program cannot answer. Length, stacked
 * questions, markdown in speech, AI tells and near-duplicate questions are all
 * mechanically checkable, so `inspectQuestion` in `shared/simulation.ts` catches
 * them on every turn of every simulation for free. What is left needs judgement:
 *
 *   ungrounded     — invented experience the resume does not support. The single
 *                    worst failure this product can have; resume-grounded
 *                    questioning is the whole proposition.
 *   off_round      — a system-design question in the HR round, and so on.
 *   ignored_answer — asked the next question as if the candidate had not spoken.
 *   hostile        — mocked, belittled, or piled on.
 *
 * Severity is assigned here, not by the model. A critic that gets to choose
 * between "info" and "error" can quietly move the score, and the score has to
 * mean the same thing across runs and across model versions.
 */

import type { ResumeContext, Round } from '../../../shared/interview.js';
import type { SimFinding, SimFindingCode, SimSeverity, SimTurn } from '../../../shared/simulation.js';
import { completeJson, completeText, extractJson } from '../llm/groq.js';

/** The only codes the model may raise. Everything else is a local rule's job. */
const JUDGEMENT_CODES = ['ungrounded', 'off_round', 'ignored_answer', 'hostile'] as const;
type JudgementCode = (typeof JUDGEMENT_CODES)[number];

/**
 * Ours, not the model's. `ungrounded` and `hostile` are errors because they are
 * the two failures a candidate would rightly complain about; the other two are
 * warnings because they make for a worse interview without invalidating it.
 */
const SEVERITY: Record<JudgementCode, SimSeverity> = {
  ungrounded: 'error',
  hostile: 'error',
  off_round: 'warn',
  ignored_answer: 'warn',
};

/** Guard rails on an untrusted model response. */
const MAX_FINDINGS = 12;
const MAX_DETAIL = 240;
const MAX_VERDICT = 400;

const ROUND_SCOPE: Record<Round, string> = {
  technical: 'data structures, algorithms, complexity, coding logic, and core programming',
  core: 'the candidate’s own projects, design decisions, trade-offs, scaling, and core CS (DBMS, OS, OOP, networking)',
  hr: 'ownership, teamwork, conflict, growth, motivation, and real achievements',
};

const CRITIC_SYSTEM = `You are a hiring-panel reviewer auditing an interviewer's performance. You are reviewing the INTERVIEWER, never the candidate — a weak candidate is not a finding.

You judge four things only, and you are deliberately conservative: raise a finding only when you could defend it to the interviewer with the quote in front of you.

- ungrounded: the interviewer asserted or assumed experience, an employer, a project, a technology, or a metric that the resume below does not support. Asking a fair general question in an area the resume does not cover is NOT ungrounded.
- off_round: the question belongs to a different round than the one being run.
- ignored_answer: the interviewer moved on as though the candidate had not spoken — no reaction to a substantive answer, or a follow-up that contradicts what was just said.
- hostile: mocked, belittled, sneered at, or piled on after a mistake. Pressing hard, correcting, and challenging are all fine and expected.

Output JSON only, with exactly this shape:
{"findings":[{"code":"ungrounded","turnIndex":0,"detail":"one short sentence quoting the problem"}]}

Use the exact turnIndex shown in brackets before the interviewer turn. Return {"findings":[]} when the round was sound. Never comment on reply length, formatting, repetition, or whether the interviewer sounds like an AI — those are checked separately and duplicating them corrupts the score.`;

function resumeBlock(resume: ResumeContext | null): string {
  if (!resume) {
    return 'CANDIDATE RESUME: (none was provided to the interviewer, so nothing is grounded — only raise "ungrounded" if the interviewer invented specifics about this candidate.)';
  }
  const lines: string[] = ['CANDIDATE RESUME (the only material the interviewer may rely on):'];
  if (resume.name) lines.push(`Name: ${resume.name}`);
  if (resume.title) lines.push(`Headline: ${resume.title}`);
  if (resume.summary) lines.push(`Summary: ${resume.summary}`);
  lines.push(`Skills: ${resume.skills.slice(0, 30).join(', ') || '(none listed)'}`);
  lines.push(`Projects: ${resume.projects.slice(0, 8).join(' | ') || '(none listed)'}`);
  lines.push(`Experience: ${resume.experience.slice(0, 8).join(' | ') || '(none listed)'}`);
  lines.push(`Achievements: ${resume.achievements.slice(0, 6).join(' | ') || '(none listed)'}`);
  lines.push(`Education: ${resume.education.slice(0, 3).join(' | ') || '(none listed)'}`);
  return lines.join('\n');
}

function transcriptBlock(turns: readonly SimTurn[]): string {
  return turns
    .map((t) =>
      t.role === 'interviewer'
        ? `[${t.index}] Interviewer: ${t.text}`
        : `     Candidate: ${t.text}`,
    )
    .join('\n');
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

function isJudgementCode(value: unknown): value is JudgementCode {
  return typeof value === 'string' && (JUDGEMENT_CODES as readonly string[]).includes(value);
}

/**
 * Turn the model's reply into findings we are willing to store.
 *
 * `validIndices` is the set of interviewer turn indices that actually exist in
 * this round. A finding pinned to a turn that is not there could not be shown to
 * anyone, and would still cost a point in `scoreFindings` — so it is dropped
 * rather than clamped to a neighbour that did nothing wrong.
 */
function parseFindings(raw: string, round: Round, validIndices: ReadonlySet<number>): SimFinding[] {
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== 'object') return [];

  const list = (parsed as { findings?: unknown }).findings;
  if (!Array.isArray(list)) return [];

  const findings: SimFinding[] = [];
  const seen = new Set<string>();

  for (const item of list.slice(0, MAX_FINDINGS * 2)) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (!isJudgementCode(o.code)) continue;

    const index = typeof o.turnIndex === 'number' ? Math.trunc(o.turnIndex) : NaN;
    if (!validIndices.has(index)) continue;

    // One finding per (code, turn): a model that lists the same complaint twice
    // must not cost the run two points.
    const key = `${o.code}:${index}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const detail = typeof o.detail === 'string' ? o.detail.trim().slice(0, MAX_DETAIL) : '';
    findings.push({
      code: o.code as SimFindingCode,
      severity: SEVERITY[o.code],
      turnIndex: index,
      round,
      detail: detail || 'No detail given.',
      deterministic: false,
    });

    if (findings.length >= MAX_FINDINGS) break;
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface RoundCritique {
  findings: SimFinding[];
  latencyMs: number;
  /** True when the critic could not run. Its findings are then simply absent. */
  degraded: boolean;
  error?: string;
}

/**
 * Critique one round's transcript.
 *
 * Never throws. A missing critique is a gap in the evidence, not a failed
 * simulation — the deterministic findings from `inspectQuestion` are already
 * recorded and are the ones that catch the regressions we see most often.
 */
export async function critiqueRound(opts: {
  round: Round;
  resume: ResumeContext | null;
  turns: readonly SimTurn[];
}): Promise<RoundCritique> {
  const interviewerIndices = new Set(
    opts.turns.filter((t) => t.role === 'interviewer').map((t) => t.index),
  );
  if (interviewerIndices.size === 0) {
    return { findings: [], latencyMs: 0, degraded: false };
  }

  const user = `${resumeBlock(opts.resume)}

ROUND BEING AUDITED: ${opts.round.toUpperCase()} — its scope is ${ROUND_SCOPE[opts.round]}.

TRANSCRIPT (interviewer turns are numbered; use those numbers):
${transcriptBlock(opts.turns)}

Audit the interviewer's turns now. JSON only.`;

  const started = Date.now();
  try {
    const raw = await completeJson(CRITIC_SYSTEM, user);
    return {
      findings: parseFindings(raw, opts.round, interviewerIndices),
      latencyMs: Date.now() - started,
      degraded: false,
    };
  } catch (err) {
    return {
      findings: [],
      latencyMs: Date.now() - started,
      degraded: true,
      error: (err as Error).message,
    };
  }
}

const VERDICT_SYSTEM = `You are summarising an audit of an AI interviewer for the engineers who own its prompt. Two sentences, plain and specific: what the interviewer did well and the single most important thing to fix. Name the concrete failure, not a category. If there were no findings, say so plainly and do not invent a concern. No preamble, no bullet points, no markdown.`;

/**
 * One or two sentences over the whole simulation, for the operator view.
 *
 * Returns '' when it cannot run. An empty verdict beside a real score is
 * obviously incomplete; a fabricated one would be read as a judgement.
 */
export async function summarizeAudit(opts: {
  score: number;
  findings: readonly SimFinding[];
  interviewerTurns: number;
}): Promise<string> {
  const counts = new Map<string, number>();
  for (const f of opts.findings) {
    const key = `${f.code} (${f.severity})`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const tally = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, n]) => `${key} ×${n}`)
    .join(', ');

  // Examples, not the full list: the tally carries the shape of the problem and
  // a handful of quotes carry its substance. Sending every finding would make
  // the summary call cost more than some of the turns it is summarising.
  const examples = opts.findings
    .filter((f) => f.severity === 'error')
    .slice(0, 6)
    .map((f) => `- ${f.round} turn ${f.turnIndex} [${f.code}]: ${f.detail}`)
    .join('\n');

  const user = `Interviewer turns audited: ${opts.interviewerTurns}
Clean-turn score: ${(opts.score * 100).toFixed(0)}%
Findings: ${tally || 'none'}
${examples ? `\nMost serious:\n${examples}` : ''}

Write the two-sentence summary now.`;

  try {
    const raw = await completeText(VERDICT_SYSTEM, user, { temperature: 0.3, maxTokens: 160 });
    return raw.trim().replace(/\s+/g, ' ').slice(0, MAX_VERDICT);
  } catch {
    return '';
  }
}
