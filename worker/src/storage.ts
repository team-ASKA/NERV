/**
 * Supabase Storage access.
 *
 * Uploads go browser → Storage directly, never through the API: a serverless
 * function has a hard request-body limit and would charge us bandwidth twice
 * for the privilege of being a relay. The worker is the only thing that reads
 * the bytes back.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { config, logger } from './config.js';

let client: SupabaseClient | null = null;

function storage(): SupabaseClient {
  if (client) return client;
  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to read uploads.');
  }
  client = createClient(config.supabaseUrl, config.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export interface DownloadedFile {
  bytes: Uint8Array;
  /** sha256 of what we actually received, not what the client claimed. */
  actualHash: string;
}

/**
 * Fetch an uploaded resume and hash it.
 *
 * The caller must compare `actualHash` against the hash the client supplied.
 * That claim drives both the idempotency key and the dedupe cache, so an
 * unverified hash would let one upload be filed under another document's
 * identity — a user could poison a hash they expect someone else to upload.
 */
export async function downloadResume(path: string): Promise<DownloadedFile> {
  const { data, error } = await storage().storage.from(config.resumeBucket).download(path);
  if (error) throw new Error(`Storage download failed for ${path}: ${error.message}`);
  if (!data) throw new Error(`Storage returned no data for ${path}.`);

  const bytes = new Uint8Array(await data.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error(`Uploaded file ${path} is empty.`);

  return { bytes, actualHash: sha256(bytes) };
}

/** Best-effort cleanup. A failure here must never fail an otherwise good job. */
export async function removeResume(path: string): Promise<void> {
  try {
    const { error } = await storage().storage.from(config.resumeBucket).remove([path]);
    if (error) logger.warn({ path, err: error.message }, 'could not remove uploaded pdf');
  } catch (err) {
    logger.warn({ path, err: (err as Error).message }, 'could not remove uploaded pdf');
  }
}

export async function pingStorage(): Promise<boolean> {
  try {
    const { error } = await storage().storage.from(config.resumeBucket).list('', { limit: 1 });
    return !error;
  } catch {
    return false;
  }
}
