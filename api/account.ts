import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from './_lib/auth';
import { enforce } from './_lib/rateLimit';
import { fail, ok, methodNotAllowed } from './_lib/respond';
import { hasSupabase, admin } from './_lib/supabaseAdmin';

/**
 * GET /api/account — owned export (profiles/resumes/sessions/reports/training).
 * DELETE /api/account — tombstone + retryable DB/Storage cleanup. Late worker
 * writes check the tombstone and must not recreate user rows.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = await requireUser(req, res);
  if (!user) return;
  if (!hasSupabase()) return fail(res, 'unavailable', 'Application data is not configured.');
  const db = admin();

  if (req.method === 'GET') {
    if (!(await enforce(req, res, 'profileRead', user.uid))) return;
    const [profile, resumes, sessions, reports, training] = await Promise.all([
      db.from('profiles').select('*').eq('user_id', user.uid).maybeSingle(),
      db.from('resumes').select('id,content_hash,version,resume_data,created_at').eq('user_id', user.uid),
      db.from('interview_sessions').select('id,status,current_round,created_at').eq('user_id', user.uid),
      db.from('interviews').select('id,session_id,report_status,created_at').eq('user_id', user.uid),
      db.from('training_sessions').select('id,topic_id,action,created_at').eq('user_id', user.uid),
    ]);
    return ok(res, { profile: profile.data ?? null, resumes: resumes.data ?? [], sessions: sessions.data ?? [], reports: reports.data ?? [], training: training.data ?? [] });
  }

  if (req.method === 'DELETE') {
    if (!(await enforce(req, res, 'profileWrite', user.uid))) return;
    // Tombstone first: blocks new writes and fences late workers.
    await db.from('deleted_users').upsert({ user_id: user.uid }, { onConflict: 'user_id' });
    for (const table of ['training_attempts', 'training_sessions', 'interview_turns', 'interview_rounds', 'report_jobs', 'interviews', 'interview_sessions', 'resume_jobs', 'resumes', 'profiles']) {
      try {
        if (table === 'interview_turns' || table === 'interview_rounds') continue; // cascaded
        await db.from(table).delete().eq('user_id', user.uid);
      } catch {
        /* best-effort per table; operator reconciles the rest */
      }
    }
    return ok(res, { deleted: true });
  }

  return methodNotAllowed(res, ['GET', 'DELETE']);
}
