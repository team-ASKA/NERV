import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from '../_lib/auth';
import { admin, hasSupabase } from '../_lib/supabaseAdmin';
import { ROUNDS } from '../../shared/interview';
import type { PrimedOpeners } from '../../shared/simulation';

/**
 * Primed opening questions for this candidate's resume.
 *
 * The worker writes these ahead of time — one model call per round, run right
 * after the resume is ingested — so the first question of an interview costs no
 * model time at all. That turn is the one the candidate waits on with nothing to
 * look at, which makes it the single worst latency in the product.
 *
 * Deliberately *not* folded into `/api/interview/next`: that endpoint is on the
 * hot path of every turn, and giving it a database read would tax all six turns
 * to save one. This is called once, while the candidate is reading the round
 * intro, and a miss is free — the round just streams question one as before.
 *
 * `get_primed_openers` filters to `purpose = 'prime'`, so the openers an audit
 * generates against a synthetic candidate can never be served to a real one.
 */

const HASH = /^[0-9a-f]{64}$/i;

function coerceOpeners(raw: unknown): PrimedOpeners {
  if (!raw || typeof raw !== 'object') return {};
  const source = raw as Record<string, unknown>;
  const openers: PrimedOpeners = {};
  for (const round of ROUNDS) {
    const value = source[round];
    if (typeof value === 'string' && value.trim()) openers[round] = value.trim();
  }
  return openers;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireUser(req, res);
  if (!user) return;

  // Priming is an optimisation, so every failure below answers 200 with nothing.
  // A round that cannot read its opener streams one live; a round that treats a
  // 503 as fatal would turn a cache miss into a broken interview.
  if (!hasSupabase()) {
    return res.status(200).json({ openers: {}, available: false });
  }

  const raw = req.query.hash;
  const hash = Array.isArray(raw) ? raw[0] : raw;
  if (hash && !HASH.test(hash)) {
    return res.status(400).json({ error: 'Invalid resume hash.' });
  }

  try {
    const { data, error } = await admin().rpc('get_primed_openers', {
      p_user_id: user.uid,
      // Omitted rather than null: the function's default resolves the user's
      // newest resume, which is the one the client reads its own copy from.
      ...(hash ? { p_content_hash: hash } : {}),
    });

    if (error) throw new Error(error.message);

    const openers = coerceOpeners(data);
    // Private and short: a resume re-upload replaces these, and the response is
    // scoped to one user's account.
    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.status(200).json({ openers, available: true });
  } catch (err) {
    console.error('[interview/openers] error:', (err as Error)?.message);
    return res.status(200).json({ openers: {}, available: false });
  }
}
