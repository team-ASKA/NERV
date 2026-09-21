/**
 * Hume streaming provider — the cloud alternative, kept as an opt-in upgrade.
 *
 * More accurate than the local model (it returns trained expression labels
 * rather than muscle activations, hence the higher `SOURCE_RELIABILITY`), but
 * it costs one WebSocket and a stream of uploaded frames per candidate. Used
 * when `VITE_EMOTION_PROVIDER=hume`, or automatically if the local model cannot
 * load and Hume is configured.
 *
 * The API keys stay server-side: `/api/emotion/token` mints a short-lived
 * access token, which is the only credential that reaches the browser.
 */

import { logger } from '../../lib/logger';
import type { EmotionProvider, ProviderInput, RawScore } from './types';

const HUME_STREAM_URL = 'wss://api.hume.ai/v0/stream/models';
/** Frames are billed and travel over the network, so far slower than local. */
const FRAME_INTERVAL_MS = 900;
const OPEN_TIMEOUT_MS = 6_000;

interface HumeMessage {
  face?: {
    predictions?: Array<{ emotions?: Array<{ name: string; score: number }> }>;
  };
  error?: string;
}

export class HumeProvider implements EmotionProvider {
  readonly source = 'hume' as const;

  private ws: WebSocket | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  async start(input: ProviderInput): Promise<boolean> {
    if (this.running) return true;

    let token: string;
    try {
      const res = await fetch('/api/emotion/token');
      const data = (await res.json()) as { available?: boolean; accessToken?: string };
      if (!data.available || !data.accessToken) {
        logger.info('[emotion] hume is not configured');
        return false;
      }
      token = data.accessToken;
    } catch (err) {
      logger.info('[emotion] hume token unavailable:', (err as Error)?.message);
      return false;
    }

    try {
      await this.open(token, input);
    } catch (err) {
      logger.info('[emotion] hume stream failed:', (err as Error)?.message);
      this.stop();
      return false;
    }

    this.running = true;
    return true;
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.ws) {
      try {
        // Drop the handler first: a deliberate close must not look like a drop.
        this.ws.onclose = null;
        this.ws.close();
      } catch {
        // Already closing.
      }
      this.ws = null;
    }
  }

  // ---- internals -----------------------------------------------------------

  private open(token: string, input: ProviderInput): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(`${HUME_STREAM_URL}?access_token=${encodeURIComponent(token)}`);
      this.ws = socket;

      const failTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('timed out opening the stream'));
      }, OPEN_TIMEOUT_MS);

      socket.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(failTimer);
        this.startFrameLoop(input);
        resolve();
      };

      socket.onmessage = (event) => this.handleMessage(event.data, input);

      socket.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(failTimer);
        reject(new Error('socket error'));
      };

      socket.onclose = () => {
        if (!this.running) return;
        this.running = false;
        input.onLost('The expression stream disconnected.');
      };
    });
  }

  private startFrameLoop(input: ProviderInput): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const frame = input.getFrame();
      if (!frame) return;
      try {
        this.ws.send(JSON.stringify({ data: frame, models: { face: {} } }));
      } catch {
        // Non-fatal; the next tick retries.
      }
    }, FRAME_INTERVAL_MS);
  }

  private handleMessage(raw: unknown, input: ProviderInput): void {
    if (typeof raw !== 'string') return;

    let msg: HumeMessage;
    try {
      msg = JSON.parse(raw) as HumeMessage;
    } catch {
      return;
    }

    if (msg.error) {
      logger.warn('[emotion] hume error', msg.error);
      return;
    }

    const emotions = msg.face?.predictions?.[0]?.emotions;
    if (!emotions?.length) {
      input.onScores([]); // no face in this frame
      return;
    }

    const scores: RawScore[] = [];
    for (const e of emotions) {
      if (!e || typeof e.score !== 'number') continue;
      scores.push({ name: e.name.toLowerCase(), score: e.score });
    }
    input.onScores(scores);
  }
}
