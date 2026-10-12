import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from './_lib/auth';
import { enforce } from './_lib/rateLimit';
import { fail, ok, methodNotAllowed } from './_lib/respond';
import { hasSupabase, admin } from './_lib/supabaseAdmin';

/** Composed minimal current-user view. Independent reads run in parallel. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const user = await requireUser(req, res);
  if (!user) return;
  if (!(await enforce(req, res, 'dashboard', user.uid))) return;
  if (!hasSupabase()) return fail(res, 'unavailable', 'Application data is not configured.');

  const errors: Record<string, string> = {};
  const db = admin();

  const [profile, resume, active, latest, recent] = await Promise.all([
    db.from('profiles').select('display_name,preferences,current_resume_id').eq('user_id', user.uid).maybeSingle(),
    db.from('resumes').select('id,resume_data,content_hash,version,updated_at').eq('user_id', user.uid).order('updated_at', { ascending: false }).limit(1).maybeSingle(),
    db.from('interview_sessions').select('id,status,current_round').eq('user_id', user.uid).in('status', ['active', 'paused']).order('updated_at', { ascending: false }).limit(1).maybeSingle(),
    db.from('interviews').select('id,session_id,report_status,created_at').eq('user_id', user.uid).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    db.from('interview_sessions').select('id,status,current_round,updated_at').eq('user_id', user.uid).order('updated_at', { ascending: false }).limit(3),
  ]);

  if (profile.error) errors.profile = 'unavailable';
  if (resume.error) errors.resume = 'unavailable';
  if (active.error) errors.session = 'unavailable';
  if (latest.error) errors.report = 'unavailable';

  const r = resume.data as { id: string; resume_data: { name?: string; skills?: string[] } | null } | null;
  ok(res, {
    profile: profile.data
      ? { displayName: (profile.data as { display_name?: string }).display_name ?? '', preferences: (profile.data as { preferences?: Record<string, unknown> }).preferences ?? {} }
      : null,
    currentResume: r
      ? { id: r.id, name: r.resume_data?.name ?? '', title: '', skills: r.resume_data?.skills ?? [], reviewState: 'ready', warnings: [] }
      : null,
    activeSession: active.data
      ? { id: (active.data as { id: string }).id, status: (active.data as { status: string }).status, currentRound: (active.data as { current_round: string }).current_round }
      : null,
    latestReport: latest.data
      ? { sessionId: ((latest.data as { session_id?: string }).session_id ?? (latest.data as { id: string }).id), status: (latest.data as { report_status?: string }).report_status ?? 'ready' }
      : null,
    recentSessions: ((recent.data ?? []) as Array<{ id: string; status: string; current_round: string; updated_at: string }>).map((s) => ({
      id: s.id, status: s.status, currentRound: s.current_round, updatedAt: s.updated_at,
    })),
    practiceSuggestion: null,
    errors,
  });
}
