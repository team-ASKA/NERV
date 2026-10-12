import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from '../../_lib/auth';
import { enforce } from '../../_lib/rateLimit';
import { fail, ok, methodNotAllowed } from '../../_lib/respond';
import { hasSupabase, admin } from '../../_lib/supabaseAdmin';
import { isUuid } from '../../../shared/api';

/**
 * PATCH /api/sessions/:id/round — atomic CAS checkpoint.
 * Same turn UUID + same payload replays the ack; same UUID + different
 * payload → 409. Stale expectedRevision → 409, never last-write-wins.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH']);
  const user = await requireUser(req, res);
  if (!user) return;
  if (!(await enforce(req, res, 'sessionCheckpoint', user.uid))) return;
  if (!hasSupabase()) return fail(res, 'unavailable', 'Application data is not configured.');

  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (typeof id !== 'string' || !isUuid(id)) return fail(res, 'validation', 'Invalid session id.');
  const body = (req.body ?? {}) as {
    expectedRevision?: unknown;
    round?: unknown;
    appendTurns?: unknown;
    elapsedMs?: unknown;
    codeText?: unknown;
    codeLanguage?: unknown;
  };
  if (typeof body.expectedRevision !== 'number') return fail(res, 'validation', 'expectedRevision is required.');
  if (!['technical', 'core', 'hr'].includes(body.round as string)) return fail(res, 'validation', 'Invalid round.');
  if (!Array.isArray(body.appendTurns) || body.appendTurns.length > 10) {
    return fail(res, 'validation', 'appendTurns must list at most 10 turns.');
  }
  for (const t of body.appendTurns as Array<Record<string, unknown>>) {
    if (!isUuid(t.turnId as string)) return fail(res, 'validation', 'Each turn needs a UUID turnId.');
    if (t.role !== 'interviewer' && t.role !== 'candidate') return fail(res, 'validation', 'Invalid turn role.');
    if (typeof t.text !== 'string' || t.text.length > 20_000) return fail(res, 'validation', 'Turn text is too long.');
  }
  if (typeof body.elapsedMs !== 'number' || body.elapsedMs < 0 || body.elapsedMs > 3_600_000) {
    return fail(res, 'validation', 'Invalid elapsedMs.');
  }

  const db = admin();
  const { data: sess } = await db.from('interview_sessions').select('revision,user_id').eq('id', id).single();
  const s = sess as { revision: number; user_id: string } | null;
  if (!s || s.user_id !== user.uid) return fail(res, 'not_found', 'That session was not found.');
  if (s.revision !== body.expectedRevision) {
    return fail(res, 'conflict', 'That session changed in another tab. Reload to continue.');
  }

  for (const t of body.appendTurns as Array<{ turnId: string; text: string }>) {
    const { data: existing } = await db
      .from('interview_turns')
      .select('text')
      .eq('session_id', id)
      .eq('turn_uuid', t.turnId)
      .maybeSingle();
    if (existing && (existing as { text: string }).text !== t.text) {
      return fail(res, 'conflict', 'That answer was already saved with different content.');
    }
  }

  try {
    const { data, error } = await db.rpc('checkpoint_session', {
      p_session: id,
      p_owner: user.uid,
      p_expected: body.expectedRevision,
      p_round: body.round,
      p_elapsed: Math.round(body.elapsedMs as number),
      p_turns: JSON.stringify(body.appendTurns),
      p_code: typeof body.codeText === 'string' ? (body.codeText as string).slice(0, 50_000) : null,
      p_lang: typeof body.codeLanguage === 'string' ? (body.codeLanguage as string).slice(0, 40) : null,
    });
    if (error) {
      if (String(error.message).includes('revision_conflict')) {
        return fail(res, 'conflict', 'That session changed in another tab. Reload to continue.');
      }
      return fail(res, 'upstream', 'Could not save progress.', { retryable: true });
    }
    return ok(res, { revision: data as number });
  } catch {
    return fail(res, 'upstream', 'Could not save progress.', { retryable: true });
  }
}
