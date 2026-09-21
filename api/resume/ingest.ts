import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from '../_lib/auth';
import { enqueueResumeIngest, hasQueue, resumeJobExists } from '../_lib/queue';
import { RESUME_BUCKET, admin, hasSupabase, resumePath } from '../_lib/supabaseAdmin';
import {
  idempotencyKey,
  isSha256Hex,
  validateUpload,
  type IngestResponse,
  type ResumeJobStatus,
} from '../../shared/ingestion';

/**
 * Claim an ingestion job for an already-uploaded PDF and push it to the queue.
 *
 * Idempotency is the whole point of this endpoint. A retry, a double-click, two
 * tabs, or a client that never saw our response must all converge on one job
 * and one parse. That is enforced in three layers:
 *
 *   1. `claim_resume_job` takes a per-user advisory lock and writes against a
 *      UNIQUE index, so concurrent pods cannot both create a row.
 *   2. The idempotency key is also the BullMQ job id, so Redis refuses a
 *      duplicate even if layer 1 were wrong.
 *   3. `resumeJobExists` heals the inverse failure — a row that says queued
 *      while Redis has nothing — which is otherwise unrecoverable.
 *
 * Extraction itself is deliberately not here. Rendering pages and calling a
 * vision model takes tens of seconds; a serverless function that tried it would
 * time out under load and take the upload down with it.
 */

/**
 * Filenames are display-only, so strip anything unprintable and bound the
 * length. Written as a code-point filter rather than a regex: a literal
 * control-character class is easy to corrupt in transit and hard to review.
 */
function cleanFilename(value: unknown): string {
  if (typeof value !== 'string') return 'resume.pdf';
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 32 && code !== 127) out += ch;
  }
  return out.trim().slice(0, 180) || 'resume.pdf';
}

interface ClaimRow {
  id: string;
  status: ResumeJobStatus;
  is_new: boolean;
  requeued: boolean;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireUser(req, res);
  if (!user) return;

  if (!hasSupabase()) {
    return res.status(503).json({ error: 'Resume storage is not configured on this deployment.' });
  }
  if (!hasQueue()) {
    return res.status(503).json({ error: 'The ingestion queue is not configured on this deployment.' });
  }

  const body = (req.body || {}) as Record<string, unknown>;
  const contentHash = typeof body.contentHash === 'string' ? body.contentHash.toLowerCase() : '';
  const byteSize = typeof body.byteSize === 'number' ? body.byteSize : NaN;
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType : '';
  const filename = cleanFilename(body.filename);

  if (!isSha256Hex(contentHash)) {
    return res.status(400).json({ error: 'A sha256 hash of the file is required.' });
  }
  const valid = validateUpload({ byteSize, mimeType });
  if (!valid.ok) {
    return res.status(400).json({ error: valid.error });
  }

  // The path is recomputed rather than trusted. A client that sends someone
  // else's path gets a 400, not their resume.
  const storagePath = resumePath(user.uid, contentHash);
  if (typeof body.storagePath === 'string' && body.storagePath !== storagePath) {
    return res.status(400).json({ error: 'That upload does not belong to this account.' });
  }

  const supabase = admin();

  try {
    // Confirm the object is actually there. Without this a mistimed client
    // burns three worker attempts and a minute of backoff discovering that the
    // upload never landed.
    const { data: objects, error: listError } = await supabase.storage
      .from(RESUME_BUCKET)
      .list(user.uid, { limit: 1, search: `${contentHash}.pdf` });

    if (listError) throw new Error(listError.message);
    if (!objects || objects.length === 0) {
      return res.status(409).json({ error: 'The upload has not finished. Please try again.' });
    }

    const key = idempotencyKey(user.uid, contentHash);

    const { data: claimed, error: claimError } = await supabase.rpc('claim_resume_job', {
      p_user_id: user.uid,
      p_idempotency_key: key,
      p_content_hash: contentHash,
    });

    if (claimError) throw new Error(claimError.message);

    const row = (Array.isArray(claimed) ? claimed[0] : claimed) as ClaimRow | undefined;
    if (!row?.id) throw new Error('The job ledger returned no row.');

    // Push only when there is something to push: a new job, a revived one, or a
    // queued row Redis has lost track of.
    const orphaned =
      row.status === 'queued' && !row.is_new && !row.requeued
        ? !(await resumeJobExists(key))
        : false;

    if (row.is_new || row.requeued || orphaned) {
      try {
        await enqueueResumeIngest(key, {
          jobId: row.id,
          userId: user.uid,
          contentHash,
          storagePath,
          filename,
          byteSize,
          mimeType,
        });
      } catch (err) {
        // Leaving the row queued would strand it: the next claim would report
        // it as neither new nor revived and nothing would push it again.
        // Marking it failed puts it back on the revive path.
        await supabase
          .from('resume_jobs')
          .update({
            status: 'failed',
            error: 'Could not reach the ingestion queue.',
            finished_at: new Date().toISOString(),
          })
          .eq('id', row.id);

        console.error('[resume/ingest] enqueue failed:', (err as Error)?.message);
        return res.status(503).json({ error: 'The ingestion queue is unavailable. Please try again.' });
      }
    }

    const response: IngestResponse = {
      jobId: row.id,
      status: row.requeued ? 'queued' : row.status,
      created: Boolean(row.is_new),
    };
    return res.status(row.is_new ? 202 : 200).json(response);
  } catch (err) {
    console.error('[resume/ingest] error:', (err as Error)?.message);
    return res.status(502).json({ error: 'Could not start processing. Please try again.' });
  }
}
