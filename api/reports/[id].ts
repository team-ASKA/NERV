import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from '../_lib/auth';
import { enforce } from '../_lib/rateLimit';
import { fail, ok, methodNotAllowed } from '../_lib/respond';
import { hasSupabase, admin } from '../_lib/supabaseAdmin';

/**
 * DELETE /api/reports/:id — owned deletion. GET legacy rows by interview id.
 * Ownership errors return 404 so IDs are not enumerable.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = await requireUser(req, res);
  if (!user) return;
  if (!hasSupabase()) return fail(res, 'unavailable', 'Application data is not configured.');
  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (typeof id !== 'string') return fail(res, 'validation', 'Invalid report id.');

  const db = admin();
  if (req.method === 'GET') {
    if (!(await enforce(req, res, 'reportRead', user.uid))) return;
    const { data } = await db.from('interviews').select('*').eq('id', id).eq('user_id', user.uid).maybeSingle();
    if (!data) return fail(res, 'not_found', 'That report was not found.');
    return ok(res, { report: data, jobStatus: 'ready', legacy: true });
  }
  if (req.method === 'DELETE') {
    if (!(await enforce(req, res, 'reportDelete', user.uid))) return;
    const { data } = await db.from('interviews').delete().eq('id', id).eq('user_id', user.uid).select('id');
    if (!data || (Array.isArray(data) && data.length === 0)) {
      return fail(res, 'not_found', 'That report was not found.');
    }
    return ok(res, { deleted: true });
  }
  return methodNotAllowed(res, ['GET', 'DELETE']);
}
