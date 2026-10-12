import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from './_lib/auth';
import { enforce } from './_lib/rateLimit';
import { fail, ok, methodNotAllowed } from './_lib/respond';
import { hasSupabase, admin } from './_lib/supabaseAdmin';

/** Cursor-paginated compact history. Default 20, hard max 50. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const user = await requireUser(req, res);
  if (!user) return;
  if (!(await enforce(req, res, 'history', user.uid))) return;
  if (!hasSupabase()) return fail(res, 'unavailable', 'Application data is not configured.');

  const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20) || 20));
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null;

  const db = admin();
  let q = db
    .from('interviews')
    .select('id,session_id,report_status,total_duration_minutes,created_at')
    .eq('user_id', user.uid)
    .order('created_at', { ascending: false })
    .limit(limit + 1);
  if (cursor) q = q.lt('created_at', cursor);
  const { data, error } = await q;
  if (error) return fail(res, 'upstream', 'Could not load history.', { retryable: true });
  const rows = (data ?? []) as Array<{ id: string; created_at: string }>;
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  ok(res, {
    items,
    nextCursor: hasMore ? items[items.length - 1]!.created_at : null,
  });
}
