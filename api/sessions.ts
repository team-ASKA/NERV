import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from './_lib/auth';
import { enforce } from './_lib/rateLimit';
import { fail, ok, methodNotAllowed } from './_lib/respond';
import { hasSupabase } from './_lib/supabaseAdmin';
import { createSession } from './_lib/sessions';
import { isUuid } from '../shared/api';
import type { InterviewSession } from '../shared/session';

/** POST /api/sessions — create an owned session pinned to a resume snapshot. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const user = await requireUser(req, res);
  if (!user) return;
  if (!(await enforce(req, res, 'sessionCreate', user.uid))) return;
  if (!hasSupabase()) return fail(res, 'unavailable', 'Application data is not configured.');

  const body = (req.body ?? {}) as {
    requestId?: unknown;
    resumeId?: unknown;
    genericMode?: unknown;
    durationMinutes?: unknown;
    inputMode?: unknown;
  };
  if (typeof body.requestId !== 'string' || !body.requestId) return fail(res, 'validation', 'requestId is required.');
  const durationMinutes = body.durationMinutes === 5 || body.durationMinutes === 15 ? body.durationMinutes : 10;
  const inputMode: InterviewSession['inputMode'] =
    body.inputMode === 'voice' || body.inputMode === 'text' ? body.inputMode : 'both';
  const genericMode = body.genericMode === true;

  let resume: InterviewSession['resume'] = null;
  if (!genericMode) {
    if (typeof body.resumeId !== 'string' || !isUuid(body.resumeId)) {
      return fail(res, 'validation', 'Choose a resume or start an explicit general interview.');
    }
    try {
      const { admin } = await import('./_lib/supabaseAdmin');
      const { data } = await admin()
        .from('resumes')
        .select('id,content_hash,resume_data')
        .eq('id', body.resumeId)
        .eq('user_id', user.uid)
        .single();
      if (!data) return fail(res, 'not_found', 'That resume was not found.');
      const r = data as { id: string; content_hash: string; resume_data: { name?: string; skills?: string[]; projects?: string[]; experience?: string[] } };
      resume = {
        resumeId: r.id,
        contentHash: r.content_hash ?? '',
        extractedAt: new Date().toISOString(),
        name: r.resume_data?.name ?? '',
        skills: r.resume_data?.skills ?? [],
        projects: r.resume_data?.projects ?? [],
        experience: r.resume_data?.experience ?? [],
      };
    } catch {
      return fail(res, 'upstream', 'Could not load that resume.', { retryable: true });
    }
  }

  try {
    const session = await createSession({ uid: user.uid, resume, genericMode, durationMinutes, inputMode });
    return ok(res, { session }, 201);
  } catch {
    return fail(res, 'upstream', 'Could not start a session.', { retryable: true });
  }
}
