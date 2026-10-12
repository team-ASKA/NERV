import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from '../../_lib/auth';
import { enforce } from '../../_lib/rateLimit';
import { fail, ok, methodNotAllowed } from '../../_lib/respond';
import { hasSupabase, admin } from '../../_lib/supabaseAdmin';
import { reportDbKey } from '../../../shared/queueIds';

/** POST /api/reports/:sessionId/retry — new bounded attempt, no duplicate row. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const user = await requireUser(req, res);
  if (!user) return;
  if (!(await enforce(req, res, 'reportRetry', user.uid))) return;
  if (!hasSupabase()) return fail(res, 'unavailable', 'Application data is not configured.');
  const sessionId = Array.isArray(req.query.sessionId) ? req.query.sessionId[0] : req.query.sessionId;
  if (typeof sessionId !== 'string') return fail(res, 'validation', 'Invalid report id.');

  const db = admin();
  const { data: job } = await db
    .from('report_jobs')
    .select('id,status,report_version,user_id,attempt')
    .eq('session_id', sessionId)
    .order('report_version', { ascending: false })
    .limit(1)
    .maybeSingle();
  const j = job as { id: string; status: string; report_version: number; user_id: string; attempt: number } | null;
  if (!j || j.user_id !== user.uid) return fail(res, 'not_found', 'That report was not found.');
  if (j.status !== 'failed') return fail(res, 'conflict', 'Only failed reports can be retried.');
  if (j.attempt >= 3) return fail(res, 'conflict', 'That report has used all its retries.');

  const runId = crypto.randomUUID();
  await db.from('report_jobs').update({ status: 'queued', run_id: runId, attempt: j.attempt + 1 }).eq('id', j.id);
  const dbKey = reportDbKey(sessionId, j.report_version);
  await db.from('job_outbox').upsert(
    { kind: 'report', aggregate_id: sessionId, business_key: dbKey, run_id: runId, payload: { sessionId } },
    { onConflict: 'business_key' },
  );
  return ok(res, { status: 'queued' });
}
