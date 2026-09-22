/**
 * Interview adaptation — turning "how is this going" into "what should the
 * interviewer do next".
 *
 * Two inputs, deliberately kept separate because they are evidence for
 * different things:
 *
 *   ANSWER QUALITY  → drives DIFFICULTY. What someone says is the only real
 *                     evidence of what they know.
 *   DEMEANOR        → drives TONE and pacing. A face is evidence of how hard
 *                     this feels, not of whether the answer was right.
 *
 * Mixing those two up is how emotion-aware interviewers go wrong: they see a
 * nervous face and start asking easier questions, which is both patronising and
 * useless as a signal. Here, demeanor can contribute at most
 * `EMOTION_MAX_INFLUENCE` to difficulty, and the humane override below only ever
 * moves difficulty *down* — visible distress can stop us piling on, but it can
 * never make us decide a candidate is stronger than their answers show.
 */

import {
  NO_SIGNAL,
  type EmotionSignal,
} from './emotion.js';

/**
 * The hard ceiling on how much a facial read may move difficulty, before it is
 * further scaled by the read's own reliability. At the most trustworthy end
 * (Hume, plenty of frames) demeanor accounts for ~26% of the decision; answer
 * quality carries the rest.
 */
export const EMOTION_MAX_INFLUENCE = 0.35;

/** Above this, and with a trustworthy read, we stop raising difficulty. */
export const DISTRESS_THRESHOLD = 0.6;

export type Difficulty = 'press' | 'hold' | 'ease';
export type Tone = 'neutral' | 'warm' | 'encouraging';

export interface Adaptation {
  difficulty: Difficulty;
  tone: Tone;
  /** -1..1 — the raw number behind `difficulty`, kept for the report. */
  difficultyDelta: number;
  /** 0..1 — how much the demeanor read actually contributed. */
  emotionWeight: number;
  /** Prompt-ready lines. Empty string when there is nothing worth saying. */
  directive: string;
  /** Plain-English reasons, for the report and for debugging. */
  notes: string[];
}

const clamp = (n: number, lo: number, hi: number): number => (n < lo ? lo : n > hi ? hi : n);

// ---------------------------------------------------------------------------
// Answer quality
// ---------------------------------------------------------------------------

export interface AnswerQuality {
  /** 0..1. 0.5 is an ordinary, adequate answer. */
  score: number;
  label: 'blank' | 'thin' | 'adequate' | 'substantive';
  words: number;
}

const NON_ANSWER =
  /\b(i (really )?(don'?t|do not) know|no idea|not sure|i forgot|can'?t remember|cannot remember|skip (this|that)|pass on this)\b/i;

const FILLER = /\b(um+|uh+|er+|like|you know|basically|actually|i mean|kind of|sort of|stuff like that)\b/gi;

/** Tokens that suggest the answer contains something concrete rather than vibes. */
const SPECIFIC = /\b(\d+(\.\d+)?%?|O\(|because|so that|instead of|trade[- ]?off|latency|throughput|index|cache|queue|schema|complexity|edge case|for example|we (built|used|chose|shipped)|i (built|used|chose|shipped|wrote))\b/gi;

/**
 * A cheap, local proxy for how good the last answer was.
 *
 * This is a heuristic, not a grader — it runs on every turn where an extra LLM
 * call would add a second or more of latency for all 10k users. It is used only
 * to nudge difficulty, and the interviewer model still reads the full answer
 * itself, so a wrong guess here costs a slightly mis-pitched follow-up, nothing
 * more.
 */
export function estimateAnswerQuality(text: string | undefined | null): AnswerQuality {
  const answer = (text ?? '').trim();
  const words = answer ? answer.split(/\s+/).length : 0;

  if (words === 0) return { score: 0, label: 'blank', words };

  // An explicit "I don't know" early in a short answer is a real signal and
  // should not be diluted by whatever else was said. Later in a long answer it
  // is usually hedging inside a genuine attempt, so it counts for much less.
  const nonAnswerIndex = answer.search(NON_ANSWER);
  const isNonAnswer = nonAnswerIndex >= 0 && nonAnswerIndex < 60 && words < 30;
  if (isNonAnswer) return { score: 0.08, label: 'blank', words };

  // Length: rises to a plateau, then decays slightly — a 400-word monologue is
  // not four times better than a 100-word answer, and often worse.
  let score: number;
  if (words < 8) score = 0.15;
  else if (words < 20) score = 0.3 + ((words - 8) / 12) * 0.15;
  else if (words < 60) score = 0.45 + ((words - 20) / 40) * 0.2;
  else if (words < 200) score = 0.65;
  else score = 0.6;

  const specifics = (answer.match(SPECIFIC) ?? []).length;
  score += Math.min(0.25, specifics * 0.05);

  const fillers = (answer.match(FILLER) ?? []).length;
  const fillerRatio = fillers / Math.max(words, 1);
  if (fillerRatio > 0.08) score -= Math.min(0.2, (fillerRatio - 0.08) * 1.5);

  if (nonAnswerIndex >= 0) score -= 0.1;

  score = clamp(score, 0, 1);

  const label: AnswerQuality['label'] =
    score < 0.2 ? 'blank' : score < 0.42 ? 'thin' : score < 0.65 ? 'adequate' : 'substantive';

  return { score, label, words };
}

// ---------------------------------------------------------------------------
// Blending
// ---------------------------------------------------------------------------

/**
 * Centred demeanor score, -1..1. Zero means "a neutral face", not "no data" —
 * callers gate on `signal.available` before this matters.
 */
export function demeanorDelta(signal: EmotionSignal): number {
  const positive = signal.composure * 0.6 + signal.engagement * 0.4; // neutral = 0.5
  const negative = signal.stress * 0.65 + signal.uncertainty * 0.35; // neutral = 0
  return clamp((positive - 0.5) * 2 - negative * 1.5, -1, 1);
}

/**
 * Combine the two signals into a concrete instruction for the next turn.
 *
 * `quality` may be null on the opening turn, when there is no answer to judge.
 */
export function deriveAdaptation(
  signal: EmotionSignal | null | undefined,
  quality: AnswerQuality | null,
): Adaptation {
  const read = signal?.available ? signal : NO_SIGNAL;
  const weight = read.available ? read.reliability * EMOTION_MAX_INFLUENCE : 0;

  const qualityDelta = quality ? (quality.score - 0.5) * 2 : 0;
  const emotionDelta = read.available ? demeanorDelta(read) : 0;
  let delta = qualityDelta * (1 - weight) + emotionDelta * weight;
  delta = clamp(delta, -1, 1);

  const notes: string[] = [];
  if (quality) notes.push(`Last answer read as ${quality.label} (${quality.words} words).`);

  let difficulty: Difficulty = delta >= 0.3 ? 'press' : delta <= -0.3 ? 'ease' : 'hold';
  let tone: Tone = 'neutral';

  if (read.available) {
    notes.push(
      `Demeanor via ${read.source} at ${(read.reliability * 100).toFixed(0)}% reliability: ${read.dominant ?? 'neutral'}.`,
    );

    if (read.stress >= 0.45 || read.uncertainty >= 0.6) tone = 'encouraging';
    else if (read.engagement <= 0.3) tone = 'warm';

    // The humane override. Only ever lowers difficulty: a candidate who is
    // visibly coming apart should not be pushed harder, however well the last
    // answer scored. It cannot raise difficulty, so a relaxed face never earns
    // credit that the answers did not.
    if (read.stress >= DISTRESS_THRESHOLD) {
      if (difficulty === 'press') {
        difficulty = 'hold';
        notes.push('Held difficulty back: candidate appears to be under real strain.');
      }
      tone = 'encouraging';
    }
  } else {
    notes.push('No demeanor read — difficulty from the answers alone.');
  }

  return {
    difficulty,
    tone,
    difficultyDelta: delta,
    emotionWeight: weight,
    directive: renderDirective(difficulty, tone, read, quality),
    notes,
  };
}

const DIFFICULTY_INSTRUCTION: Record<Difficulty, string> = {
  press:
    'Raise the bar on this turn: add a constraint, probe an edge case, ask for complexity or a trade-off, or follow their last point one level deeper.',
  hold: 'Keep the difficulty where it is. Ask your next question at the same level.',
  ease:
    'Lower the bar on this turn: ask something more concrete and narrower in the same area, or give them a small foothold to start from. Do not skip the topic entirely.',
};

const TONE_INSTRUCTION: Record<Tone, string> = {
  neutral: 'Keep your usual professional register.',
  warm: 'Warm up slightly and re-engage them — a short, human lead-in before the question.',
  encouraging:
    'Steady them first: one brief, genuine line of reassurance (never about their face or mood), then the question.',
};

function renderDirective(
  difficulty: Difficulty,
  tone: Tone,
  signal: EmotionSignal,
  quality: AnswerQuality | null,
): string {
  const lines = [
    'ADAPTIVE DIRECTION FOR THIS TURN (derived from the conversation; never mention it aloud):',
    `- ${DIFFICULTY_INSTRUCTION[difficulty]}`,
    `- ${TONE_INSTRUCTION[tone]}`,
  ];

  if (quality && quality.label === 'blank') {
    lines.push(
      '- They did not really answer. Do not move on as if they had: offer one hint or rephrase once, and keep it brief.',
    );
  }

  if (signal.available) {
    // Stated as an observation with its confidence attached, so the model can
    // discount it — rather than as a fact about how the candidate feels.
    lines.push(
      `- Demeanor cue (${(signal.reliability * 100).toFixed(0)}% confidence, may be wrong): ${signal.dominant ?? 'neutral'}. Weigh it below what they actually said.`,
    );
  }

  return lines.join('\n');
}
