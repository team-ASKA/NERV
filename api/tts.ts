import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from './_lib/auth';

/**
 * Sarvam Text-to-Speech proxy. Keeps SARVAM_API_KEY server-side.
 * Client sends JSON: { text, voice?, languageCode?, pace?, pitch?, loudness? }.
 * Returns: { audio: base64Wav, sampleRate } — or { audio: null, degraded: true }
 * when the key is absent, so the client can fall back to browser TTS.
 *
 * Designed for sentence-level pipelining: call once per sentence for low
 * time-to-first-audio.
 *
 * A GET is a warm-up ping: it wakes the function before the first sentence is
 * needed (a cold start would otherwise land on exactly that request) and
 * reports whether a key is configured, so the client can go straight to the
 * browser voice instead of paying a round trip per sentence to learn that.
 */

const SARVAM_TTS_URL = 'https://api.sarvam.ai/text-to-speech';
const SAMPLE_RATE = 24000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, configured: !!process.env.SARVAM_API_KEY });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Synthesis is billed per character, and this is called once per sentence, so
  // it is the cheapest endpoint to abuse in volume. Verification is a local
  // signature check against a cached cert, so it costs no round trip per
  // sentence. The GET warm-up stays open: it touches no provider.
  const authedUser = await requireUser(req, res);
  if (!authedUser) return;

  const apiKey = process.env.SARVAM_API_KEY;
  const { text, voice, languageCode, pace, pitch, loudness } = (req.body || {}) as {
    text?: string;
    voice?: string;
    languageCode?: string;
    pace?: number;
    pitch?: number;
    loudness?: number;
  };

  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text is required' });
  }
  if (!apiKey) {
    return res.status(200).json({ audio: null, degraded: true, error: 'TTS not configured' });
  }

  try {
    const r = await fetch(SARVAM_TTS_URL, {
      method: 'POST',
      headers: { 'api-subscription-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inputs: [text.slice(0, 2500)],
        target_language_code: languageCode || 'en-IN',
        speaker_voice: voice || 'amrit',
        pitch: pitch ?? 0,
        pace: pace ?? 1.1,
        loudness: loudness ?? 1.1,
        speech_sample_rate: SAMPLE_RATE,
      }),
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error('[tts] Sarvam error', r.status, detail.slice(0, 300));
      return res.status(r.status).json({ error: `Sarvam TTS ${r.status}`, detail: detail.slice(0, 300) });
    }

    const data = (await r.json()) as { audios?: unknown } | null;
    const audios = data?.audios;
    const audio = Array.isArray(audios) && audios.length > 0 ? (audios[0] as string) : null;
    if (!audio) {
      return res.status(502).json({ error: 'Sarvam TTS returned no audio' });
    }
    return res.status(200).json({ audio, sampleRate: SAMPLE_RATE });
  } catch (err) {
    console.error('[tts] proxy error:', (err as Error)?.message);
    return res.status(500).json({ error: 'TTS proxy failed', detail: (err as Error)?.message });
  }
}
