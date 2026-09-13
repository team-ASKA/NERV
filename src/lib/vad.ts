/**
 * Voice Activity Detection wrapper around @ricky0123/vad-web (Silero VAD).
 *
 * The library + its ONNX model/wasm are loaded lazily from a CDN at runtime so
 * the app builds and ships without an extra npm install, and so a failure to
 * load never breaks the page. When VAD is unavailable (offline, CDN blocked,
 * API drift), `createVad` resolves to a stub with `available: false` and the
 * caller falls back to manual push-to-talk. It never throws.
 */

// Pinned versions known to work together. `+esm` gives a dependency-bundled
// ES module; the ONNX wasm is fetched separately from `onnxWASMBasePath`.
const VAD_VERSION = '0.0.19';
const ORT_VERSION = '1.14.0';
const VAD_ESM_URL = `https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@${VAD_VERSION}/+esm`;
const VAD_ASSET_BASE = `https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@${VAD_VERSION}/dist/`;
const ORT_WASM_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;

export interface VadOptions {
  /** Fired when the model first detects speech (used for barge-in). */
  onSpeechStart?: () => void;
  /** Fired with the full utterance PCM (Float32, 16 kHz mono) at end of speech. */
  onSpeechEnd?: (audio: Float32Array) => void;
  /** Fired when a detected segment was too short to be real speech. */
  onMisfire?: () => void;
  /** 0..1, higher = stricter about what counts as speech. */
  positiveSpeechThreshold?: number;
  /** Minimum frames of speech before a segment is emitted. */
  minSpeechFrames?: number;
  /** Trailing silence frames before speech is considered ended. */
  redemptionFrames?: number;
}

export interface VadHandle {
  /** True only when the real detector loaded and the mic is usable. */
  readonly available: boolean;
  /** Begin listening (resumes the audio graph). */
  start(): void;
  /** Stop listening without tearing down the model. */
  pause(): void;
  /** Fully release the mic + audio worklet. */
  destroy(): void;
}

const STUB: VadHandle = {
  available: false,
  start() {},
  pause() {},
  destroy() {},
};

interface MicVadInstance {
  start(): void;
  pause(): void;
  destroy(): void;
}

interface MicVadStatic {
  new: (opts: Record<string, unknown>) => Promise<MicVadInstance>;
}

/**
 * Create a running VAD instance. On any failure returns {@link STUB} so callers
 * can degrade gracefully instead of handling exceptions.
 */
export async function createVad(opts: VadOptions): Promise<VadHandle> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined' || !navigator.mediaDevices) {
    return STUB;
  }

  try {
    const mod: Record<string, unknown> = await import(/* @vite-ignore */ VAD_ESM_URL);
    const MicVAD = mod.MicVAD as MicVadStatic | undefined;
    if (!MicVAD || typeof MicVAD.new !== 'function') {
      console.warn('[vad] MicVAD not found in module — falling back to manual mode');
      return STUB;
    }

    const instance = await MicVAD.new({
      positiveSpeechThreshold: opts.positiveSpeechThreshold ?? 0.82,
      negativeSpeechThreshold: (opts.positiveSpeechThreshold ?? 0.82) - 0.35,
      minSpeechFrames: opts.minSpeechFrames ?? 4,
      redemptionFrames: opts.redemptionFrames ?? 12,
      preSpeechPadFrames: 2,
      baseAssetPath: VAD_ASSET_BASE,
      onnxWASMBasePath: ORT_WASM_BASE,
      onSpeechStart: () => opts.onSpeechStart?.(),
      onSpeechEnd: (audio: Float32Array) => opts.onSpeechEnd?.(audio),
      onVADMisfire: () => opts.onMisfire?.(),
    });

    let destroyed = false;
    return {
      available: true,
      start() {
        if (!destroyed) instance.start();
      },
      pause() {
        if (!destroyed) instance.pause();
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        try {
          instance.destroy();
        } catch {
          /* already gone */
        }
      },
    };
  } catch (err) {
    console.warn('[vad] failed to initialise, using manual mode:', (err as Error)?.message);
    return STUB;
  }
}
