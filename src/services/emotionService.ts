/**
 * Emotion service — streaming facial-expression analysis via Hume.
 *
 * Flow: fetch a short-lived access token from `/api/emotion/token` (minted
 * server-side; no Hume keys in the browser) → open the Hume streaming
 * WebSocket → push throttled webcam frames → maintain a smoothed rolling
 * aggregate the interview loop can read.
 *
 * Honesty guarantee: if the token is unavailable, the socket fails to open, or
 * no data arrives, the aggregate stays `{ available: false }`. This service
 * NEVER fabricates or randomises emotion scores — the old fake-fallback
 * behaviour is deliberately gone. The UI must show a clear "unavailable" state.
 */

import type { EmotionAggregate } from '../types/interview';
import { logger } from '../lib/logger';

const HUME_STREAM_URL = 'wss://api.hume.ai/v0/stream/models';
const FRAME_INTERVAL_MS = 900;
const EWMA_ALPHA = 0.45;

// Hume emotion labels grouped for a simple confidence/nervousness read.
// Exported so the report derives its numbers from the same groupings that the
// live read used — one definition, no drift between the room and the summary.
export const POSITIVE = ['calmness', 'concentration', 'interest', 'determination', 'confidence', 'pride', 'satisfaction', 'contentment', 'excitement', 'joy'];
export const NERVOUS = ['anxiety', 'fear', 'doubt', 'distress', 'awkwardness', 'nervousness', 'shame'];
export const STRUGGLE = ['confusion', 'distress', 'disappointment', 'tiredness'];

type Listener = (agg: EmotionAggregate) => void;

class EmotionService {
  private ws: WebSocket | null = null;
  private frameTimer: ReturnType<typeof setInterval> | null = null;
  private getFrame: (() => string | null) | null = null;
  private scores = new Map<string, number>();
  private listeners = new Set<Listener>();
  private _available = false;
  private active = false;
  private lastAgg: EmotionAggregate = { available: false };

  get available(): boolean {
    return this._available;
  }

  /**
   * Begin streaming. `getFrame` returns a base64 JPEG (no data: prefix) of the
   * current webcam frame, or null when unavailable. Resolves to whether
   * emotion analysis is actually available.
   */
  async start(getFrame: () => string | null): Promise<boolean> {
    if (this.active) return this._available;
    this.active = true;
    this.getFrame = getFrame;

    let token: string | null = null;
    try {
      const res = await fetch('/api/emotion/token');
      const data = (await res.json()) as { available?: boolean; accessToken?: string };
      if (!data.available || !data.accessToken) {
        logger.info('[emotion] not configured — running in unavailable mode');
        this.setUnavailable();
        return false;
      }
      token = data.accessToken;
    } catch (err) {
      logger.warn('[emotion] token fetch failed', (err as Error)?.message);
      this.setUnavailable();
      return false;
    }

    try {
      await this.openSocket(token);
    } catch (err) {
      logger.warn('[emotion] socket failed', (err as Error)?.message);
      this.setUnavailable();
      return false;
    }
    return this._available;
  }

  stop(): void {
    this.active = false;
    if (this.frameTimer) {
      clearInterval(this.frameTimer);
      this.frameTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.onclose = null;
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.scores.clear();
    this.setUnavailable();
  }

  getAggregate(): EmotionAggregate {
    return this.lastAgg;
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    cb(this.lastAgg);
    return () => this.listeners.delete(cb);
  }

  // ---- internals -----------------------------------------------------------

  private openSocket(token: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(`${HUME_STREAM_URL}?access_token=${encodeURIComponent(token)}`);
      this.ws = socket;

      const failTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('timeout opening emotion stream'));
        }
      }, 6000);

      socket.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(failTimer);
        this._available = true;
        this.startFrameLoop();
        this.emit();
        resolve();
      };

      socket.onmessage = (event) => this.handleMessage(event.data);

      socket.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(failTimer);
          reject(new Error('emotion socket error'));
        }
      };

      socket.onclose = () => {
        if (this.active) {
          // Unexpected drop while running — degrade honestly rather than fake.
          logger.info('[emotion] stream closed');
          this.setUnavailable();
        }
      };
    });
  }

  private startFrameLoop(): void {
    if (this.frameTimer) clearInterval(this.frameTimer);
    this.frameTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.getFrame) return;
      const frame = this.getFrame();
      if (!frame) return;
      try {
        this.ws.send(JSON.stringify({ data: frame, models: { face: {} } }));
      } catch {
        /* send failures are non-fatal; next tick retries */
      }
    }, FRAME_INTERVAL_MS);
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') return;
    let msg: { face?: { predictions?: Array<{ emotions?: Array<{ name: string; score: number }> }>; warning?: string }; error?: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.error) {
      logger.warn('[emotion] stream error', msg.error);
      return;
    }
    const emotions = msg.face?.predictions?.[0]?.emotions;
    if (!emotions || !emotions.length) return; // no face this frame — keep last aggregate

    for (const e of emotions) {
      if (!e || typeof e.score !== 'number') continue;
      const key = e.name.toLowerCase();
      const prev = this.scores.get(key);
      this.scores.set(key, prev === undefined ? e.score : EWMA_ALPHA * e.score + (1 - EWMA_ALPHA) * prev);
    }
    this.recompute();
    this.emit();
  }

  private recompute(): void {
    let dominant = '';
    let dominantScore = -1;
    let positive = 0;
    let nervous = 0;
    let struggle = 0;

    for (const [name, score] of this.scores) {
      if (score > dominantScore) {
        dominantScore = score;
        dominant = name;
      }
      if (POSITIVE.includes(name)) positive += score;
      if (NERVOUS.includes(name)) nervous += score;
      if (STRUGGLE.includes(name)) struggle += score;
    }

    const confidenceScore = clamp01(0.5 + (positive - nervous - struggle) * 0.6);
    const breakdown = [...this.scores.entries()]
      .map(([name, score]) => ({ name: capitalize(name), score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    this.lastAgg = {
      available: true,
      dominantEmotion: capitalize(dominant),
      confidenceScore,
      isConfident: confidenceScore > 0.6,
      isNervous: nervous > 0.35,
      isStruggling: struggle > 0.3,
      breakdown,
    };
  }

  private setUnavailable(): void {
    this._available = false;
    this.lastAgg = { available: false };
    this.emit();
  }

  private emit(): void {
    for (const cb of this.listeners) cb(this.lastAgg);
  }
}

// ---- helpers ---------------------------------------------------------------

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
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
