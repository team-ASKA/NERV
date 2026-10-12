import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from './_lib/auth';
import { enforce } from './_lib/rateLimit';
import { fail, ok, methodNotAllowed } from './_lib/respond';
import { hasSupabase, admin } from './_lib/supabaseAdmin';
import { isRecord } from '../shared/api';

function validPreferences(p: unknown): p is Record<string, unknown> {
  if (!isRecord(p)) return false;
  if (p.durationMinutes !== undefined && ![5, 10, 15].includes(p.durationMinutes as number)) return false;
  if (p.inputMode !== undefined && !['voice', 'text', 'both'].includes(p.inputMode as string)) return false;
  return true;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = await requireUser(req, res);
  if (!user) return;
  if (!hasSupabase()) return fail(res, 'unavailable', 'Application data is not configured.');
  const db = admin();

  if (req.method === 'GET') {
    if (!(await enforce(req, res, 'profileRead', user.uid))) return;
    const { data } = await db.from('profiles').select('*').eq('user_id', user.uid).maybeSingle();
    if (!data) return ok(res, { displayName: '', preferences: {}, currentResumeId: null });
    const p = data as { display_name?: string; preferences?: Record<string, unknown>; current_resume_id?: string };
    return ok(res, { displayName: p.display_name ?? '', preferences: p.preferences ?? {}, currentResumeId: p.current_resume_id ?? null });
  }

  if (req.method === 'PATCH') {
    if (!(await enforce(req, res, 'profileWrite', user.uid))) return;
    const body = (req.body ?? {}) as { displayName?: unknown; preferences?: unknown };
    if (body.displayName !== undefined && (typeof body.displayName !== 'string' || body.displayName.length > 120)) {
      return fail(res, 'validation', 'Display name is too long.');
    }
    if (body.preferences !== undefined && !validPreferences(body.preferences)) {
      return fail(res, 'validation', 'Invalid preferences.');
    }
    // One idempotent init path: upsert by UID, never overwrite with blanks.
    const patch: Record<string, unknown> = { user_id: user.uid, updated_at: new Date().toISOString() };
    if (typeof body.displayName === 'string' && body.displayName.trim()) patch.display_name = body.displayName.trim().slice(0, 120);
    if (body.preferences !== undefined) patch.preferences = body.preferences;
    const { error } = await db.from('profiles').upsert(patch, { onConflict: 'user_id' });
    if (error) return fail(res, 'upstream', 'Could not save profile.', { retryable: true });
    return ok(res, { saved: true });
  }

  return methodNotAllowed(res, ['GET', 'PATCH']);
}
