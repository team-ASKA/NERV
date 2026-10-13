import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from '../_lib/auth';
import { enforce } from '../_lib/rateLimit';
import { fail, ok, methodNotAllowed } from '../_lib/respond';
import { hasSupabase, admin } from '../_lib/supabaseAdmin';
import { isStringArray, isUuid } from '../../shared/api';

/**
 * PATCH /api/resume/:id — reviewed facts create a new version; the current
 * pointer switches atomically only after the revision validates.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH']);
  const user = await requireUser(req, res);
  if (!user) return;
  if (!(await enforce(req, res, 'resumeReview', user.uid))) return;
  if (!hasSupabase()) return fail(res, 'unavailable', 'Application data is not configured.');

  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (typeof id !== 'string' || !isUuid(id)) return fail(res, 'validation', 'Invalid resume id.');
  const body = (req.body ?? {}) as { name?: unknown; skills?: unknown; projects?: unknown; experience?: unknown; expectedVersion?: unknown };
  if (typeof body.expectedVersion !== 'number') return fail(res, 'validation', 'expectedVersion is required.');
  if (body.skills !== undefined && !isStringArray(body.skills, 100)) return fail(res, 'validation', 'Invalid skills.');
  if (body.projects !== undefined && !isStringArray(body.projects, 50)) return fail(res, 'validation', 'Invalid projects.');

  const db = admin();
  const { data: existing } = await db.from('resumes').select('id,version,user_id').eq('id', id).single();
  const cur = existing as { version: number; user_id: string } | null;
  if (!cur || cur.user_id !== user.uid) return fail(res, 'not_found', 'That resume was not found.');
  if (cur.version !== body.expectedVersion) {
    return fail(res, 'conflict', 'That resume changed in another tab. Reload to review the latest version.');
  }

  const patch: Record<string, unknown> = { version: cur.version + 1, updated_at: new Date().toISOString() };
  const { data: full } = await db.from('resumes').select('resume_data').eq('id', id).single();
  const resumeData = { ...((full as { resume_data?: Record<string, unknown> } | null)?.resume_data ?? {}) };
  if (typeof body.name === 'string') resumeData.name = body.name.slice(0, 200);
  if (body.skills !== undefined) resumeData.skills = body.skills;
  if (body.projects !== undefined) resumeData.projects = body.projects;
  if (body.experience !== undefined && isStringArray(body.experience, 50)) resumeData.experience = body.experience;
  patch.resume_data = resumeData;

  const { error } = await db.from('resumes').update(patch).eq('id', id).eq('version', body.expectedVersion);
  if (error) return fail(res, 'conflict', 'That resume changed in another tab. Reload to review the latest version.');
  await db.from('profiles').update({ current_resume_id: id }).eq('user_id', user.uid);
  return ok(res, { id, version: cur.version + 1 });
}
