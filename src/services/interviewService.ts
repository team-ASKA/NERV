/**
 * Thin client for the unified interview engine (`/api/interview/next`).
 * Supports token streaming (SSE) with an automatic fall back to a single JSON
 * response if streaming isn't available. All persona/round logic lives on the
 * server; this only ferries the transcript + context and yields text back.
 */

import type { EmotionAggregate, ResumeContext, Round, TranscriptTurn } from '../types/interview';
import { authedFetch } from '../lib/authedFetch';
import { logger } from '../lib/logger';

// The worker writes these and this reads them, so the shape belongs to neither
// side alone — it lives in `shared/` with the rest of the simulation contract.
export type { PrimedOpeners } from '../../shared/simulation';
import type { PrimedOpeners } from '../../shared/simulation';
import { ROUNDS } from '../../shared/interview';

export interface NextQuestionRequest {
  round: Round;
  resume: ResumeContext | null;
  transcript: TranscriptTurn[];
  emotion?: EmotionAggregate | null;
  code?: string;
}

export interface NextQuestionResult {
  message: string;
  round: Round;
  isFollowUp: boolean;
  degraded?: boolean;
}

export type StreamEvent = { delta: string } | { done: NextQuestionResult };

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * Fetch the opening questions the worker wrote after this resume was ingested.
 *
 * Never throws and never blocks anything: an empty result simply means the first
 * question is generated live, exactly as it was before priming existed. Called
 * once when a round page mounts — while the candidate is still reading the intro
 * — so it is off the interview's critical path in both directions.
 */
export async function fetchPrimedOpeners(signal?: AbortSignal): Promise<PrimedOpeners> {
  try {
    const res = await authedFetch('/api/interview/openers', { method: 'GET', signal });
    if (!res.ok) return {};
    const data = (await res.json()) as { openers?: unknown };
    const raw = data.openers;
    if (!raw || typeof raw !== 'object') return {};

    const source = raw as Record<string, unknown>;
    const openers: PrimedOpeners = {};
    for (const round of ROUNDS) {
      const value = source[round];
      if (typeof value === 'string' && value.trim()) openers[round] = value.trim();
    }
    return openers;
  } catch (err) {
    if ((err as Error)?.name !== 'AbortError') {
      logger.warn('[interview] could not read primed openers', (err as Error)?.message);
    }
    return {};
  }
}

/** Single-shot request (no streaming). Never throws; degrades to a flag. */
export async function fetchNextQuestion(req: NextQuestionRequest, signal?: AbortSignal): Promise<NextQuestionResult> {
  try {
    const res = await authedFetch('/api/interview/next', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(req),
      signal,
    });
    const data = (await res.json()) as NextQuestionResult;
    return {
      message: (data.message || '').trim(),
      round: data.round || req.round,
      isFollowUp: Boolean(data.isFollowUp),
      degraded: data.degraded,
    };
  } catch (err) {
    logger.error('[interview] fetchNextQuestion failed', (err as Error)?.message);
    return { message: '', round: req.round, isFollowUp: req.transcript.some((t) => t.role === 'interviewer'), degraded: true };
  }
}

/**
 * Stream the next question token-by-token. Yields `{ delta }` events as text
 * arrives and a final `{ done }` with the assembled message. Falls back to a
 * JSON request if the stream can't be opened.
 */
export async function* streamNextQuestion(req: NextQuestionRequest, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
  let res: Response;
  try {
    res = await authedFetch('/api/interview/next?stream=1', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(req),
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return;
    logger.warn('[interview] stream connect failed, falling back to JSON');
    yield { done: await fetchNextQuestion(req, signal) };
    return;
  }

  if (!res.ok || !res.body) {
    yield { done: await fetchNextQuestion(req, signal) };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let assembled = '';
  let finalResult: NextQuestionResult | null = null;

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') {
          if (finalResult) yield { done: finalResult };
          else yield { done: { message: assembled.trim(), round: req.round, isFollowUp: req.transcript.some((t) => t.role === 'interviewer') } };
          return;
        }
        try {
          const obj = JSON.parse(payload) as { delta?: string; done?: boolean; message?: string; round?: Round; isFollowUp?: boolean; degraded?: boolean };
          if (obj.done) {
            finalResult = {
              message: (obj.message || assembled).trim(),
              round: obj.round || req.round,
              isFollowUp: Boolean(obj.isFollowUp),
              degraded: obj.degraded,
            };
          } else if (typeof obj.delta === 'string') {
            assembled += obj.delta;
            yield { delta: obj.delta };
          }
        } catch {
          /* ignore malformed SSE fragment */
        }
      }
    }
  } catch (err) {
    if ((err as Error)?.name !== 'AbortError') {
      logger.warn('[interview] stream read error', (err as Error)?.message);
    }
  }

  if (finalResult) {
    yield { done: finalResult };
  } else if (assembled.trim()) {
    yield { done: { message: assembled.trim(), round: req.round, isFollowUp: req.transcript.some((t) => t.role === 'interviewer') } };
  } else {
    yield { done: await fetchNextQuestion(req, signal) };
  }
}
