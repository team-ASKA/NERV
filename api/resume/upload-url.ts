import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from '../_lib/auth';
import { RESUME_BUCKET, admin, hasSupabase, resumePath } from '../_lib/supabaseAdmin';
import { isSha256Hex, validateUpload } from '../../shared/ingestion';

/**
 * Mint a one-shot signed URL the browser uploads the PDF to directly.
 *
 * The file never passes through this function. A serverless body limit is a few
 * megabytes, and proxying uploads would mean paying for the same bytes twice —
 * in and out — on every single resume. At 10k users that is the difference
 * between a rounding error and a bandwidth bill.
 *
 * The object path is derived from the verified uid and the content hash, never
 * from the request, so a caller cannot write outside their own prefix or
 * clobber someone else's document. Content-addressing also makes re-uploading
 * the same resume free: the object is already there and we say so.
 */

const SIGNED_URL_TTL_SECONDS = 120;

interface UploadUrlRequest {
  contentHash?: unknown;
  byteSize?: unknown;
  mimeType?: unknown;
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

  const body = (req.body || {}) as UploadUrlRequest;
  const contentHash = typeof body.contentHash === 'string' ? body.contentHash.toLowerCase() : '';
  const byteSize = typeof body.byteSize === 'number' ? body.byteSize : NaN;
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType : '';

  if (!isSha256Hex(contentHash)) {
    return res.status(400).json({ error: 'A sha256 hash of the file is required.' });
  }
  const valid = validateUpload({ byteSize, mimeType });
  if (!valid.ok) {
    return res.status(400).json({ error: valid.error });
  }

  const storagePath = resumePath(user.uid, contentHash);
  const storage = admin().storage.from(RESUME_BUCKET);

  try {
    // Content-addressed: if these exact bytes are already stored, the client
    // skips straight to /api/resume/ingest.
    const { data: existing } = await storage.list(user.uid, {
      limit: 1,
      search: `${contentHash}.pdf`,
    });

    if (existing && existing.length > 0) {
      return res.status(200).json({ storagePath, alreadyUploaded: true });
    }

    // `upsert` covers the race where two tabs ask at the same moment; both
    // write identical bytes, so whoever lands second is harmless.
    const { data, error } = await storage.createSignedUploadUrl(storagePath, { upsert: true });
    if (error || !data) {
      throw new Error(error?.message ?? 'Storage did not return an upload URL.');
    }

    return res.status(200).json({
      storagePath,
      alreadyUploaded: false,
      signedUrl: data.signedUrl,
      token: data.token,
      expiresIn: SIGNED_URL_TTL_SECONDS,
    });
  } catch (err) {
    console.error('[resume/upload-url] error:', (err as Error)?.message);
    return res.status(502).json({ error: 'Could not prepare the upload. Please try again.' });
  }
}
