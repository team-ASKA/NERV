/**
 * Adapters between the interview engine's output and the payload shape the
 * summary/report pages consume.
 *
 * The engine keeps a compact `TranscriptTurn[]`; the report matches emotion
 * snapshots to questions by the *message id* of the interviewer turn. These
 * helpers build that id-keyed view once, at the end of a round.
 *
 * Emotion is only ever emitted when it was genuinely captured — when the Hume
 * stream is unavailable we return `null` and record `emotionAvailable: false`
 * rather than inventing scores.
 */

import type { EmotionAggregate, Round, TranscriptTurn } from '../types/interview';

export interface LegacyMessage {
  id: string;
  text: string;
  sender: 'user' | 'ai';
  timestamp: Date;
  round: Round;
}

/** Per-question emotion snapshot, taken when the candidate finished answering. */
export interface QuestionExpression {
  available: true;
  emotionBreakdown: Array<{ name: string; score: number }>;
  confidenceScore: number;
  dominantEmotion: string;
  isConfident: boolean;
  isNervous: boolean;
  isStruggling: boolean;
}

/** `[interviewerMessageId, snapshot]` — serialisable across `navigate()` state. */
export type ExpressionEntry = [string, QuestionExpression];

export interface RoundArtifacts {
  round: Round;
  /** Authoritative ordered transcript from the engine. */
  transcript: TranscriptTurn[];
  /** Id-carrying messages for the report. */
  messages: LegacyMessage[];
  questionExpressions: ExpressionEntry[];
  /** False when facial analysis never came online for this round. */
  emotionAvailable: boolean;
  /** Minutes actually spent in the round (min 1). */
  durationMinutes: number;
  /** Times the candidate left the tab/window. */
  tabSwitches: number;
  /** Technical round scratchpad contents, if any. */
  code?: string;
  codeLanguage?: string;
}

/**
 * Convert a live aggregate into a storable snapshot.
 * Returns `null` when emotion analysis was unavailable — callers must not
 * substitute a placeholder.
 */
export function toQuestionExpression(aggregate: EmotionAggregate | null): QuestionExpression | null {
  if (!aggregate?.available) return null;
  const breakdown = aggregate.breakdown ?? [];
  if (breakdown.length === 0) return null;
  return {
    available: true,
    emotionBreakdown: breakdown.map((e) => ({ name: e.name, score: e.score })),
    confidenceScore: aggregate.confidenceScore ?? 0,
    dominantEmotion: aggregate.dominantEmotion ?? breakdown[0].name,
    isConfident: Boolean(aggregate.isConfident),
    isNervous: Boolean(aggregate.isNervous),
    isStruggling: Boolean(aggregate.isStruggling),
  };
}

/** Stable, collision-free message ids scoped to a round. */
export function makeMessageId(round: Round, sender: 'ai' | 'user', seq: number): string {
  return `${round}_${sender}_${seq}`;
}

/** Merge several rounds' messages in order, for the combined report view. */
export function mergeMessages(...groups: Array<LegacyMessage[] | undefined>): LegacyMessage[] {
  return groups.flatMap((g) => g ?? []);
}

/** Merge several rounds' expression entries. */
export function mergeExpressions(...groups: Array<ExpressionEntry[] | undefined>): ExpressionEntry[] {
  return groups.flatMap((g) => g ?? []);
}

/** Flatten a transcript into a readable plain-text log (used for the report prompt). */
export function transcriptToText(turns: TranscriptTurn[]): string {
  return turns
    .map((t) => `${t.role === 'interviewer' ? 'Interviewer' : 'Candidate'}: ${t.text}`)
    .join('\n\n');
}
