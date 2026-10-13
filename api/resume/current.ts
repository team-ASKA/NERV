import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from '../_lib/auth';
import { enforce } from '../_lib/rateLimit';
import { fail, ok, methodNotAllowed } from '../_lib/respond';
import { hasSupabase, admin } from '../_lib/supabaseAdmin';

/** GET /api/resume/current — current ready/reviewable resume with ID/hash. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const user = await requireUser(req, res);
  if (!user) return;
  if (!(await enforce(req, res, 'profileRead', user.uid))) return;
  if (!hasSupabase()) return fail(res, 'unavailable', 'Application data is not configured.');

  const db = admin();
  const { data: profile } = await db.from('profiles').select('current_resume_id').eq('user_id', user.uid).maybeSingle();
  const currentId = (profile as { current_resume_id?: string } | null)?.current_resume_id ?? null;

  const fetchById = async (id: string) =>
    db.from('resumes').select('id,content_hash,version,resume_data,updated_at').eq('id', id).eq('user_id', user.uid).maybeSingle();

  if (currentId) {
    const { data } = await fetchById(currentId);
    if (data) {
      const r = data as { id: string; content_hash: string; version: number; resume_data: Record<string, unknown> };
      return ok(res, { resume: { id: r.id, contentHash: r.content_hash, version: r.version, ...(r.resume_data ?? {}), reviewState: 'ready', warnings: [] } });
    }
  }
  const { data: latest } = await db
    .from('resumes')
    .select('id,content_hash,version,resume_data,updated_at')
    .eq('user_id', user.uid)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest) return ok(res, { resume: null });
  const r = latest as { id: string; content_hash: string; version: number; resume_data: Record<string, unknown> };
  return ok(res, { resume: { id: r.id, contentHash: r.content_hash, version: r.version, ...(r.resume_data ?? {}), reviewState: 'ready', warnings: [] } });
}
