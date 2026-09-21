/**
 * MediaPipe FaceLandmarker provider — the local, free, zero-latency option.
 *
 * WHY THIS IS THE DEFAULT
 * -----------------------
 * The cloud alternative (Hume) opens one WebSocket per candidate and bills per
 * frame. At 10k concurrent interviews that is 10k long-lived sockets and a
 * per-frame invoice, plus a network round trip inside a loop that is already
 * latency-sensitive. This runs entirely in the candidate's browser on WASM +
 * GPU: no socket, no API key, no per-user cost, no round trip, and the webcam
 * frames never leave the machine — which is a materially better privacy story
 * for a product that points a camera at people while they are stressed.
 *
 * The trade-off is honest and encoded in `SOURCE_RELIABILITY`: blendshapes are
 * muscle activations, so our reading of them is coarser than a trained
 * expression model. That is exactly why reliability is weighted lower rather
 * than the difference being hidden.
 *
 * Loaded from a CDN at runtime rather than bundled: it keeps ~3 MB of WASM out
 * of the main bundle for the users who never start an interview, and a blocked
 * CDN degrades to "unavailable" instead of breaking the build. Point
 * `VITE_VISION_CDN` at your own host to self-serve it.
 */

import { logger } from '../../lib/logger';
import type { EmotionProvider, ProviderInput, RawScore } from './types';

const CDN = import.meta.env.VITE_VISION_CDN || 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22';
const BUNDLE_URL = `${CDN}/vision_bundle.mjs`;
const WASM_BASE = `${CDN}/wasm`;
const MODEL_URL =
  import.meta.env.VITE_FACE_MODEL_URL ||
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

/** ~8 fps. The read is a rolling average over seconds; more frames buy nothing. */
const DETECT_INTERVAL_MS = 120;
const LOAD_TIMEOUT_MS = 12_000;

// Minimal structural types for the CDN module — it ships its own .d.ts, but we
// deliberately do not take a build-time dependency on the package.
interface Category {
  categoryName?: string;
  displayName?: string;
  score: number;
}
interface DetectResult {
  faceBlendshapes?: Array<{ categories: Category[] }>;
}
interface Landmarker {
  detectForVideo(video: HTMLVideoElement, timestampMs: number): DetectResult;
  close(): void;
}
interface VisionModule {
  FilesetResolver: { forVisionTasks(base: string): Promise<unknown> };
  FaceLandmarker: {
    createFromOptions(fileset: unknown, options: unknown): Promise<Landmarker>;
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms)),
  ]);
}

export class MediaPipeProvider implements EmotionProvider {
  readonly source = 'mediapipe' as const;

  private landmarker: Landmarker | null = null;
  private raf: number | null = null;
  private running = false;
  private lastDetect = 0;
  /**
   * detectForVideo rejects a timestamp that is not strictly increasing, and
   * requestAnimationFrame can hand back the same value twice.
   */
  private lastTimestamp = 0;

  async start(input: ProviderInput): Promise<boolean> {
    const video = input.video;
    if (!video) return false;
    if (this.running) return true;

    try {
      // A variable specifier with @vite-ignore: this is an external runtime URL,
      // not something the bundler should try to resolve or pre-bundle.
      const vision = (await withTimeout(
        import(/* @vite-ignore */ BUNDLE_URL),
        LOAD_TIMEOUT_MS,
        'vision bundle',
      )) as VisionModule;

      const fileset = await withTimeout(
        vision.FilesetResolver.forVisionTasks(WASM_BASE),
        LOAD_TIMEOUT_MS,
        'wasm fileset',
      );

      this.landmarker = await withTimeout(
        vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: false,
        }),
        LOAD_TIMEOUT_MS,
        'face landmarker',
      );
    } catch (err) {
      logger.info('[emotion] local face model unavailable:', (err as Error)?.message);
      this.cleanup();
      return false;
    }

    this.running = true;
    this.loop(video, input);
    return true;
  }

  stop(): void {
    this.running = false;
    if (this.raf !== null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
    this.cleanup();
  }

  // ---- internals -----------------------------------------------------------

  /**
   * Driven by requestAnimationFrame rather than setInterval so the browser
   * throttles it for us when the tab is hidden — there is no face to read when
   * nobody is looking, and burning GPU in a background tab is how a laptop fan
   * ends up in a candidate's interview recording.
   */
  private loop(video: HTMLVideoElement, input: ProviderInput): void {
    const tick = () => {
      if (!this.running || !this.landmarker) return;
      this.raf = requestAnimationFrame(tick);

      const now = performance.now();
      if (now - this.lastDetect < DETECT_INTERVAL_MS) return;
      this.lastDetect = now;

      if (video.readyState < 2 || video.videoWidth === 0) return;

      const timestamp = now <= this.lastTimestamp ? this.lastTimestamp + 1 : now;
      this.lastTimestamp = timestamp;

      try {
        const result = this.landmarker.detectForVideo(video, timestamp);
        input.onScores(toScores(result));
      } catch (err) {
        // A single bad frame is normal (resize, track restart). A dead
        // landmarker is not, and the facade needs to hear about it.
        logger.warn('[emotion] detect failed', (err as Error)?.message);
        this.running = false;
        this.cleanup();
        input.onLost('The local face model stopped responding.');
      }
    };

    this.raf = requestAnimationFrame(tick);
  }

  private cleanup(): void {
    try {
      this.landmarker?.close();
    } catch {
      // Already torn down — nothing useful to do.
    }
    this.landmarker = null;
  }
}

function toScores(result: DetectResult): RawScore[] {
  const categories = result.faceBlendshapes?.[0]?.categories;
  if (!categories?.length) return []; // no face in frame

  const scores: RawScore[] = [];
  for (const category of categories) {
    const name = category.categoryName || category.displayName;
    // `_neutral` is the model's "nothing is happening" catch-all and carries
    // most of the mass on a resting face; it would swamp every real signal.
    if (!name || name === '_neutral') continue;
    if (typeof category.score !== 'number') continue;
    scores.push({ name, score: category.score });
  }
  return scores;
}
