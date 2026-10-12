import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ok, methodNotAllowed } from './_lib/respond';
import { serverConfig } from './_lib/config';

/** Nonsecret capability booleans + reason codes. No credential details. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const cfg = serverConfig();
  const reasons: Record<string, string> = {};
  if (!cfg.supabaseUrl || !cfg.supabaseSecretKey) reasons.data = 'unconfigured-database';
  if (!process.env.GROQ_API_KEY && !process.env.GEMINI_API_KEY) reasons.interview = 'unconfigured-model';
  if (!process.env.SARVAM_API_KEY) reasons.voice = 'unconfigured-speech';
  if (!process.env.HUME_API_KEY) reasons.cloudExpression = 'unconfigured-or-no-consent';
  if (!cfg.redisUrl) reasons.queue = 'unconfigured-redis';
  ok(res, {
    auth: true,
    resume: !reasons.data && !reasons.queue ? true : Boolean(!reasons.data),
    interview: !reasons.interview,
    report: !reasons.data && !reasons.interview,
    voice: !reasons.voice,
    cloudExpression: false,
    demo: cfg.demoMode,
    reasons,
  });
}
