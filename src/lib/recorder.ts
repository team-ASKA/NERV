/**
 * Minimal PCM recorder for the manual / push-to-talk path (used when VAD is
 * unavailable). Captures mono Float32 samples via an AudioContext so the output
 * can be encoded to WAV for the STT proxy — regardless of MediaRecorder codec
 * support in the browser.
 *
 * Bounded by design (V01): at most MAX_SECONDS of audio are retained; the
 * recorder stops itself at the cap and reports it, so an answer is never
 * silently discarded. Output is resampled to 16 kHz mono.
 */

const MAX_SECONDS = 90;
const TARGET_RATE = 16000;

interface AudioContextCtor {
  new (): AudioContext;
}

export class PcmRecorder {
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  private keptSamples = 0;
  private _sampleRate = 16000;
  private recording = false;
  /** True when the cap ended the capture: the UI must say so. */
  private capped = false;

  get isRecording(): boolean {
    return this.recording;
  }

  /** True when capture stopped at the duration cap rather than by the user. */
  get wasCapped(): boolean {
    return this.capped;
  }

  get sampleRate(): number {
    return this._sampleRate;
  }

  start(stream: MediaStream): void {
    if (this.recording) return;
    const Ctor = (window.AudioContext || (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext) as AudioContextCtor | undefined;
    if (!Ctor) throw new Error('AudioContext unavailable');

    this.ctx = new Ctor();
    this._sampleRate = this.ctx.sampleRate;
    this.chunks = [];
    this.keptSamples = 0;
    this.capped = false;
    const capSamples = MAX_SECONDS * this._sampleRate;
    this.source = this.ctx.createMediaStreamSource(stream);
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (e: AudioProcessingEvent) => {
      if (!this.recording) return;
      const frame = new Float32Array(e.inputBuffer.getChannelData(0));
      const room = capSamples - this.keptSamples;
      if (room <= 0) {
        // At the cap: stop retaining, keep the recorder honest about it.
        this.capped = true;
        return;
      }
      this.chunks.push(room < frame.length ? frame.slice(0, room) : frame);
      this.keptSamples += Math.min(room, frame.length);
      if (this.keptSamples >= capSamples) this.capped = true;
    };
    this.source.connect(this.processor);
    this.processor.connect(this.ctx.destination); // required for the node to run
    this.recording = true;
  }

  /** Stop and return the captured mono PCM resampled to 16 kHz. */
  stop(): { pcm: Float32Array; sampleRate: number; capped: boolean } {
    this.recording = false;
    const sampleRate = this._sampleRate;
    const capped = this.capped;

    try {
      this.processor?.disconnect();
      this.source?.disconnect();
      void this.ctx?.close();
    } catch {
      /* ignore teardown errors */
    }
    this.processor = null;
    this.source = null;
    this.ctx = null;

    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const pcm = new Float32Array(total);
    let offset = 0;
    for (const c of this.chunks) {
      pcm.set(c, offset);
      offset += c.length;
    }
    this.chunks = [];
    this.keptSamples = 0;
    return { pcm: resampleMono(pcm, sampleRate, TARGET_RATE), sampleRate: TARGET_RATE, capped };
  }
}

/** Naive linear resample for mono PCM. Adequate for a bounded fallback path. */
function resampleMono(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to || input.length === 0) return input;
  const ratio = from / to;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, input.length - 1);
    const frac = pos - lo;
    out[i] = (input[lo] ?? 0) * (1 - frac) + (input[hi] ?? 0) * frac;
  }
  return out;
}
