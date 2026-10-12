import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from '../_lib/auth';
import { enforce } from '../_lib/rateLimit';
import { fail, ok, methodNotAllowed } from '../_lib/respond';
import { hasSupabase, admin } from '../_lib/supabaseAdmin';

/** GET /api/reports/:sessionId — owned report + job status. Non-owned → 404. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const user = await requireUser(req, res);
  if (!user) return;
  if (!(await enforce(req, res, 'reportRead', user.uid))) return;
  if (!hasSupabase()) return fail(res, 'unavailable', 'Application data is not configured.');

  const sessionId = Array.isArray(req.query.sessionId) ? req.query.sessionId[0] : req.query.sessionId;
  if (typeof sessionId !== 'string') return fail(res, 'validation', 'Invalid report id.');

  const db = admin();
  const { data: row } = await db.from('interviews').select('*').eq('session_id', sessionId).eq('user_id', user.uid).maybeSingle();
  if (row) return ok(res, { report: row, jobStatus: 'ready' });

  // No report row yet: is the session ours, and is a job pending/failed?
  const { data: sess } = await db.from('interview_sessions').select('id,user_id,status').eq('id', sessionId).maybeSingle();
  const s = sess as { user_id: string; status: string } | null;
  if (!s || s.user_id !== user.uid) return fail(res, 'not_found', 'That report was not found.');
  const { data: job } = await db
    .from('report_jobs')
    .select('status,error_code')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const j = job as { status: string; error_code: string | null } | null;
  if (!j) return ok(res, { report: null, jobStatus: 'transcript_only' });
  return ok(res, { report: null, jobStatus: j.status, errorCode: j.error_code });
}
