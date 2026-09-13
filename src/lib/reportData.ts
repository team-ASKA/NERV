/**
 * The report model behind `/nerv-summary`.
 *
 * One shape, built either from the interview that just finished (navigation
 * state) or from a stored row (dashboard history), so the page renders the same
 * way in both cases. Everything emotional is optional and clearly nullable:
 * `emotionAvailable === false` means facial analysis never came online, and the
 * report must show that rather than substituting numbers.
 */

import type { ResumeContext, Round } from '../types/interview';
import { ROUND_LABELS } from '../types/interview';
import type { ExpressionEntry, LegacyMessage, QuestionExpression } from './roundPayload';
import type { SummaryNavState } from './interviewFlow';
import { averageSignals, toSignal, type AggregateSignal, type EmotionSignal } from './emotionSummary';

const ROUND_ORDER: Round[] = ['technical', 'core', 'hr'];
const MAX_STORED_MESSAGES = 200;
const MAX_STORED_CHARS = 4000;

export interface ReportMessage {
  id: string;
  text: string;
  sender: 'ai' | 'user';
  timestamp: string;
  round: Round;
}

export interface QuestionRecord {
  id: string;
  round: Round;
  roundLabel: string;
  /** 1-based position within its round. */
  number: number;
  question: string;
  /** The answer that followed, empty when the candidate never replied. */
  answer: string;
  /** `null` when emotion was not measured for this question. */
  signal: EmotionSignal | null;
}

export interface RoundRecord {
  round: Round;
  label: string;
  messages: ReportMessage[];
  questions: QuestionRecord[];
  questionCount: number;
  durationMinutes: number;
  /** `null` when no question in the round carried measured emotion. */
  signal: AggregateSignal | null;
}

export interface SkillCoverage {
  total: number;
  covered: string[];
  gaps: string[];
  mentions: Record<string, number>;
  /** 0..100 share of resume skills the candidate actually spoke about. */
  coverage: number;
}

export interface ReportData {
  rounds: RoundRecord[];
  questions: QuestionRecord[];
  totalQuestions: number;
  totalDurationMinutes: number;
  /** True only if facial analysis genuinely ran at some point. */
  emotionAvailable: boolean;
  /** Questions carrying a measured emotion snapshot. */
  emotionSamples: number;
  overall: AggregateSignal | null;
  summaryMarkdown: string;
  resume: Partial<ResumeContext> | null;
  skills: SkillCoverage;
  /** 0..100 completeness of the resume's sections (not a real ATS engine). */
  resumeScore: number;
  suggestions: string[];
  tabSwitches: number;
  code?: string;
  codeLanguage?: string;
  /** True when this came out of history rather than a just-finished interview. */
  historical: boolean;
}

// ---------------------------------------------------------------------------
// Building from a finished interview
// ---------------------------------------------------------------------------

const asArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function toReportMessages(raw: unknown, round: Round): ReportMessage[] {
  return asArray<LegacyMessage>(raw)
    .filter((m) => m && typeof m.text === 'string' && m.text.trim().length > 0)
    .map((m, i) => ({
      id: typeof m.id === 'string' && m.id ? m.id : `${round}_${i}`,
      text: m.text.trim(),
      sender: m.sender === 'user' ? 'user' : 'ai',
      timestamp: toIso(m.timestamp),
      round,
    }));
}

/** Pair each interviewer question with the answer that followed it. */
function pairQuestions(
  messages: ReportMessage[],
  expressions: Map<string, QuestionExpression>,
  round: Round,
): QuestionRecord[] {
  const records: QuestionRecord[] = [];
  messages.forEach((msg, index) => {
    if (msg.sender !== 'ai') return;
    const next = messages[index + 1];
    records.push({
      id: msg.id,
      round,
      roundLabel: ROUND_LABELS[round],
      number: records.length + 1,
      question: msg.text,
      answer: next && next.sender === 'user' ? next.text : '',
      signal: toSignal(expressions.get(msg.id)),
    });
  });
  return records;
}

function expressionMap(entries: unknown): Map<string, QuestionExpression> {
  const map = new Map<string, QuestionExpression>();
  for (const entry of asArray<ExpressionEntry>(entries)) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const [id, snapshot] = entry;
    if (typeof id !== 'string' || !snapshot) continue;
    map.set(id, snapshot);
  }
  return map;
}

/** Resume-completeness heuristic. Same weighting as before, honestly labelled. */
export function resumeCompleteness(resume: Partial<ResumeContext> | null | undefined): number {
  if (!resume) return 0;
  const part = (list: unknown, per: number, max: number) =>
    Math.min(max, asArray<string>(list).length * per);
  return Math.min(
    100,
    part(resume.skills, 2, 25) +
      part(resume.experience, 8, 25) +
      part(resume.projects, 6, 20) +
      part(resume.education, 7, 15) +
      part(resume.achievements, 5, 15),
  );
}

/**
 * Count a skill in free text with rough word boundaries, so "C" doesn't match
 * every sentence and "React" doesn't match "reacted".
 */
function countMentions(text: string, skill: string): number {
  const needle = skill.toLowerCase().trim();
  if (needle.length < 2) return 0;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = text.match(new RegExp(`(^|[^a-z0-9+#.])${escaped}([^a-z0-9+#.]|$)`, 'gi'));
  return matches ? matches.length : 0;
}

/**
 * Which resume skills the candidate actually spoke about.
 * Only the candidate's own words count — the previous version also scanned the
 * interviewer's questions, so a skill counted as "covered" merely because the
 * interviewer said it out loud.
 */
export function skillCoverage(
  resume: Partial<ResumeContext> | null | undefined,
  messages: ReportMessage[],
): SkillCoverage {
  const skills = asArray<string>(resume?.skills).filter((s) => typeof s === 'string' && s.trim());
  const spoken = messages
    .filter((m) => m.sender === 'user')
    .map((m) => m.text)
    .join('\n')
    .toLowerCase();

  const mentions: Record<string, number> = {};
  const covered: string[] = [];
  const gaps: string[] = [];

  for (const skill of skills) {
    const count = spoken ? countMentions(spoken, skill) : 0;
    mentions[skill] = count;
    if (count > 0) covered.push(skill);
    else gaps.push(skill);
  }

  return {
    total: skills.length,
    covered,
    gaps,
    mentions,
    coverage: skills.length ? Math.round((covered.length / skills.length) * 100) : 0,
  };
}

function buildSuggestions(input: {
  skills: SkillCoverage;
  resumeScore: number;
  rounds: RoundRecord[];
  overall: AggregateSignal | null;
  tabSwitches: number;
  unanswered: number;
}): string[] {
  const out: string[] = [];
  const { skills, resumeScore, rounds, overall, tabSwitches, unanswered } = input;

  if (skills.gaps.length > 0) {
    out.push(
      `Work ${skills.gaps.slice(0, 3).join(', ')} into your answers — ${
        skills.gaps.length === 1 ? 'it is' : 'they are'
      } on your resume but never came up in what you said.`,
    );
  }
  if (skills.total > 0 && skills.coverage < 60) {
    out.push('Prepare one concrete story per major skill so you can reach for evidence instead of describing tools.');
  }
  if (unanswered > 0) {
    out.push(`${unanswered} question${unanswered === 1 ? '' : 's'} went unanswered — practise starting with a one-line summary, then the detail.`);
  }
  if (resumeScore < 70) {
    out.push('Strengthen the resume itself: quantified achievements and a fuller projects section are what recruiters scan for.');
  }

  const weakest = rounds
    .filter((r): r is RoundRecord & { signal: AggregateSignal } => r.signal !== null)
    .sort((a, b) => a.signal.confidence - b.signal.confidence)[0];
  if (weakest && weakest.signal.confidence < 55) {
    out.push(`Composure dipped most in the ${weakest.label.toLowerCase()} round — rehearse that format aloud until the structure is automatic.`);
  }
  if (overall && overall.nervousness >= 30) {
    out.push('Nervousness read high throughout. Slow your opening sentence and pause before answering; it buys thinking time and reads as control.');
  }
  if (tabSwitches > 2) {
    out.push(`You left the interview window ${tabSwitches} times. In a real screen that is visible to the interviewer.`);
  }

  out.push('Run the training session on your weakest topics, then repeat this interview to compare.');
  return out.slice(0, 7);
}

function assemble(input: {
  rounds: RoundRecord[];
  summaryMarkdown: string;
  resume: Partial<ResumeContext> | null;
  emotionAvailable: boolean;
  totalDurationMinutes: number;
  tabSwitches: number;
  code?: string;
  codeLanguage?: string;
  historical: boolean;
}): ReportData {
  const { rounds, resume } = input;
  const questions = rounds.flatMap((r) => r.questions);
  const allMessages = rounds.flatMap((r) => r.messages);
  const signals = questions.map((q) => q.signal);
  const overall = averageSignals(signals);
  const emotionSamples = signals.filter(Boolean).length;

  const skills = skillCoverage(resume, allMessages);
  const resumeScore = resumeCompleteness(resume);
  const unanswered = questions.filter((q) => !q.answer).length;

  return {
    rounds,
    questions,
    totalQuestions: questions.length,
    totalDurationMinutes: input.totalDurationMinutes,
    // Never claim availability we can't back with at least one sample.
    emotionAvailable: input.emotionAvailable && emotionSamples > 0,
    emotionSamples,
    overall,
    summaryMarkdown: input.summaryMarkdown,
    resume,
    skills,
    resumeScore,
    suggestions: buildSuggestions({
      skills,
      resumeScore,
      rounds,
      overall,
      tabSwitches: input.tabSwitches,
      unanswered,
    }),
    tabSwitches: input.tabSwitches,
    code: input.code,
    codeLanguage: input.codeLanguage,
    historical: input.historical,
  };
}

/** Build the report from the state a finished round navigated with. */
export function buildReport(state: Partial<SummaryNavState> | null | undefined): ReportData {
  const s = state ?? {};

  const perRound: Record<Round, { messages: unknown; expressions: unknown }> = {
    technical: {
      messages: s.technicalMessages,
      expressions: s.technicalQuestionExpressions ?? s.questionExpressions,
    },
    core: { messages: s.coreMessages, expressions: s.coreQuestionExpressions },
    hr: { messages: s.hrMessages, expressions: s.hrQuestionExpressions },
  };

  const played = ROUND_ORDER.filter((r) => asArray(perRound[r].messages).length > 0);
  const perRoundMinutes = s.roundDuration ?? 0;

  const rounds: RoundRecord[] = played.map((round) => {
    const messages = toReportMessages(perRound[round].messages, round);
    const questions = pairQuestions(messages, expressionMap(perRound[round].expressions), round);
    return {
      round,
      label: ROUND_LABELS[round],
      messages,
      questions,
      questionCount: questions.length,
      durationMinutes: perRoundMinutes,
      signal: averageSignals(questions.map((q) => q.signal)),
    };
  });

  const totalDuration =
    s.totalDurationMinutes ?? (perRoundMinutes * Math.max(1, played.length)) ?? 0;

  return assemble({
    rounds,
    summaryMarkdown: (s.summary ?? '').trim(),
    resume: s.resumeData ?? null,
    emotionAvailable: Boolean(s.emotionAvailable),
    totalDurationMinutes: totalDuration,
    tabSwitches: s.tabSwitches ?? 0,
    code: s.code,
    codeLanguage: s.codeLanguage,
    historical: false,
  });
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export interface PersistedRound {
  round: Round;
  durationMinutes: number;
  questionCount: number;
  messages: ReportMessage[];
  questions: Array<Pick<QuestionRecord, 'id' | 'number' | 'question' | 'answer' | 'signal'>>;
}

export interface PersistedReport {
  version: 2;
  emotionAvailable: boolean;
  totalQuestions: number;
  totalDurationMinutes: number;
  tabSwitches: number;
  rounds: PersistedRound[];
}

export interface PersistedMetrics {
  resumeScore: number;
  skillGaps: string[];
  coveredSkills: string[];
  skillMentions: Record<string, number>;
  suggestions: string[];
  emotionAvailable: boolean;
  emotionSamples: number;
  totalQuestions: number;
  tabSwitches: number;
  overall: AggregateSignal | null;
}

const clip = (text: string): string =>
  text.length > MAX_STORED_CHARS ? `${text.slice(0, MAX_STORED_CHARS)}…` : text;

/**
 * Compact, text-only payload for the `interviews` row. Transcripts and emotion
 * aggregates only — never audio, video, frames or base64.
 */
export function toPersistedReport(report: ReportData): PersistedReport {
  return {
    version: 2,
    emotionAvailable: report.emotionAvailable,
    totalQuestions: report.totalQuestions,
    totalDurationMinutes: report.totalDurationMinutes,
    tabSwitches: report.tabSwitches,
    rounds: report.rounds.map((r) => ({
      round: r.round,
      durationMinutes: r.durationMinutes,
      questionCount: r.questionCount,
      messages: r.messages.slice(0, MAX_STORED_MESSAGES).map((m) => ({ ...m, text: clip(m.text) })),
      questions: r.questions.map((q) => ({
        id: q.id,
        number: q.number,
        question: clip(q.question),
        answer: clip(q.answer),
        signal: q.signal,
      })),
    })),
  };
}

export function toPersistedMetrics(report: ReportData): PersistedMetrics {
  return {
    resumeScore: report.resumeScore,
    skillGaps: report.skills.gaps,
    coveredSkills: report.skills.covered,
    skillMentions: report.skills.mentions,
    suggestions: report.suggestions,
    emotionAvailable: report.emotionAvailable,
    emotionSamples: report.emotionSamples,
    totalQuestions: report.totalQuestions,
    tabSwitches: report.tabSwitches,
    overall: report.overall,
  };
}

// ---------------------------------------------------------------------------
// Rehydrating a stored interview
// ---------------------------------------------------------------------------

interface StoredInterview {
  summary_markdown?: string;
  summary?: string;
  questions_data?: unknown;
  metrics?: Partial<PersistedMetrics> & { atsScore?: number };
  total_duration_minutes?: number;
}

function isPersisted(value: unknown): value is PersistedReport {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as PersistedReport).version === 2 &&
    Array.isArray((value as PersistedReport).rounds)
  );
}

function fromPersisted(stored: PersistedReport): RoundRecord[] {
  return stored.rounds.map((r) => {
    const questions: QuestionRecord[] = asArray<PersistedRound['questions'][number]>(r.questions).map(
      (q, i) => ({
        id: q.id ?? `${r.round}_${i}`,
        round: r.round,
        roundLabel: ROUND_LABELS[r.round] ?? r.round,
        number: q.number ?? i + 1,
        question: q.question ?? '',
        answer: q.answer ?? '',
        signal: q.signal ?? null,
      }),
    );
    return {
      round: r.round,
      label: ROUND_LABELS[r.round] ?? r.round,
      messages: asArray<ReportMessage>(r.messages),
      questions,
      questionCount: r.questionCount ?? questions.length,
      durationMinutes: r.durationMinutes ?? 0,
      signal: averageSignals(questions.map((q) => q.signal)),
    };
  });
}

/**
 * Rows written before this revamp stored a mix of real and fabricated emotion,
 * tagged `source: 'real' | 'fallback'`. Only the real entries are carried
 * forward; the invented ones are dropped rather than re-displayed.
 */
function fromLegacy(rows: unknown): RoundRecord[] {
  interface LegacyRound {
    round?: string;
    messages?: unknown;
    emotions?: Array<{
      questionId?: string;
      question?: string;
      emotions?: Array<{ name: string; score: number }>;
      source?: string;
    }>;
    duration?: number;
    questionsCount?: number;
  }

  const byRound = new Map<Round, RoundRecord>();

  for (const raw of asArray<LegacyRound>(rows)) {
    const name = (raw?.round ?? '').toLowerCase();
    const round: Round = name.includes('hr')
      ? 'hr'
      : name.includes('core') || name.includes('project')
        ? 'core'
        : 'technical';

    const messages = toReportMessages(raw.messages, round);

    const expressions = new Map<string, QuestionExpression>();
    for (const entry of raw.emotions ?? []) {
      if (entry?.source !== 'real' || !entry.questionId || !Array.isArray(entry.emotions)) continue;
      const breakdown = entry.emotions.filter((e) => e && typeof e.score === 'number');
      if (!breakdown.length) continue;
      const dominant = [...breakdown].sort((a, b) => b.score - a.score)[0];
      expressions.set(entry.questionId, {
        available: true,
        emotionBreakdown: breakdown,
        confidenceScore: breakdown.find((e) => e.name === 'Confidence')?.score ?? dominant.score,
        dominantEmotion: dominant.name,
        isConfident: false,
        isNervous: false,
        isStruggling: false,
      });
    }

    const questions = pairQuestions(messages, expressions, round);
    const existing = byRound.get(round);
    if (existing) {
      existing.messages.push(...messages);
      existing.questions.push(...questions);
      existing.questionCount = existing.questions.length;
      existing.signal = averageSignals(existing.questions.map((q) => q.signal));
      continue;
    }
    byRound.set(round, {
      round,
      label: ROUND_LABELS[round],
      messages,
      questions,
      questionCount: questions.length,
      durationMinutes: typeof raw.duration === 'number' ? raw.duration : 0,
      signal: averageSignals(questions.map((q) => q.signal)),
    });
  }

  return ROUND_ORDER.filter((r) => byRound.has(r)).map((r) => byRound.get(r) as RoundRecord);
}

/** Build the report from a stored `interviews` row (dashboard history). */
export function reportFromRecord(
  record: unknown,
  resume: Partial<ResumeContext> | null,
): ReportData {
  const row = (record ?? {}) as StoredInterview;
  const data = row.questions_data;
  const persisted = isPersisted(data) ? data : null;
  const rounds = persisted ? fromPersisted(persisted) : fromLegacy(data);

  const totalDuration =
    persisted?.totalDurationMinutes ??
    row.total_duration_minutes ??
    rounds.reduce((sum, r) => sum + r.durationMinutes, 0);

  return assemble({
    rounds,
    summaryMarkdown: (row.summary_markdown || row.summary || '').trim(),
    resume,
    emotionAvailable: persisted
      ? persisted.emotionAvailable
      : Boolean(row.metrics?.emotionAvailable),
    totalDurationMinutes: totalDuration,
    tabSwitches: persisted?.tabSwitches ?? row.metrics?.tabSwitches ?? 0,
    historical: true,
  });
}
