import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from '../../_lib/auth';
import { admin, hasSupabase } from '../../_lib/supabaseAdmin';
import { nextPollDelay, type ExtractionStrategy, type JobStatusResponse, type ResumeJobStatus } from '../../../shared/ingestion';
import { coerceParsed, isEmptyParse } from '../../../shared/resumeParse';

/**
 * Poll one ingestion job.
 *
 * This is the hottest endpoint in the pipeline — every waiting tab hits it on a
 * timer — so it does exactly one round trip. `get_resume_job` joins the job to
 * its parsed resume server-side and is scoped by user id as well as job id, so
 * a guessed uuid returns nothing rather than somebody else's document.
 *
 * The response carries its own `pollAfterMs`. Letting the server set the
 * cadence means a queue backlog can be absorbed by slowing every client down,
 * rather than by scaling to meet a poll rate the clients chose.
 */

interface JobRow {
  id: string;
  status: ResumeJobStatus;
  strategy: string | null;
  word_count: number | null;
  page_count: number | null;
  attempts: number | null;
  error: string | null;
  resume_data: unknown;
  created_at: string;
  finished_at: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asStrategy(value: string | null): ExtractionStrategy | null {
  return value === 'pdf_text' || value === 'vlm' ? value : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireUser(req, res);
  if (!user) return;

  if (!hasSupabase()) {
    return res.status(503).json({ error: 'Resume storage is not configured on this deployment.' });
  }

  const raw = req.query.id;
  const jobId = Array.isArray(raw) ? raw[0] : raw;
  if (!jobId || !UUID.test(jobId)) {
    return res.status(400).json({ error: 'A valid job id is required.' });
  }

  try {
    const { data, error } = await admin().rpc('get_resume_job', {
      p_job_id: jobId,
      p_user_id: user.uid,
    });

    if (error) throw new Error(error.message);

    const row = (Array.isArray(data) ? data[0] : data) as JobRow | undefined;
    if (!row?.id) {
      return res.status(404).json({ error: 'No such job.' });
    }

    const elapsed = Date.now() - new Date(row.created_at).getTime();
    const parsed = row.status === 'done' && row.resume_data ? coerceParsed(row.resume_data) : null;

    const body: JobStatusResponse = {
      jobId: row.id,
      status: row.status,
      strategy: asStrategy(row.strategy),
      wordCount: row.word_count,
      pageCount: row.page_count,
      attempts: row.attempts ?? 0,
      error: row.error,
      // An empty parse is not a resume. Surfacing it as null keeps the client
      // from starting an interview grounded in nothing.
      resume: parsed && !isEmptyParse(parsed) ? parsed : null,
      createdAt: row.created_at,
      finishedAt: row.finished_at,
      pollAfterMs: nextPollDelay(row.status, Number.isFinite(elapsed) ? elapsed : 0),
    };

    // Never cached: the whole point is that the answer changes.
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(body);
  } catch (err) {
    console.error('[resume/job] error:', (err as Error)?.message);
    return res.status(502).json({ error: 'Could not read the job status.' });
  }
}
