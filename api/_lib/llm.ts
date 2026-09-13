/**
 * LLM provider layer for NERV. Groq Llama-3.1 is primary (fast, matches the
 * product); Gemini is the fallback. Exposes one interface so handlers never
 * touch a provider directly. All keys are read from server-only env vars.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerateOptions {
  temperature?: number;
  maxTokens?: number;
  /** Abort signal for request cancellation. */
  signal?: AbortSignal;
}

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
const GEMINI_MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-flash-8b'];

export function hasGroq(): boolean {
  return !!process.env.GROQ_API_KEY;
}
export function hasGemini(): boolean {
  return !!process.env.GEMINI_API_KEY;
}
export function hasAnyProvider(): boolean {
  return hasGroq() || hasGemini();
}

/** Non-streaming Groq chat completion. Throws on error / missing key. */
async function groqComplete(messages: LlmMessage[], opts: GenerateOptions = {}): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not configured');

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages,
      temperature: opts.temperature ?? 0.6,
      max_tokens: opts.maxTokens ?? 320,
    }),
    signal: opts.signal,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Groq ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data?.choices?.[0]?.message?.content ?? '').trim();
}

/**
 * Streaming Groq chat completion. Yields content deltas as they arrive.
 * Throws before yielding anything if the request fails, so callers can
 * fall back cleanly.
 */
async function* groqStream(messages: LlmMessage[], opts: GenerateOptions = {}): AsyncGenerator<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not configured');

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages,
      temperature: opts.temperature ?? 0.6,
      max_tokens: opts.maxTokens ?? 320,
      stream: true,
    }),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    const detail = res.body ? await res.text().catch(() => '') : '';
    throw new Error(`Groq stream ${res.status}: ${detail.slice(0, 300)}`);
  }

  const decoder = new TextDecoder();
  let buffer = '';
  // res.body is a web ReadableStream (async-iterable under Node 18+/undici).
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        const json = JSON.parse(payload);
        const delta: string = json?.choices?.[0]?.delta?.content ?? '';
        if (delta) yield delta;
      } catch {
        // Ignore keep-alive / partial lines.
      }
    }
  }
}

/** Gemini fallback with model cascade. Throws on error / missing key. */
async function geminiComplete(system: string, user: string, opts: GenerateOptions = {}): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const genAI = new GoogleGenerativeAI(apiKey);
  let lastError: unknown = null;
  for (const modelName of GEMINI_MODELS) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: system,
        generationConfig: {
          temperature: opts.temperature ?? 0.6,
          maxOutputTokens: opts.maxTokens ?? 320,
        },
      });
      const result = await model.generateContent(user);
      const text = result.response.text().trim();
      if (text) return text;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Gemini failed');
}

export interface CompleteResult {
  text: string;
  provider: 'groq' | 'gemini' | 'none';
}

/**
 * Single-shot generation: Groq first, Gemini fallback. Never throws — returns
 * `{ text: '', provider: 'none' }` when nothing is configured or all fail, so
 * the interview keeps flowing (the caller supplies a canned reply).
 */
export async function completeReply(system: string, user: string, opts: GenerateOptions = {}): Promise<CompleteResult> {
  if (hasGroq()) {
    try {
      const text = await groqComplete([{ role: 'system', content: system }, { role: 'user', content: user }], opts);
      if (text) return { text, provider: 'groq' };
    } catch (err) {
      console.warn('[llm] Groq failed, falling back to Gemini:', (err as Error)?.message);
    }
  }
  if (hasGemini()) {
    try {
      const text = await geminiComplete(system, user, opts);
      if (text) return { text, provider: 'gemini' };
    } catch (err) {
      console.error('[llm] Gemini fallback failed:', (err as Error)?.message);
    }
  }
  return { text: '', provider: 'none' };
}

/**
 * Streaming generation with fallback. Yields deltas from Groq; if Groq fails
 * before producing any token, it falls back to Gemini and yields the whole
 * reply as one delta. Yields nothing when no provider is configured.
 * Returns the provider actually used.
 */
export async function* streamReply(
  system: string,
  user: string,
  opts: GenerateOptions = {},
): AsyncGenerator<string, 'groq' | 'gemini' | 'none'> {
  if (hasGroq()) {
    try {
      let produced = false;
      for await (const delta of groqStream(
        [{ role: 'system', content: system }, { role: 'user', content: user }],
        opts,
      )) {
        produced = true;
        yield delta;
      }
      if (produced) return 'groq';
    } catch (err) {
      console.warn('[llm] Groq stream failed, falling back to Gemini:', (err as Error)?.message);
    }
  }
  if (hasGemini()) {
    try {
      const text = await geminiComplete(system, user, opts);
      if (text) {
        yield text;
        return 'gemini';
      }
    } catch (err) {
      console.error('[llm] Gemini fallback failed:', (err as Error)?.message);
    }
  }
  return 'none';
}
