import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Mints a short-lived Hume access token via OAuth2 client-credentials so the
 * browser never sees HUME_API_KEY / HUME_SECRET_KEY. The client uses the
 * returned token to open the expression-measurement stream.
 *
 * Returns { available:false } (200) when keys are absent — the client then
 * shows an honest "emotion unavailable" state rather than fabricating scores.
 */

const HUME_TOKEN_URL = 'https://api.hume.ai/oauth2-cc/token';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.HUME_API_KEY;
  const secretKey = process.env.HUME_SECRET_KEY;

  if (!apiKey || !secretKey) {
    return res.status(200).json({ available: false });
  }

  try {
    const basic = Buffer.from(`${apiKey}:${secretKey}`).toString('base64');
    const r = await fetch(HUME_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error('[emotion/token] Hume error', r.status, detail.slice(0, 200));
      return res.status(200).json({ available: false, error: `Hume ${r.status}` });
    }

    const data = await r.json();
    const accessToken: string | undefined = data?.access_token;
    if (!accessToken) {
      return res.status(200).json({ available: false, error: 'No access token returned' });
    }

    // Cache briefly at the edge; tokens live ~30 min but we keep the window small.
    res.setHeader('Cache-Control', 'private, max-age=600');
    return res.status(200).json({
      available: true,
      accessToken,
      tokenType: data?.token_type || 'Bearer',
      expiresIn: data?.expires_in ?? 1800,
    });
  } catch (err) {
    console.error('[emotion/token] error:', (err as Error)?.message);
    return res.status(200).json({ available: false, error: (err as Error)?.message });
  }
}
