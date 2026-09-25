/**
 * Voice service: speech-to-text and text-to-speech for the interview loop.
 *
 * Both directions go through the server proxies (`/api/stt`, `/api/tts`) so no
 * vendor keys ever reach the browser. TTS is pipelined at the sentence level —
 * the next sentence is synthesised while the current one plays — for low
 * time-to-first-audio, and supports barge-in (an in-flight utterance can be
 * cut off the moment the candidate starts speaking). If the server reports a
 * degraded (unconfigured) mode, TTS falls back to the browser's SpeechSynthesis
 * so the interview can still proceed.
 *
 * Two ways to speak:
 *   • `speak(text)` — the whole text is known up front (repeat a question).
 *   • `speakStreaming()` — the text is still arriving from the model. Each
 *     sentence is synthesised the moment it is complete, so the interviewer
 *     starts talking roughly one sentence into generation instead of after it.
 *     On a 2–3 sentence question that is the difference between ~1 s and ~3 s
 *     of silence after the candidate finishes answering.
 */

import { logger } from '../lib/logger';
import { authedFetch } from '../lib/authedFetch';

export interface SpeakOptions {
  /** Called once audio actually begins. */
  onStart?: () => void;
  /** Called when playback finishes (not called if barged-in). */
  onEnd?: () => void;
}

/** A spoken reply whose text is still being generated. */
export interface Utterance {
  /** Feed the next slice of text as it arrives. */
  push(delta: string): void;
  /** No more text is coming; speak whatever is buffered. */
  end(): void;
  /** Stop immediately (barge-in, session end). Idempotent. */
  cancel(): void;
  /** Resolves when every queued chunk has played, or the utterance was cut off. */
  readonly done: Promise<void>;
}

type SynthResult =
  | { kind: 'buffer'; buffer: AudioBuffer }
  | { kind: 'degraded'; text: string }
  | { kind: 'empty' };

// Chunking for streamed speech. The first chunk is allowed to be short so the
// opening clause goes out as soon as it is complete; later chunks merge short
// fragments so playback is not choppy, and are capped so one long sentence
// does not stall the pipeline.
const MIN_FIRST_CHUNK = 12;
const MIN_CHUNK = 40;
const MAX_CHUNK = 240;

class VoiceService {
  private audioContext: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  /** Resolver of whatever `playBuffer`/`browserSpeak` is awaiting, so a stop unblocks it. */
  private currentResolve: (() => void) | null = null;
  /** Wakes a streaming utterance's player so it can notice it was cancelled. */
  private wakeStreaming: (() => void) | null = null;
  private speakToken = 0;
  private _speaking = false;
  /**
   * Whether `/api/tts` has a key behind it. `null` until the warm-up or first
   * call tells us. Once known to be off we stop paying a round trip per
   * sentence and go straight to the browser voice.
   */
  private ttsConfigured: boolean | null = null;

  get speaking(): boolean {
    return this._speaking;
  }

  // ---- audio context -------------------------------------------------------

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.audioContext) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.audioContext = new Ctor();
    }
    if (this.audioContext.state === 'suspended') {
      void this.audioContext.resume().catch(() => undefined);
    }
    return this.audioContext;
  }

  /** Call from a user gesture (e.g. the Start button) to unlock audio. */
  unlock(): void {
    this.ensureContext();
  }

  /**
   * Wake the speech functions before they are needed. Serverless cold starts
   * land on the first request of a session — which is exactly the first
   * sentence the candidate hears — so we take that hit while the VAD model is
   * still loading instead. Also learns whether TTS is configured at all.
   * Fire-and-forget; never throws.
   */
  warm(): void {
    if (typeof fetch === 'undefined') return;
    void fetch('/api/tts', { method: 'GET' })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { configured?: boolean };
        if (typeof data.configured === 'boolean') this.ttsConfigured = data.configured;
      })
      .catch(() => undefined);
    void fetch('/api/stt', { method: 'GET' }).catch(() => undefined);
  }

  // ---- speech-to-text ------------------------------------------------------

  /**
   * Transcribe an utterance. Accepts a recorded Blob or raw PCM (Float32 mono)
   * from the VAD, which is encoded to WAV before upload.
   */
  async transcribe(input: Blob | Float32Array, sampleRate = 16000): Promise<string> {
    try {
      const wav = input instanceof Float32Array ? float32ToWav(input, sampleRate) : input;
      if (wav.size < 1200) return ''; // too short to be speech
      const base64 = await blobToBase64(wav);
      const res = await authedFetch('/api/stt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: base64, mimeType: 'audio/wav', languageCode: 'en-IN' }),
      });
      if (!res.ok) {
        logger.error('[voice] STT failed', res.status);
        return '';
      }
      const data = (await res.json()) as { transcript?: string };
      return (data.transcript || '').trim();
    } catch (err) {
      logger.error('[voice] transcribe error', (err as Error)?.message);
      return '';
    }
  }

  // ---- text-to-speech ------------------------------------------------------

  /** Speak `text`, cancelling any current utterance first (barge-in-safe). */
  async speak(text: string, opts: SpeakOptions = {}): Promise<void> {
    this.stopSpeaking();
    const sentences = splitSentences(text);
    if (!sentences.length) return;

    const token = ++this.speakToken;
    this._speaking = true;
    let started = false;
    const markStart = () => {
      if (!started) {
        started = true;
        opts.onStart?.();
      }
    };

    try {
      // One-ahead pipeline: prefetch sentence i+1 while sentence i plays.
      let nextPromise: Promise<SynthResult> = this.synth(sentences[0]);
      for (let i = 0; i < sentences.length; i++) {
        if (token !== this.speakToken) return; // barged in
        const result = await nextPromise;
        nextPromise = i + 1 < sentences.length ? this.synth(sentences[i + 1]) : Promise.resolve({ kind: 'empty' as const });

        if (token !== this.speakToken) return;

        if (result.kind === 'degraded') {
          // Server not configured — speak the remaining text with browser TTS.
          markStart();
          await this.browserSpeak(sentences.slice(i).join(' '), token);
          return;
        }
        if (result.kind === 'buffer') {
          markStart();
          await this.playBuffer(result.buffer, token);
        }
      }
    } finally {
      if (token === this.speakToken) {
        this._speaking = false;
        opts.onEnd?.();
      }
    }
  }

  /**
   * Speak text that is still arriving. Chunks are cut at sentence boundaries
   * as soon as they are complete and synthesised immediately — overlapping the
   * model's generation — then played strictly in order. Cancelling any current
   * utterance first, like `speak`.
   */
  speakStreaming(opts: SpeakOptions = {}): Utterance {
    this.stopSpeaking();
    const token = ++this.speakToken;
    this._speaking = true;

    let buffer = '';
    let ended = false;
    let first = true;
    const queue: Array<Promise<SynthResult>> = [];

    // The player sleeps on `wake` when it has caught up with the queue.
    let wake: (() => void) | null = null;
    const signal = () => {
      const w = wake;
      wake = null;
      w?.();
    };
    this.wakeStreaming = signal;

    const enqueue = (flush: boolean) => {
      if (token !== this.speakToken) return;
      const { chunks, rest } = takeChunks(buffer, flush, first);
      buffer = rest;
      for (const chunk of chunks) {
        first = false;
        queue.push(this.synth(chunk)); // synthesis starts now, not when its turn comes
      }
      if (chunks.length) signal();
    };

    const done = (async () => {
      let started = false;
      let index = 0;
      try {
        for (;;) {
          if (token !== this.speakToken) return;
          if (index >= queue.length) {
            if (ended) return;
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
            continue;
          }
          const result = await queue[index++];
          if (token !== this.speakToken) return;
          if (result.kind === 'empty') continue;
          if (!started) {
            started = true;
            opts.onStart?.();
          }
          if (result.kind === 'buffer') await this.playBuffer(result.buffer, token);
          else await this.browserSpeak(result.text, token);
        }
      } finally {
        if (token === this.speakToken) {
          this._speaking = false;
          this.wakeStreaming = null;
          opts.onEnd?.();
        }
      }
    })();

    return {
      push: (delta: string) => {
        if (ended || token !== this.speakToken || !delta) return;
        buffer += delta;
        enqueue(false);
      },
      end: () => {
        if (ended) return;
        ended = true;
        enqueue(true);
        signal(); // even with nothing new, so the player can observe `ended`
      },
      cancel: () => {
        if (token === this.speakToken) this.stopSpeaking();
        signal();
      },
      done,
    };
  }

  /** Immediately stop any playback/synthesis (barge-in). */
  stopSpeaking(): void {
    this.speakToken++;
    this._speaking = false;
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch {
        /* already stopped */
      }
      this.currentSource = null;
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    // Unblock whoever is awaiting the interrupted chunk, and wake a streaming
    // player parked on an empty queue so it can see the token moved on.
    const resolve = this.currentResolve;
    this.currentResolve = null;
    resolve?.();
    const wake = this.wakeStreaming;
    this.wakeStreaming = null;
    wake?.();
  }

  private async synth(sentence: string): Promise<SynthResult> {
    const ctx = this.ensureContext();
    if (!ctx || this.ttsConfigured === false) return { kind: 'degraded', text: sentence };
    try {
      const res = await authedFetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sentence }),
      });
      if (!res.ok) {
        logger.warn('[voice] TTS status', res.status);
        return { kind: 'degraded', text: sentence };
      }
      const data = (await res.json()) as { audio?: string | null; degraded?: boolean };
      if (data.degraded) this.ttsConfigured = false; // explicit "no key": stop asking
      if (data.degraded || !data.audio) return { kind: 'degraded', text: sentence };
      this.ttsConfigured = true;
      const bytes = base64ToBytes(data.audio);
      const buffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
      return { kind: 'buffer', buffer };
    } catch (err) {
      logger.warn('[voice] synth error', (err as Error)?.message);
      return { kind: 'degraded', text: sentence };
    }
  }

  private playBuffer(buffer: AudioBuffer, token: number): Promise<void> {
    const ctx = this.audioContext;
    if (!ctx) return Promise.resolve();
    return new Promise<void>((resolve) => {
      if (token !== this.speakToken) {
        resolve();
        return;
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      this.currentSource = source;
      this.currentResolve = resolve;
      source.onended = () => {
        if (this.currentSource === source) this.currentSource = null;
        if (this.currentResolve === resolve) this.currentResolve = null;
        resolve();
      };
      source.start(0);
    });
  }

  private browserSpeak(text: string, token: number): Promise<void> {
    return new Promise<void>((resolve) => {
      if (typeof window === 'undefined' || !window.speechSynthesis || token !== this.speakToken) {
        resolve();
        return;
      }
      const utter = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();
      const preferred =
        voices.find((v) => v.lang.startsWith('en') && /female|zira|samantha|aria/i.test(v.name)) ||
        voices.find((v) => v.lang.startsWith('en'));
      if (preferred) utter.voice = preferred;
      utter.rate = 1.05;
      const finish = () => {
        if (this.currentResolve === resolve) this.currentResolve = null;
        resolve();
      };
      utter.onend = finish;
      utter.onerror = finish;
      this.currentResolve = resolve;
      window.speechSynthesis.speak(utter);
    });
  }
}

// ---- module-level helpers --------------------------------------------------

/** Split text into speakable chunks: sentence-bounded, ~240 char cap, no tiny fragments. */
function splitSentences(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const rough = clean.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) || [clean];
  const out: string[] = [];
  let buffer = '';
  for (const piece of rough) {
    const s = piece.trim();
    if (!s) continue;
    if ((buffer + ' ' + s).trim().length > MAX_CHUNK) {
      if (buffer) out.push(buffer.trim());
      buffer = s;
    } else if (buffer.length < MIN_CHUNK) {
      // merge short fragments so playback isn't choppy
      buffer = (buffer + ' ' + s).trim();
    } else {
      out.push(buffer.trim());
      buffer = s;
    }
  }
  if (buffer.trim()) out.push(buffer.trim());
  return out;
}

/**
 * A sentence end: terminal punctuation, optional closing quote/bracket, then
 * whitespace — or the end of the buffer, which only counts once the stream has
 * finished (mid-stream, a trailing "3." may be the start of "3.5").
 */
const BOUNDARY = /[.!?]+["')\]]*(\s+|$)/g;

/**
 * Pull complete, speakable chunks off the front of a growing buffer.
 * Exported for tests only.
 */
export function takeChunks(
  buffer: string,
  flush: boolean,
  first: boolean,
): { chunks: string[]; rest: string } {
  const chunks: string[] = [];
  let rest = buffer;
  let minLen = first ? MIN_FIRST_CHUNK : MIN_CHUNK;

  for (;;) {
    let cut = -1;
    BOUNDARY.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = BOUNDARY.exec(rest))) {
      const atEnd = match[1] === '';
      if (atEnd && !flush) break;
      const end = match.index + match[0].length;
      if (end >= minLen) {
        cut = end;
        break;
      }
    }
    // No usable boundary but the sentence has run long: cut at a word gap so
    // synthesis can start rather than waiting for a full stop that may be
    // another hundred characters away.
    if (cut === -1 && rest.length > MAX_CHUNK) {
      const space = rest.lastIndexOf(' ', MAX_CHUNK);
      cut = space > minLen ? space + 1 : MAX_CHUNK;
    }
    if (cut === -1) break;

    const chunk = rest.slice(0, cut).trim();
    rest = rest.slice(cut);
    if (chunk) {
      chunks.push(chunk);
      minLen = MIN_CHUNK;
    }
  }

  if (flush) {
    const tail = rest.trim();
    if (tail) chunks.push(tail);
    rest = '';
  }
  return { chunks, rest };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = window.atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Encode Float32 mono PCM as a 16-bit WAV blob. */
function float32ToWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([view], { type: 'audio/wav' });
}

export const voiceService = new VoiceService();
