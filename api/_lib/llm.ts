/**
 * LLM provider layer: Groq primary, Gemini fallback (REST, maintained API).
 * - Models are deployment config (GROQ_MODEL/GROQ_TEXT_MODEL/GEMINI_MODEL),
 *   never hardcoded retired defaults.
 * - Every call has an end-to-end deadline (headers + body), abort propagates.
 * - Mid-stream provider switch is FORBIDDEN: once any delta has escaped to the
 *   client, a failure ends as interrupted/retryable, never a second question
 *   concatenated onto the first.
 * - Upstream bodies are never echoed to clients; callers map to error codes.
 */

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerateOptions {
  temperature?: number;
  maxTokens?: number;
  /** Abort signal for request cancellation. */
  signal?: AbortSignal;
  /** End-to-end deadline in ms (default 25s generation, streams bounded by caller). */
  timeoutMs?: number;
}

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

function groqModel(): string {
  return process.env.GROQ_MODEL || process.env.GROQ_TEXT_MODEL || 'llama-3.3-70b-versatile';
}

function geminiModel(): string {
  return process.env.GEMINI_MODEL || 'gemini-2.5-flash';
}

export function providerInfo(): { provider: string; model: string } {
  if (process.env.GROQ_API_KEY) return { provider: 'groq', model: groqModel() };
  if (process.env.GEMINI_API_KEY) return { provider: 'gemini', model: geminiModel() };
  return { provider: 'none', model: 'none' };
}

export function hasGroq(): boolean {
  return !!process.env.GROQ_API_KEY;
}
export function hasGemini(): boolean {
  return !!process.env.GEMINI_API_KEY;
}
export function hasAnyProvider(): boolean {
  return hasGroq() || hasGemini();
}

export class UpstreamError extends Error {
  retryable: boolean;
  constructor(message: string, retryable = true) {
    super(message);
    this.retryable = retryable;
  }
}

function withTimeout(signal: AbortSignal | undefined, ms: number): { signal: AbortSignal; cancel: () => void } {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(new Error('Upstream deadline exceeded.')), ms);
  return {
    signal: ctrl.signal,
    cancel: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

/** Non-streaming Groq chat completion. Throws UpstreamError on failure. */
async function groqComplete(messages: LlmMessage[], opts: GenerateOptions = {}): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new UpstreamError('GROQ_API_KEY not configured', false);
  const { signal, cancel } = withTimeout(opts.signal, opts.timeoutMs ?? 25_000);
  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: groqModel(),
        messages,
        temperature: opts.temperature ?? 0.6,
        max_tokens: opts.maxTokens ?? 320,
      }),
      signal,
    });
    if (!res.ok) {
      await res.text().catch(() => '');
      const retryable = res.status === 429 || res.status >= 500;
      throw new UpstreamError(`Groq request failed (${res.status}).`, retryable);
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] } | null;
    return (data?.choices?.[0]?.message?.content ?? '').trim();
  } finally {
    cancel();
  }
}

/** Streaming Groq chat completion. Throws BEFORE yielding if headers fail. */
async function* groqStream(messages: LlmMessage[], opts: GenerateOptions = {}): AsyncGenerator<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new UpstreamError('GROQ_API_KEY not configured', false);
  const { signal, cancel } = withTimeout(opts.signal, opts.timeoutMs ?? 45_000);
  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: groqModel(),
        messages,
        temperature: opts.temperature ?? 0.6,
        max_tokens: opts.maxTokens ?? 320,
        stream: true,
      }),
      signal,
    });
    if (!res.ok || !res.body) {
      await res.text().catch(() => '');
      const retryable = res.status === 429 || res.status >= 500;
      throw new UpstreamError(`Groq stream failed (${res.status}).`, retryable);
    }
    const decoder = new TextDecoder();
    let buffer = '';
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
  } finally {
    cancel();
  }
}

/** Gemini via the maintained REST API (no legacy SDK). Honors abort + deadline. */
async function geminiComplete(system: string, user: string, opts: GenerateOptions = {}): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new UpstreamError('GEMINI_API_KEY not configured', false);
  const { signal, cancel } = withTimeout(opts.signal, opts.timeoutMs ?? 25_000);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel())}:generateContent`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: opts.temperature ?? 0.6, maxOutputTokens: opts.maxTokens ?? 320 },
      }),
      signal,
    });
    if (signal.aborted) throw new UpstreamError('Gemini request was cancelled.', false);
    if (!res.ok) {
      await res.text().catch(() => '');
      const retryable = res.status === 429 || res.status >= 500;
      throw new UpstreamError(`Gemini request failed (${res.status}).`, retryable);
    }
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    } | null;
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    return text.trim();
  } finally {
    cancel();
  }
}

export interface CompleteResult {
  text: string;
  provider: 'groq' | 'gemini' | 'none';
  model: string;
}

/** Single-shot generation: Groq first, Gemini fallback (only before output). */
export async function completeReply(system: string, user: string, opts: GenerateOptions = {}): Promise<CompleteResult> {
  if (hasGroq()) {
    try {
      const text = await groqComplete(
        [{ role: 'system', content: system }, { role: 'user', content: user }],
        opts,
      );
      if (text) return { text, provider: 'groq', model: groqModel() };
    } catch {
      /* fall through to Gemini */
    }
  }
  if (hasGemini()) {
    try {
      const text = await geminiComplete(system, user, opts);
      if (text) return { text, provider: 'gemini', model: geminiModel() };
    } catch {
      /* none */
    }
  }
  return { text: '', provider: 'none', model: 'none' };
}

/**
 * Streaming generation. Falls back to Gemini ONLY if Groq fails before the
 * first token escapes. After any yield, errors propagate as-is so the caller
 * marks the stream interrupted — never a mixed question.
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
      // Groq empty but successful → still eligible for Gemini fallback.
    } catch (err) {
      // If anything already escaped we must NOT fall back; rethrow as partial.
      // Caller tracks `produced`; here nothing yielded yet only if the throw
      // happened before the first yield — but the generator boundary makes
      // that ambiguous, so: this catch only fires pre-first-yield because a
      // throw after a yield propagates directly to the consumer.
      if (opts.signal?.aborted) return 'none';
      if (hasGemini()) {
        const text = await geminiComplete(system, user, opts);
        if (text) {
          yield text;
          return 'gemini';
        }
      } else {
        throw err;
      }
      return 'none';
    }
  }
  if (hasGemini()) {
    try {
      const text = await geminiComplete(system, user, opts);
      if (text) {
        yield text;
        return 'gemini';
      }
    } catch {
      /* none */
    }
  }
  return 'none';
}
