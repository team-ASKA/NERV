import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Sarvam Speech-to-Text proxy. Keeps SARVAM_API_KEY server-side.
 * Client sends JSON: { audio: base64, mimeType?, languageCode? }.
 * Returns: { transcript } — or { transcript: '', degraded: true } when the
 * key is absent, so the UI can flow without crashing.
 */

const SARVAM_STT_URL = 'https://api.sarvam.ai/speech-to-text';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.SARVAM_API_KEY;
  const { audio, mimeType, languageCode } = (req.body || {}) as {
    audio?: string;
    mimeType?: string;
    languageCode?: string;
  };

  if (!apiKey) {
    return res.status(200).json({ transcript: '', degraded: true, error: 'STT not configured' });
  }
  if (!audio || typeof audio !== 'string') {
    return res.status(400).json({ error: 'audio (base64 string) is required' });
  }

  try {
    const base64 = audio.includes(',') ? audio.split(',')[1] : audio;
    const buf = Buffer.from(base64, 'base64');

    const form = new FormData();
    form.append('file', new Blob([buf], { type: mimeType || 'audio/wav' }), 'recording.wav');
    form.append('model', 'saaras:v3');
    form.append('language_code', languageCode || 'en-IN');
    form.append('with_timestamps', 'false');
    form.append('with_diarization', 'false');

    const r = await fetch(SARVAM_STT_URL, {
      method: 'POST',
      headers: { 'api-subscription-key': apiKey },
      body: form,
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error('[stt] Sarvam error', r.status, detail.slice(0, 300));
      return res.status(r.status).json({ error: `Sarvam STT ${r.status}`, detail: detail.slice(0, 300) });
    }

    const data = await r.json();
    const transcript =
      typeof data?.transcript === 'string' ? data.transcript : typeof data?.text === 'string' ? data.text : '';
    return res.status(200).json({ transcript });
  } catch (err) {
    console.error('[stt] proxy error:', (err as Error)?.message);
    return res.status(500).json({ error: 'STT proxy failed', detail: (err as Error)?.message });
  }
}
