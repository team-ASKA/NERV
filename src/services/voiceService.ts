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
 */

import { logger } from '../lib/logger';

export interface SpeakOptions {
  /** Called once audio actually begins. */
  onStart?: () => void;
  /** Called when playback finishes (not called if barged-in). */
  onEnd?: () => void;
}

type SynthResult =
  | { kind: 'buffer'; buffer: AudioBuffer }
  | { kind: 'degraded' }
  | { kind: 'empty' };

class VoiceService {
  private audioContext: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private speakToken = 0;
  private _speaking = false;

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
      const res = await fetch('/api/stt', {
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

  /** Immediately stop any playback/synthesis (barge-in). */
  stopSpeaking(): void {
    this.speakToken++;
    this._speaking = false;
    if (this.currentSource) {
      try {
        this.currentSource.onended = null;
        this.currentSource.stop();
      } catch {
        /* already stopped */
      }
      this.currentSource = null;
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }

  private async synth(sentence: string): Promise<SynthResult> {
    const ctx = this.ensureContext();
    if (!ctx) return { kind: 'degraded' };
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sentence }),
      });
      if (!res.ok) {
        logger.warn('[voice] TTS status', res.status);
        return { kind: 'degraded' };
      }
      const data = (await res.json()) as { audio?: string | null; degraded?: boolean };
      if (data.degraded || !data.audio) return { kind: 'degraded' };
      const bytes = base64ToBytes(data.audio);
      const buffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
      return { kind: 'buffer', buffer };
    } catch (err) {
      logger.warn('[voice] synth error', (err as Error)?.message);
      return { kind: 'degraded' };
    }
  }

  private playBuffer(buffer: AudioBuffer, token: number): Promise<void> {
    const ctx = this.audioContext;
    if (!ctx) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      this.currentSource = source;
      source.onended = () => {
        if (this.currentSource === source) this.currentSource = null;
        resolve();
      };
      if (token !== this.speakToken) {
        resolve();
        return;
      }
      source.start(0);
    });
  }

  private browserSpeak(text: string, token: number): Promise<void> {
    return new Promise<void>((resolve) => {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
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
      utter.onend = () => resolve();
      utter.onerror = () => resolve();
      if (token !== this.speakToken) {
        resolve();
        return;
      }
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
    if ((buffer + ' ' + s).trim().length > 240) {
      if (buffer) out.push(buffer.trim());
      buffer = s;
    } else if (buffer.length < 40) {
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
