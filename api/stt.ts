import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from './_lib/auth';
import { enforce } from './_lib/rateLimit';
import { fail, ok, methodNotAllowed } from './_lib/respond';
import { serverConfig } from './_lib/config';

/**
 * Sarvam STT proxy. Bounded input (4.5MB base64 ≈ 90s mono 16k PCM), explicit
 * model config, classified errors. Provider failure is NEVER silence: the
 * client keeps the captured answer and offers retry/typed recovery.
 */

const SARVAM_STT_URL = 'https://api.sarvam.ai/speech-to-text';
const MAX_BASE64_CHARS = 6_000_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    return ok(res, { configured: !!process.env.SARVAM_API_KEY });
  }
  if (req.method !== 'POST') return methodNotAllowed(res, ['GET', 'POST']);

  const authedUser = await requireUser(req, res);
  if (!authedUser) return;
  if (!(await enforce(req, res, 'stt', authedUser.uid))) return;

  const cfg = serverConfig();
  const { audio, mimeType, languageCode } = (req.body || {}) as {
    audio?: unknown;
    mimeType?: unknown;
    languageCode?: unknown;
  };

  if (!process.env.SARVAM_API_KEY) {
    return ok(res, { transcript: '', degraded: true, code: 'unconfigured' });
  }
  if (typeof audio !== 'string' || !audio) return fail(res, 'validation', 'audio (base64 string) is required.');
  if (audio.length > MAX_BASE64_CHARS) {
    return fail(res, 'payload_too_large', 'That recording is too long. Keep answers under 90 seconds.');
  }
  if (typeof mimeType === 'string' && !/^(audio|video)\/[a-z0-9.+-]+$/i.test(mimeType)) {
    return fail(res, 'validation', 'Unsupported audio type.');
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const base64 = audio.includes(',') ? audio.split(',')[1]! : audio;
    const buf = Buffer.from(base64, 'base64');
    if (buf.length > 4_500_000) {
      return fail(res, 'payload_too_large', 'That recording is too long. Keep answers under 90 seconds.');
    }

    const form = new FormData();
    form.append('file', new Blob([buf], { type: typeof mimeType === 'string' ? mimeType : 'audio/wav' }), 'recording.wav');
    form.append('model', cfg.sarvamSttModel);
    form.append('language_code', typeof languageCode === 'string' ? languageCode : 'en-IN');

    const r = await fetch(SARVAM_STT_URL, {
      method: 'POST',
      headers: { 'api-subscription-key': process.env.SARVAM_API_KEY },
      body: form,
      signal: ctrl.signal,
    });

    if (!r.ok) {
      if (r.status === 429) return fail(res, 'rate_limited', 'Transcription is busy. Your answer is kept — retry shortly.', { retryable: true, retryAfterSeconds: 5 });
      return fail(res, 'upstream', 'Transcription failed. Your answer is kept — retry or type it.', { retryable: r.status >= 500 });
    }
    const data = (await r.json()) as { transcript?: unknown; text?: unknown } | null;
    const transcript = typeof data?.transcript === 'string' ? data.transcript : typeof data?.text === 'string' ? data.text : '';
    return ok(res, { transcript });
  } catch {
    if (ctrl.signal.aborted) return fail(res, 'upstream', 'Transcription timed out. Your answer is kept — retry or type it.', { retryable: true });
    return fail(res, 'upstream', 'Transcription failed. Your answer is kept — retry or type it.', { retryable: true });
  } finally {
    clearTimeout(timer);
  }
}
