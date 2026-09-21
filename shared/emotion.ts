/**
 * Emotion weighting — the single definition of how a raw facial read becomes
 * something an interviewer can act on.
 *
 * Shared by the browser (which produces the read), the API (which turns it into
 * prompt guidance) and the report (which describes it after the fact), so the
 * number shown live, the number the interviewer adapted to, and the number in
 * the summary are all the same number.
 *
 * WHAT THIS IS NOT
 * ----------------
 * Facial expression is not emotion, and neither provider below measures how a
 * candidate feels. Both measure the face: Hume returns model-scored expression
 * labels, MediaPipe returns muscle activations. We map those to four blunt,
 * interview-relevant dimensions and attach an explicit `reliability` so every
 * consumer knows how much to trust them. Nothing here is ever invented — when
 * there is no signal, `available` is false and it stays false.
 */

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

/**
 * Four dimensions, each 0..1. Deliberately coarse: finer categories would imply
 * a precision the underlying signal does not have.
 */
export interface EmotionDimensions {
  /** Steady, composed, in control of the answer. */
  composure: number;
  /** Present and attentive, as opposed to checked out or reading elsewhere. */
  engagement: number;
  /** Visible tension — the thing that should make an interviewer ease off. */
  stress: number;
  /** Doubt or confusion — usually about the question, not the candidate. */
  uncertainty: number;
}

export const NEUTRAL_DIMENSIONS: EmotionDimensions = {
  composure: 0.5,
  engagement: 0.5,
  stress: 0,
  uncertainty: 0,
};

export type EmotionSource = 'hume' | 'mediapipe' | 'none';

export interface EmotionSignal extends EmotionDimensions {
  available: boolean;
  source: EmotionSource;
  /**
   * 0..1 — how much weight a consumer should give this read. Combines the
   * provider's inherent trustworthiness with how much data we actually have.
   * A single frame of a face half out of shot is not a read.
   */
  reliability: number;
  /** Frames that contributed to the current aggregate. */
  samples: number;
  /** Human-readable label for the UI. Never shown to the candidate mid-round. */
  dominant?: string;
  /** Top raw signals, for the live readout and the report. */
  breakdown?: Array<{ name: string; score: number }>;
}

export const NO_SIGNAL: EmotionSignal = {
  ...NEUTRAL_DIMENSIONS,
  available: false,
  source: 'none',
  reliability: 0,
  samples: 0,
};

// ---------------------------------------------------------------------------
// Weight tables
// ---------------------------------------------------------------------------

/**
 * A weight maps one raw signal onto the dimensions. Negative weights subtract —
 * boredom is evidence *against* engagement, not evidence for something else.
 */
export type WeightTable = Record<string, Partial<EmotionDimensions>>;

/**
 * Hume expression labels. Keys are lowercased on lookup.
 *
 * Chosen for what they imply about an interview rather than their emotional
 * valence: "concentration" is a good sign here even though it is not a pleasant
 * feeling, and "excitement" says less about readiness than "determination".
 */
export const HUME_WEIGHTS: WeightTable = {
  calmness: { composure: 1.0 },
  concentration: { composure: 0.6, engagement: 0.9 },
  determination: { composure: 0.7, engagement: 0.8 },
  confidence: { composure: 1.0, engagement: 0.5 },
  interest: { engagement: 1.0 },
  excitement: { engagement: 0.7, composure: -0.1 },
  joy: { engagement: 0.6, composure: 0.3 },
  pride: { composure: 0.6, engagement: 0.3 },
  satisfaction: { composure: 0.6 },
  contentment: { composure: 0.6 },
  realization: { engagement: 0.5, uncertainty: -0.3 },

  anxiety: { stress: 1.0, composure: -0.6 },
  fear: { stress: 0.9, composure: -0.5 },
  distress: { stress: 0.9, uncertainty: 0.3 },
  nervousness: { stress: 1.0, composure: -0.5 },
  awkwardness: { stress: 0.6, uncertainty: 0.4 },
  shame: { stress: 0.7, composure: -0.4 },
  embarrassment: { stress: 0.6, composure: -0.3 },

  doubt: { uncertainty: 1.0, composure: -0.3 },
  confusion: { uncertainty: 1.0, engagement: 0.2 },
  disappointment: { uncertainty: 0.4, stress: 0.3 },
  contemplation: { uncertainty: 0.3, engagement: 0.6 },

  tiredness: { engagement: -0.6 },
  boredom: { engagement: -0.8 },
  distraction: { engagement: -0.7 },
};

/**
 * MediaPipe FaceLandmarker blendshapes — ARKit-style muscle activations.
 *
 * These are a coarser instrument than Hume's labels and the mapping is openly
 * heuristic, which is why `SOURCE_RELIABILITY.mediapipe` is lower. Two
 * deliberate omissions: `jawOpen` and the mouth-open shapes track speech rather
 * than affect, and `eyeBlink*` is far too noisy per frame to read as tension.
 */
export const MEDIAPIPE_WEIGHTS: WeightTable = {
  mouthSmileLeft: { composure: 0.7, engagement: 0.4 },
  mouthSmileRight: { composure: 0.7, engagement: 0.4 },

  // Inner brow raise without an outer raise is the classic worry shape.
  browInnerUp: { stress: 0.8, uncertainty: 0.4 },
  browOuterUpLeft: { engagement: 0.3 },
  browOuterUpRight: { engagement: 0.3 },
  // A furrow is thinking hard or not following; either way it is not composure.
  browDownLeft: { uncertainty: 0.6, engagement: 0.3, composure: -0.2 },
  browDownRight: { uncertainty: 0.6, engagement: 0.3, composure: -0.2 },

  eyeSquintLeft: { uncertainty: 0.5 },
  eyeSquintRight: { uncertainty: 0.5 },
  eyeWideLeft: { stress: 0.5 },
  eyeWideRight: { stress: 0.5 },
  // Sustained gaze away from the camera reads as disengaged.
  eyeLookDownLeft: { engagement: -0.4 },
  eyeLookDownRight: { engagement: -0.4 },
  eyeLookOutLeft: { engagement: -0.25 },
  eyeLookOutRight: { engagement: -0.25 },

  mouthPressLeft: { stress: 0.6, composure: -0.2 },
  mouthPressRight: { stress: 0.6, composure: -0.2 },
  mouthFrownLeft: { stress: 0.5, composure: -0.3 },
  mouthFrownRight: { stress: 0.5, composure: -0.3 },
  mouthPucker: { uncertainty: 0.4 },
  mouthShrugLower: { uncertainty: 0.5 },
  mouthShrugUpper: { uncertainty: 0.4 },

  noseSneerLeft: { stress: 0.3 },
  noseSneerRight: { stress: 0.3 },
  cheekSquintLeft: { composure: 0.3 },
  cheekSquintRight: { composure: 0.3 },
};

/**
 * How far to trust each provider before sample count is considered.
 *
 * Hume is a trained expression model; MediaPipe is geometry plus the heuristic
 * table above. Rating them equally would be dishonest about what the local
 * option can actually tell us.
 */
export const SOURCE_RELIABILITY: Record<EmotionSource, number> = {
  hume: 0.75,
  mediapipe: 0.5,
  none: 0,
};

/** Below this many frames, a read is noise dressed up as data. */
export const MIN_SAMPLES = 6;
/** Beyond this, more frames stop adding confidence. */
export const SAMPLES_FOR_FULL_RELIABILITY = 25;

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Apply a weight table to a set of raw scores.
 *
 * Each dimension is a weighted mean rather than a sum: summing would let a
 * provider that happens to return more labels in one category look more
 * certain, which is an artefact of the label set, not of the candidate.
 */
export function applyWeights(scores: Map<string, number>, table: WeightTable): EmotionDimensions {
  const totals: EmotionDimensions = { composure: 0, engagement: 0, stress: 0, uncertainty: 0 };
  const mass: EmotionDimensions = { composure: 0, engagement: 0, stress: 0, uncertainty: 0 };

  for (const [rawName, rawScore] of scores) {
    const weights = table[rawName] ?? table[rawName.toLowerCase()];
    if (!weights) continue;
    const score = clamp01(rawScore);

    for (const key of Object.keys(weights) as Array<keyof EmotionDimensions>) {
      const weight = weights[key];
      if (typeof weight !== 'number') continue;
      totals[key] += score * weight;
      mass[key] += Math.abs(weight);
    }
  }

  return {
    composure: mass.composure ? clamp01(totals.composure / mass.composure) : NEUTRAL_DIMENSIONS.composure,
    engagement: mass.engagement ? clamp01(totals.engagement / mass.engagement) : NEUTRAL_DIMENSIONS.engagement,
    stress: mass.stress ? clamp01(totals.stress / mass.stress) : 0,
    uncertainty: mass.uncertainty ? clamp01(totals.uncertainty / mass.uncertainty) : 0,
  };
}

/** Provider trust scaled by how much data backs the read. */
export function reliabilityFor(source: EmotionSource, samples: number): number {
  if (source === 'none' || samples < MIN_SAMPLES) return 0;
  const depth = Math.min(1, samples / SAMPLES_FOR_FULL_RELIABILITY);
  return clamp01(SOURCE_RELIABILITY[source] * depth);
}

/** Build a complete signal from raw provider scores. */
export function buildSignal(
  source: EmotionSource,
  scores: Map<string, number>,
  samples: number,
): EmotionSignal {
  if (source === 'none' || scores.size === 0) return NO_SIGNAL;

  const table = source === 'hume' ? HUME_WEIGHTS : MEDIAPIPE_WEIGHTS;
  const dimensions = applyWeights(scores, table);
  const reliability = reliabilityFor(source, samples);

  const breakdown = [...scores.entries()]
    .map(([name, score]) => ({ name, score: clamp01(score) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  return {
    ...dimensions,
    available: reliability > 0,
    source,
    reliability,
    samples,
    dominant: dominantLabel(dimensions),
    breakdown,
  };
}

/**
 * A one-word summary of the dimensions, for the live readout.
 *
 * Derived from the weighted dimensions rather than from the single
 * highest-scoring raw label — the loudest label is often a low-information one
 * like "concentration" that is true of every candidate in every interview.
 */
export function dominantLabel(d: EmotionDimensions): string {
  if (d.stress >= 0.55) return 'Tense';
  if (d.uncertainty >= 0.55) return 'Uncertain';
  if (d.engagement <= 0.25) return 'Disengaged';
  if (d.composure >= 0.65 && d.stress < 0.35) return 'Composed';
  if (d.engagement >= 0.6) return 'Engaged';
  return 'Neutral';
}

/**
 * A single 0..1 "how is this going" number for display and for the report.
 * Composure and engagement help; stress and uncertainty hurt, weighted by how
 * much the read can be trusted so a weak signal pulls toward neutral.
 */
export function compositeScore(signal: EmotionSignal): number {
  if (!signal.available) return 0.5;
  const raw =
    signal.composure * 0.4 + signal.engagement * 0.25 - signal.stress * 0.25 - signal.uncertainty * 0.1;
  const centred = clamp01(0.5 + raw - 0.325 * 0.5);
  return clamp01(0.5 + (centred - 0.5) * signal.reliability + (centred - 0.5) * (1 - signal.reliability) * 0.3);
}
