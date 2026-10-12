import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from '../../_lib/auth';
import { enforce } from '../../_lib/rateLimit';
import { fail, ok, methodNotAllowed } from '../../_lib/respond';
import { hasSupabase, admin } from '../../_lib/supabaseAdmin';
import { reportBullId, reportDbKey } from '../../../shared/queueIds';
import { isUuid } from '../../../shared/api';

/**
 * POST /api/sessions/:id/finalize — complete once, queue exactly one report.
 * Idempotent: repeated calls return the same report location/status.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const user = await requireUser(req, res);
  if (!user) return;
  if (!(await enforce(req, res, 'sessionFinalize', user.uid))) return;
  if (!hasSupabase()) return fail(res, 'unavailable', 'Application data is not configured.');

  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (typeof id !== 'string' || !isUuid(id)) return fail(res, 'validation', 'Invalid session id.');

  const db = admin();
  const { data: sess } = await db.from('interview_sessions').select('*').eq('id', id).single();
  const s = sess as { user_id: string; status: string } | null;
  if (!s || s.user_id !== user.uid) return fail(res, 'not_found', 'That session was not found.');

  if (s.status === 'complete') {
    return ok(res, { reportUrl: `/reports/${id}`, status: 'pending' });
  }

  const { error: upErr } = await db
    .from('interview_sessions')
    .update({ status: 'complete', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'active')
    .select('id');
  if (upErr) return fail(res, 'upstream', 'Could not finalize that session.', { retryable: true });

  // One report job per session+version; outbox event drives the worker.
  const dbKey = reportDbKey(id, 1);
  const bullId = reportBullId(id, 1);
  await db.from('report_jobs').upsert(
    { session_id: id, user_id: user.uid, report_version: 1, status: 'queued' },
    { onConflict: 'session_id,report_version' },
  );
  await db.from('job_outbox').upsert(
    { kind: 'report', aggregate_id: id, business_key: dbKey, run_id: bullId, payload: { sessionId: id } },
    { onConflict: 'business_key' },
  );

  return ok(res, { reportUrl: `/reports/${id}`, status: 'pending' });
}
