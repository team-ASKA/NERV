/**
 * The contract every facial-read provider implements.
 *
 * A provider's only job is to produce raw named scores as often as it can. All
 * smoothing, weighting, reliability and honesty logic lives in
 * `emotionService`, so the two providers cannot drift apart in how their output
 * is interpreted — they differ only in how the numbers are obtained.
 */

import type { EmotionSource } from '../../../shared/emotion';

export interface RawScore {
  name: string;
  score: number;
}

export interface ProviderInput {
  /** The live webcam element. Required by local providers. */
  video: HTMLVideoElement | null;
  /** Base64 JPEG of the current frame, for providers that upload images. */
  getFrame: () => string | null;
  /** Called on every successful read. An empty array means "no face this frame". */
  onScores: (scores: RawScore[]) => void;
  /** Called when the provider dies mid-session and cannot recover. */
  onLost: (reason: string) => void;
}

export interface EmotionProvider {
  readonly source: EmotionSource;
  /** Resolves true once the provider is actually producing data. */
  start(input: ProviderInput): Promise<boolean>;
  stop(): void;
}
