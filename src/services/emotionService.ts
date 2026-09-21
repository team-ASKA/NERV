/**
 * Emotion service — the one place the app asks "how is this candidate doing?".
 *
 * Two interchangeable providers sit behind it:
 *   • MediaPipe FaceLandmarker (default) — runs locally in the browser. No API
 *     key, no network round trip, no per-user cost, and the webcam frames never
 *     leave the machine. This is what makes the feature viable at 10k users.
 *   • Hume streaming — more accurate, cloud, billed per frame. Opt in with
 *     `VITE_EMOTION_PROVIDER=hume`, or it is used automatically if the local
 *     model cannot load and a Hume token is available.
 *
 * Whichever runs, this file owns the interpretation: smoothing, sample
 * counting, the weight tables in `shared/emotion.ts`, and reliability. The two
 * providers therefore cannot drift apart in meaning, and the report is computed
 * from the same numbers the live read used.
 *
 * HONESTY GUARANTEE
 * -----------------
 * This service never fabricates, randomises, seeds or floors a score. If no
 * provider starts, if the face leaves the frame, or if the stream drops, the
 * aggregate becomes `{ available: false }` with a reason the UI can show. A
 * stale read is treated as no read: after `STALE_AFTER_MS` without a face we
 * clear the buffer rather than keep reporting what someone's face did ten
 * seconds ago.
 */

import {
  NO_SIGNAL,
  buildSignal,
  compositeScore,
  type EmotionSignal,
  type EmotionSource,
} from '../../shared/emotion';
import type { EmotionAggregate } from '../types/interview';
import { logger } from '../lib/logger';
import { HumeProvider } from './emotion/hume';
import { MediaPipeProvider } from './emotion/mediapipe';
import type { EmotionProvider, RawScore } from './emotion/types';

/** No face for this long and the read is discarded, not reported as current. */
const STALE_AFTER_MS = 6_000;
const STALE_CHECK_MS = 2_000;

/**
 * Smoothing constant per provider, chosen for its frame rate rather than
 * shared: the local model runs ~8× faster, so the same alpha would make it
 * eight times twitchier for no extra information.
 */
const ALPHA: Record<EmotionSource, number> = {
  mediapipe: 0.12,
  hume: 0.45,
  none: 1,
};

type Listener = (agg: EmotionAggregate) => void;

type FrameSource = HTMLVideoElement | (() => string | null);

const UNAVAILABLE: EmotionAggregate = { available: false };

class EmotionService {
  private provider: EmotionProvider | null = null;
  private scores = new Map<string, number>();
  private samples = 0;
  private lastScoreAt = 0;
  private staleTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<Listener>();
  private active = false;
  private lastAgg: EmotionAggregate = UNAVAILABLE;
  private lastSignal: EmotionSignal = NO_SIGNAL;

  get available(): boolean {
    return this.lastAgg.available;
  }

  /** Which provider is actually running, for the UI and the report. */
  get source(): EmotionSource {
    return this.provider?.source ?? 'none';
  }

  /**
   * Begin reading. Pass the live `<video>` element — the local provider reads
   * pixels from it directly. A frame-capture function is still accepted for
   * callers that have no element, but only the cloud provider can use it.
   *
   * Resolves to whether a read is actually available. Never throws.
   */
  async start(source: FrameSource): Promise<boolean> {
    if (this.active) return this.available;
    this.active = true;

    const video = typeof source === 'function' ? null : source;
    const getFrame =
      typeof source === 'function' ? source : () => (video ? captureJpegBase64(video) : null);

    const input = {
      video,
      getFrame,
      onScores: (scores: RawScore[]) => this.ingest(scores),
      onLost: (reason: string) => this.lose(reason),
    };

    for (const candidate of this.providerOrder()) {
      if (!this.active) return false; // stopped while a provider was loading
      const started = await candidate.start(input).catch(() => false);
      if (started) {
        this.provider = candidate;
        this.startStaleWatch();
        logger.info(`[emotion] reading expressions via ${candidate.source}`);
        this.emit();
        return true;
      }
    }

    logger.info('[emotion] no provider available — running without a demeanor read');
    this.setUnavailable('Expression analysis is not available in this browser.');
    return false;
  }

  stop(): void {
    this.active = false;
    this.provider?.stop();
    this.provider = null;
    if (this.staleTimer) {
      clearInterval(this.staleTimer);
      this.staleTimer = null;
    }
    this.reset();
    this.setUnavailable();
  }

  getAggregate(): EmotionAggregate {
    return this.lastAgg;
  }

  /** The weighted signal, for callers that want the dimensions directly. */
  getSignal(): EmotionSignal {
    return this.lastSignal;
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    cb(this.lastAgg);
    return () => {
      this.listeners.delete(cb);
    };
  }

  // ---- internals -----------------------------------------------------------

  /**
   * Local first. Hume is better, but one socket and a frame-by-frame invoice
   * per candidate is a poor default for a product that wants to run thousands
   * of interviews at once — so it is an explicit choice, not an accident.
   */
  private providerOrder(): EmotionProvider[] {
    const preference = (import.meta.env.VITE_EMOTION_PROVIDER || 'auto').toLowerCase();
    if (preference === 'hume') return [new HumeProvider(), new MediaPipeProvider()];
    if (preference === 'mediapipe' || preference === 'local') return [new MediaPipeProvider()];
    if (preference === 'off' || preference === 'none') return [];
    return [new MediaPipeProvider(), new HumeProvider()];
  }

  private ingest(scores: RawScore[]): void {
    if (!this.active) return;

    if (scores.length === 0) return; // no face this frame; the stale watch handles a run of these

    const alpha = ALPHA[this.source];
    for (const { name, score } of scores) {
      if (typeof score !== 'number' || Number.isNaN(score)) continue;
      const prev = this.scores.get(name);
      this.scores.set(name, prev === undefined ? score : alpha * score + (1 - alpha) * prev);
    }

    this.samples += 1;
    this.lastScoreAt = Date.now();
    this.recompute();
    this.emit();
  }

  private recompute(): void {
    const signal = buildSignal(this.source, this.scores, this.samples);
    this.lastSignal = signal;

    if (!signal.available) {
      // Still warming up: real data, just not enough of it to be worth acting
      // on. Say so rather than publishing a low-confidence guess.
      this.lastAgg = { available: false, unavailableReason: 'Reading expressions…' };
      return;
    }

    this.lastAgg = {
      available: true,
      source: signal.source,
      reliability: signal.reliability,
      samples: signal.samples,
      dimensions: {
        composure: signal.composure,
        engagement: signal.engagement,
        stress: signal.stress,
        uncertainty: signal.uncertainty,
      },
      dominantEmotion: signal.dominant,
      confidenceScore: compositeScore(signal),
      isConfident: signal.composure >= 0.6 && signal.stress < 0.35,
      isNervous: signal.stress >= 0.45,
      isStruggling: signal.uncertainty >= 0.55,
      breakdown: (signal.breakdown ?? []).map((entry) => ({
        name: prettyLabel(entry.name),
        score: entry.score,
      })),
    };
  }

  /**
   * A face that left the frame is not a calm face. Once the read goes stale we
   * throw the buffer away, so when the candidate comes back the reliability
   * ramp starts over instead of resuming a minute-old impression.
   */
  private startStaleWatch(): void {
    if (this.staleTimer) clearInterval(this.staleTimer);
    this.lastScoreAt = Date.now();
    this.staleTimer = setInterval(() => {
      if (!this.active || this.samples === 0) return;
      if (Date.now() - this.lastScoreAt <= STALE_AFTER_MS) return;
      this.reset();
      this.setUnavailable('No face in frame.');
    }, STALE_CHECK_MS);
  }

  private lose(reason: string): void {
    logger.info('[emotion] read lost:', reason);
    this.provider?.stop();
    this.provider = null;
    this.reset();
    this.setUnavailable(reason);
  }

  private reset(): void {
    this.scores.clear();
    this.samples = 0;
    this.lastSignal = NO_SIGNAL;
  }

  private setUnavailable(reason?: string): void {
    this.lastAgg = reason ? { available: false, unavailableReason: reason } : UNAVAILABLE;
    this.emit();
  }

  private emit(): void {
    for (const cb of this.listeners) cb(this.lastAgg);
  }
}

// ---- helpers ---------------------------------------------------------------

/**
 * Raw signal names are provider-shaped — Hume's are lowercase words, MediaPipe's
 * are camelCase muscle names like `browInnerUp`. Make both readable.
 */
export function prettyLabel(name: string): string {
  const spaced = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase() : name;
}

/** Capture the current frame of a video element as base64 JPEG (no data prefix). */
export function captureJpegBase64(video: HTMLVideoElement, maxWidth = 320, quality = 0.6): string | null {
  if (!video.videoWidth || !video.videoHeight) return null;
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const w = Math.round(video.videoWidth * scale);
  const h = Math.round(video.videoHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : null;
}

export const emotionService = new EmotionService();
