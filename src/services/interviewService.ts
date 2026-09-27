/**
 * Thin client for the unified interview engine (`/api/interview/next`).
 * Supports token streaming (SSE) with an automatic fall back to a single JSON
 * response if streaming isn't available. All persona/round logic lives on the
 * server; this only ferries the transcript + context and yields text back.
 */

import type { EmotionAggregate, ResumeContext, Round, TranscriptTurn } from '../types/interview';
import { authedFetch, retryAfterSeconds } from '../lib/authedFetch';
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
  /** Set when the server rate-limited us; seconds until it is worth retrying. */
  retryAfter?: number;
}

export type StreamEvent = { delta: string } | { done: NextQuestionResult };

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** The subset of the emotion read that crosses the wire. */
type WireEmotion = Pick<
  EmotionAggregate,
  'available' | 'source' | 'samples' | 'dimensions' | 'dominantEmotion'
>;

/**
 * Reduce the emotion read to the fields the server actually reads.
 *
 * `coerceSignal` takes `available`, `source`, `samples`, `dimensions` and
 * `dominantEmotion` — and deliberately recomputes `reliability` from source and
 * sample count rather than trusting what the client claims. Everything else on
 * the client's aggregate exists for the panel on screen: `breakdown` is the top
 * raw provider labels (Hume returns dozens), `unavailableReason` is copy for the
 * candidate, and `confidenceScore`/`isConfident`/`isNervous`/`isStruggling` are
 * derived from `dimensions` the server already has.
 *
 * This is worth doing rather than shipping the whole object because it happens
 * on every turn of every interview, and the request body has to finish uploading
 * before the model can start generating — the one part of the round trip where
 * bytes are latency. An unavailable read is sent as `null`: the server maps it to
 * the same no-signal result either way.
 */
function wireEmotion(emotion: EmotionAggregate | null | undefined): WireEmotion | null {
  if (!emotion?.available) return null;
  return {
    available: true,
    source: emotion.source,
    samples: emotion.samples,
    dimensions: emotion.dimensions,
    dominantEmotion: emotion.dominantEmotion,
  };
}

/** Serialize a request to the `InterviewNextRequest` contract and nothing more. */
function requestBody(req: NextQuestionRequest): string {
  return JSON.stringify({
    round: req.round,
    resume: req.resume,
    transcript: req.transcript,
    emotion: wireEmotion(req.emotion),
    code: req.code,
  });
}

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
  const isFollowUp = req.transcript.some((t) => t.role === 'interviewer');
  try {
    const res = await authedFetch('/api/interview/next', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: requestBody(req),
      signal,
    });

    // A 429 body is `{ error, retryAfter }`, not a question. Parsing it as one
    // would hand the caller an empty message with no indication why.
    const retryAfter = retryAfterSeconds(res);
    if (retryAfter !== null) {
      logger.warn(`[interview] rate limited; retry in ${retryAfter}s`);
      return { message: '', round: req.round, isFollowUp, degraded: true, retryAfter };
    }

    const data = (await res.json()) as NextQuestionResult;
    return {
      message: (data.message || '').trim(),
      round: data.round || req.round,
      isFollowUp: Boolean(data.isFollowUp),
      degraded: data.degraded,
    };
  } catch (err) {
    logger.error('[interview] fetchNextQuestion failed', (err as Error)?.message);
    return { message: '', round: req.round, isFollowUp, degraded: true };
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
      body: requestBody(req),
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return;
    logger.warn('[interview] stream connect failed, falling back to JSON');
    yield { done: await fetchNextQuestion(req, signal) };
    return;
  }

  // A rate limit is the one !ok that must NOT fall back to the JSON endpoint:
  // it is the same route and the same budget, so retrying spends a second
  // request to be told no again. Report it instead.
  const retryAfter = retryAfterSeconds(res);
  if (retryAfter !== null) {
    logger.warn(`[interview] rate limited; retry in ${retryAfter}s`);
    yield {
      done: {
        message: '',
        round: req.round,
        isFollowUp: req.transcript.some((t) => t.role === 'interviewer'),
        degraded: true,
        retryAfter,
      },
    };
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
