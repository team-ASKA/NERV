/**
 * Model access for the worker: Groq primary (text + vision), Gemini as a text
 * fallback.
 *
 * Every call is rationed by a shared token bucket and retried with backoff that
 * honours `retry-after`. Retries are bounded and short — BullMQ is the outer
 * retry, so burning the job's whole stall budget in here just delays the
 * eventual re-queue.
 */

import { config, logger } from '../config.js';
import { TokenBucket } from './limiter.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

const bucket = new TokenBucket(config.llmRequestsPerMinute);

export class ModelUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelUnavailableError';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retryable: throttling and transient upstream failure. Nothing else. */
function isRetryable(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function backoffMs(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const seconds = Number.parseFloat(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 20_000);
  }
  // Jittered exponential: 500ms, 1s, 2s … so concurrent workers don't resync.
  const base = Math.min(500 * 2 ** attempt, 8_000);
  return base + Math.random() * 250;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Groq
// ---------------------------------------------------------------------------

type GroqContent = string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;

interface GroqMessage {
  role: 'system' | 'user' | 'assistant';
  content: GroqContent;
}

interface GroqOptions {
  model: string;
  messages: GroqMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Ask for a JSON object. Not supported alongside images on every model. */
  json?: boolean;
  timeoutMs?: number;
  attempts?: number;
}

async function groqChat(opts: GroqOptions): Promise<string> {
  if (!config.groqApiKey) throw new ModelUnavailableError('GROQ_API_KEY is not set.');

  const attempts = opts.attempts ?? 3;
  let lastError = 'unknown error';

  for (let attempt = 0; attempt < attempts; attempt++) {
    await bucket.acquire();

    let response: Response;
    try {
      response = await fetchWithTimeout(
        GROQ_URL,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.groqApiKey}`,
          },
          body: JSON.stringify({
            model: opts.model,
            messages: opts.messages,
            temperature: opts.temperature ?? 0.2,
            max_tokens: opts.maxTokens ?? 2048,
            ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
          }),
        },
        opts.timeoutMs ?? 60_000,
      );
    } catch (err) {
      // Abort or network failure — both worth one more try.
      lastError = (err as Error).name === 'AbortError' ? 'request timed out' : (err as Error).message;
      if (attempt === attempts - 1) break;
      await sleep(backoffMs(attempt, null));
      continue;
    }

    if (response.ok) {
      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = body.choices?.[0]?.message?.content;
      if (typeof content === 'string' && content.trim()) return content;
      lastError = 'model returned an empty completion';
      if (attempt === attempts - 1) break;
      await sleep(backoffMs(attempt, null));
      continue;
    }

    const detail = await response.text().catch(() => '');
    lastError = `groq ${response.status}: ${detail.slice(0, 300)}`;
    if (!isRetryable(response.status) || attempt === attempts - 1) break;

    const wait = backoffMs(attempt, response.headers.get('retry-after'));
    logger.warn({ status: response.status, attempt, wait }, 'groq retrying');
    await sleep(wait);
  }

  throw new ModelUnavailableError(lastError);
}

// ---------------------------------------------------------------------------
// Gemini (text fallback)
// ---------------------------------------------------------------------------

async function geminiText(
  prompt: string,
  system: string,
  opts: { timeoutMs?: number; temperature?: number; json?: boolean } = {},
): Promise<string> {
  if (!config.geminiApiKey) throw new ModelUnavailableError('GEMINI_API_KEY is not set.');
  await bucket.acquire();

  const response = await fetchWithTimeout(
    `${GEMINI_URL}/gemini-2.0-flash:generateContent?key=${config.geminiApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: opts.temperature ?? 0.2,
          ...(opts.json === false ? {} : { responseMimeType: 'application/json' }),
        },
      }),
    },
    opts.timeoutMs ?? 60_000,
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new ModelUnavailableError(`gemini ${response.status}: ${detail.slice(0, 300)}`);
  }

  const body = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const out = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!out.trim()) throw new ModelUnavailableError('gemini returned an empty completion');
  return out;
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * A JSON-producing completion. Groq first; on failure Gemini, so a single
 * provider outage degrades latency rather than breaking ingestion.
 */
export async function completeJson(system: string, prompt: string): Promise<string> {
  try {
    return await groqChat({
      model: config.groqTextModel,
      json: true,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    });
  } catch (err) {
    if (!config.geminiApiKey) throw err;
    logger.warn({ err: (err as Error).message }, 'groq failed, falling back to gemini');
    return geminiText(prompt, system);
  }
}

/**
 * Prose, not JSON. Used by the simulation agents, whose whole point is to
 * produce exactly what the live interviewer produces — a spoken line.
 *
 * Temperature defaults higher than `completeJson`'s: extraction wants the same
 * answer every time, whereas a simulation that asks the identical question on
 * every run stops being evidence about the prompt.
 */
export async function completeText(
  system: string,
  prompt: string,
  opts: { temperature?: number; maxTokens?: number; model?: string } = {},
): Promise<string> {
  try {
    return await groqChat({
      model: opts.model ?? config.groqTextModel,
      temperature: opts.temperature ?? 0.7,
      maxTokens: opts.maxTokens ?? 400,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    });
  } catch (err) {
    if (!config.geminiApiKey) throw err;
    logger.warn({ err: (err as Error).message }, 'groq failed, falling back to gemini');
    return geminiText(prompt, system, { json: false, temperature: opts.temperature ?? 0.7 });
  }
}

/**
 * Transcribe rendered pages with a vision model. Images go in one request so
 * the model sees the document as a whole and can carry a heading across a page
 * break.
 */
export async function completeVision(
  system: string,
  prompt: string,
  images: string[],
  maxTokens = 4096,
): Promise<string> {
  const content: GroqContent = [
    { type: 'text', text: prompt },
    ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
  ];

  return groqChat({
    model: config.groqVisionModel,
    maxTokens,
    // Vision requests carry megabytes of base64; give them room.
    timeoutMs: 120_000,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content },
    ],
  });
}

/**
 * Pull a JSON object out of a completion. Models wrap JSON in prose or fences
 * often enough that failing on it would be a self-inflicted outage.
 */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    // Fall through to brace matching.
  }

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

export function limiterDepth(): number {
  return bucket.queueDepth;
}
