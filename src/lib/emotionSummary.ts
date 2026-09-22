/**
 * Turning captured facial-expression snapshots into report numbers — honestly.
 *
 * Every function here returns `null` when there is no real signal. Nothing in
 * this module invents, seeds, jitters or floors a score: if no expression read
 * came online for a question, that question simply has no emotion data and the
 * report says so. (The previous report fabricated a full breakdown from a hash
 * of the question id, which looked convincing and meant nothing.)
 *
 * Numbers come from the weighted dimensions in `shared/emotion.ts` — the same
 * ones the live read showed and the interviewer adapted to, so the report
 * cannot disagree with the room. Snapshots recorded before the weighted model
 * carry raw Hume labels instead, and fall back to the legacy groupings below.
 */

import type { QuestionExpression } from './roundPayload';
import {
  HUME_NERVOUS,
  HUME_POSITIVE,
  HUME_STRUGGLE,
  dominantLabel,
  dominantStrength,
} from '../../shared/emotion';

/** One emotion as a percentage of the observed expression mass. */
export interface EmotionShare {
  name: string;
  /** 0..100 — share of the total measured emotion mass for that moment. */
  share: number;
}

/** A single question's measured emotional read. */
export interface EmotionSignal {
  /** 0..100 — the composure index computed live while the answer was given. */
  confidence: number;
  /** 0..100 — share of the expression mass in the positive group. */
  composure: number;
  /** 0..100 — share in the anxiety/fear group. */
  nervousness: number;
  /** 0..100 — share in the confusion/fatigue group. */
  strain: number;
  dominant: string;
  /** 0..100 — the dominant emotion's share. */
  dominantShare: number;
  /** Strongest few emotions, already expressed as shares. */
  top: EmotionShare[];
}

export type Band = 'Strong' | 'Steady' | 'Mixed' | 'Unsettled';

/** Averaged read across several questions. */
export interface AggregateSignal extends Omit<EmotionSignal, 'top'> {
  /** How many questions actually carried measured emotion. */
  samples: number;
  band: Band;
  /** Most frequently dominant emotion across the samples. */
  top: EmotionShare[];
}

const TOP_N = 5;

const pct = (n: number): number => Math.round(Math.max(0, Math.min(100, n)));

/**
 * Convert a stored snapshot into display numbers.
 * Returns `null` when the snapshot carries no usable mass.
 */
export function toSignal(exp: QuestionExpression | null | undefined): EmotionSignal | null {
  if (!exp?.available) return null;

  const breakdown = (exp.emotionBreakdown ?? []).filter(
    (e) => e && typeof e.name === 'string' && Number.isFinite(e.score) && e.score > 0,
  );
  if (breakdown.length === 0) return null;

  const total = breakdown.reduce((sum, e) => sum + e.score, 0);
  if (total <= 0) return null;

  const sorted = [...breakdown].sort((a, b) => b.score - a.score);
  const top = sorted.slice(0, TOP_N).map((e) => ({ name: e.name, share: pct((e.score / total) * 100) }));
  const confidence = pct((exp.confidenceScore ?? 0) * 100);

  // Preferred: the weighted dimensions, which mean the same thing whichever
  // provider ran and are exactly what the interviewer adapted to.
  if (exp.dimensions) {
    return {
      confidence,
      composure: pct(exp.dimensions.composure * 100),
      nervousness: pct(exp.dimensions.stress * 100),
      strain: pct(exp.dimensions.uncertainty * 100),
      dominant: exp.dominantEmotion || dominantLabel(exp.dimensions),
      dominantShare: pct(dominantStrength(exp.dimensions) * 100),
      top,
    };
  }

  // Legacy: a snapshot of raw Hume labels, scored as shares of expression mass.
  let positive = 0;
  let nervous = 0;
  let strain = 0;
  for (const e of breakdown) {
    const key = e.name.toLowerCase();
    if (HUME_POSITIVE.includes(key)) positive += e.score;
    if (HUME_NERVOUS.includes(key)) nervous += e.score;
    if (HUME_STRUGGLE.includes(key)) strain += e.score;
  }

  const dominant = exp.dominantEmotion || sorted[0].name;
  const dominantEntry = sorted.find((e) => e.name === dominant) ?? sorted[0];

  return {
    confidence,
    composure: pct((positive / total) * 100),
    nervousness: pct((nervous / total) * 100),
    strain: pct((strain / total) * 100),
    dominant,
    dominantShare: pct((dominantEntry.score / total) * 100),
    top,
  };
}

export function bandFor(confidence: number): Band {
  if (confidence >= 70) return 'Strong';
  if (confidence >= 55) return 'Steady';
  if (confidence >= 40) return 'Mixed';
  return 'Unsettled';
}

/** Average a set of per-question signals. `null` when there is nothing to average. */
export function averageSignals(signals: Array<EmotionSignal | null>): AggregateSignal | null {
  const real = signals.filter((s): s is EmotionSignal => s !== null);
  if (real.length === 0) return null;

  const mean = (pick: (s: EmotionSignal) => number) =>
    Math.round(real.reduce((sum, s) => sum + pick(s), 0) / real.length);

  // Dominant = most frequently dominant across the samples, ties broken by share.
  const tally = new Map<string, { count: number; share: number }>();
  for (const s of real) {
    const prev = tally.get(s.dominant) ?? { count: 0, share: 0 };
    tally.set(s.dominant, { count: prev.count + 1, share: prev.share + s.dominantShare });
  }
  const [dominant, dominantStats] = [...tally.entries()].sort(
    (a, b) => b[1].count - a[1].count || b[1].share - a[1].share,
  )[0];

  // Mean share per emotion across every sample that mentioned it.
  const shares = new Map<string, number>();
  for (const s of real) {
    for (const e of s.top) shares.set(e.name, (shares.get(e.name) ?? 0) + e.share);
  }
  const top = [...shares.entries()]
    .map(([name, sum]) => ({ name, share: Math.round(sum / real.length) }))
    .sort((a, b) => b.share - a.share)
    .slice(0, TOP_N);

  const confidence = mean((s) => s.confidence);

  return {
    samples: real.length,
    confidence,
    composure: mean((s) => s.composure),
    nervousness: mean((s) => s.nervousness),
    strain: mean((s) => s.strain),
    dominant,
    dominantShare: Math.round(dominantStats.share / dominantStats.count),
    band: bandFor(confidence),
    top,
  };
}

/** Tailwind tone for a band, so every surface colours it the same way. */
export const BAND_TONE: Record<Band, 'success' | 'accent' | 'warning' | 'danger'> = {
  Strong: 'success',
  Steady: 'accent',
  Mixed: 'warning',
  Unsettled: 'danger',
};
