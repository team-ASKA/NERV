import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from './_lib/auth';
import { enforce } from './_lib/rateLimit';
import { fail, ok, methodNotAllowed } from './_lib/respond';
import { hasSupabase, admin } from './_lib/supabaseAdmin';

const ACTIONS = ['explain', 'quiz', 'flashcards', 'deep-dive'] as const;

/**
 * GET /api/training?reportId=&topicId=&action= — owned context for direct nav.
 * POST — create a scoped training session. PATCH — checkpoint conversation.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = await requireUser(req, res);
  if (!user) return;
  if (!hasSupabase()) return fail(res, 'unavailable', 'Application data is not configured.');
  const db = admin();

  if (req.method === 'GET') {
    if (!(await enforce(req, res, 'trainingRead', user.uid))) return;
    const topicId = typeof req.query.topicId === 'string' ? req.query.topicId : '';
    const action = typeof req.query.action === 'string' ? req.query.action : 'explain';
    const reportId = typeof req.query.reportId === 'string' ? req.query.reportId : null;
    if (!topicId) return fail(res, 'validation', 'topicId is required.');
    if (!(ACTIONS as readonly string[]).includes(action)) return fail(res, 'validation', 'Invalid action.');
    // Validate ownership of the source report when given; never leak via 403.
    if (reportId) {
      const { data } = await db.from('interviews').select('id').eq('id', reportId).eq('user_id', user.uid).maybeSingle();
      if (!data) return fail(res, 'not_found', 'That report was not found.');
    }
    return ok(res, { topicId, action, reportId, label: topicId.split(':').pop() ?? topicId });
  }

  if (req.method === 'POST') {
    if (!(await enforce(req, res, 'trainingWrite', user.uid))) return;
    const body = (req.body ?? {}) as { topicId?: unknown; topicLabel?: unknown; action?: unknown; reportId?: unknown; sessionId?: unknown };
    if (typeof body.topicId !== 'string' || !body.topicId) return fail(res, 'validation', 'topicId is required.');
    if (!(ACTIONS as readonly string[]).includes(body.action as string)) return fail(res, 'validation', 'Invalid action.');
    const { data, error } = await db
      .from('training_sessions')
      .insert({
        user_id: user.uid,
        report_id: typeof body.reportId === 'string' ? body.reportId : null,
        session_id: typeof body.sessionId === 'string' ? body.sessionId : null,
        topic_id: body.topicId,
        topic_label: typeof body.topicLabel === 'string' ? body.topicLabel.slice(0, 200) : body.topicId,
        action: body.action,
        conversation: [],
      })
      .select('id')
      .single();
    if (error || !data) return fail(res, 'upstream', 'Could not start practice.', { retryable: true });
    return ok(res, { trainingId: (data as { id: string }).id }, 201);
  }

  return methodNotAllowed(res, ['GET', 'POST']);
}
