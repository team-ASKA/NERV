/**
 * Server-side Supabase client for the API routes.
 *
 * Uses the service-role key, which is why this file can only ever be imported
 * from `api/` — it must never reach a bundle the browser downloads. Reads and
 * writes here are already scoped by the verified uid from `_lib/auth`, so
 * bypassing RLS is deliberate rather than accidental.
 *
 * The API talks to Postgres through PostgREST rather than a direct connection:
 * serverless instances scale out faster than a Postgres connection limit can
 * absorb, and a few hundred concurrent uploads holding sockets is the classic
 * way to take the database down. The worker, which is a fixed set of
 * long-lived processes, uses `pg` directly.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const RESUME_BUCKET = process.env.RESUME_BUCKET ?? 'resumes';

let client: SupabaseClient | null = null;

export function hasSupabase(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function admin(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set on the server.');
  }
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

/**
 * Storage path for an upload. Derived from the verified uid and the content
 * hash — never from client input — so a caller cannot write outside their own
 * prefix or overwrite another user's object.
 */
export function resumePath(uid: string, contentHash: string): string {
  return `${uid}/${contentHash}.pdf`;
}
