import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from '../_lib/auth';
import { enforce } from '../_lib/rateLimit';
import { fail, ok, methodNotAllowed } from '../_lib/respond';
import { hasSupabase } from '../_lib/supabaseAdmin';
import { getSession } from '../_lib/sessions';

/** GET /api/sessions/:id — compact recoverable session. Ownership → 404. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const user = await requireUser(req, res);
  if (!user) return;
  if (!(await enforce(req, res, 'sessionRead', user.uid))) return;
  if (!hasSupabase()) return fail(res, 'unavailable', 'Application data is not configured.');
  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (typeof id !== 'string') return fail(res, 'validation', 'Invalid session id.');
  try {
    const session = await getSession(user.uid, id);
    if (!session) return fail(res, 'not_found', 'That session was not found.');
    return ok(res, { session });
  } catch {
    return fail(res, 'upstream', 'Could not load that session.', { retryable: true });
  }
}
