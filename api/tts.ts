import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from './_lib/auth';
import { enforce } from './_lib/rateLimit';
import { fail, ok, methodNotAllowed } from './_lib/respond';
import { serverConfig } from './_lib/config';

/**
 * Sarvam TTS proxy (current contract): { text, language_code, speaker, model }.
 * Sentence-level pipelining; bounded input; explicit degraded codes.
 */
const SARVAM_TTS_URL = 'https://api.sarvam.ai/text-to-speech/convert';
const MAX_CHARS = 2000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    return ok(res, { configured: !!process.env.SARVAM_API_KEY });
  }
  if (req.method !== 'POST') return methodNotAllowed(res, ['GET', 'POST']);

  const authedUser = await requireUser(req, res);
  if (!authedUser) return;
  if (!(await enforce(req, res, 'tts', authedUser.uid))) return;

  const cfg = serverConfig();
  const { text, languageCode } = (req.body || {}) as { text?: unknown; languageCode?: unknown };
  if (typeof text !== 'string' || !text.trim()) return fail(res, 'validation', 'text is required.');
  if (text.length > MAX_CHARS) return fail(res, 'payload_too_large', `Text is limited to ${MAX_CHARS} characters per request.`);
  if (!process.env.SARVAM_API_KEY) {
    return ok(res, { audio: null, degraded: true, code: 'unconfigured' });
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const r = await fetch(SARVAM_TTS_URL, {
      method: 'POST',
      headers: { 'api-subscription-key': process.env.SARVAM_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: text.slice(0, MAX_CHARS),
        language_code: typeof languageCode === 'string' ? languageCode : 'en-IN',
        speaker: cfg.sarvamTtsSpeaker,
        model: cfg.sarvamTtsModel,
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      if (r.status === 429) return fail(res, 'rate_limited', 'Speech synthesis is busy. Retrying shortly.', { retryable: true, retryAfterSeconds: 5 });
      return fail(res, 'upstream', 'Speech synthesis failed.', { retryable: r.status >= 500 });
    }
    const data = (await r.json()) as { audio?: string } | null;
    const audio = typeof data?.audio === 'string' ? data.audio : null;
    if (!audio) return fail(res, 'upstream', 'Speech synthesis returned no audio.', { retryable: true });
    return ok(res, { audio, sampleRate: 22050 });
  } catch {
    if (ctrl.signal.aborted) return fail(res, 'upstream', 'Speech synthesis timed out.', { retryable: true });
    return fail(res, 'upstream', 'Speech synthesis failed.', { retryable: true });
  } finally {
    clearTimeout(timer);
  }
}
