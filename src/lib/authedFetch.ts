/**
 * Authenticated fetch for the `/api/*` routes that act on a user's data.
 *
 * The server derives the user from this token and ignores any id in the body,
 * so the browser cannot act on another account. Firebase ID tokens last an
 * hour, which an interview session can outlive — hence the single retry on a
 * 401 with a force-refreshed token.
 */

import { auth } from './firebase';

export async function idToken(forceRefresh = false): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken(forceRefresh);
  } catch {
    return null;
  }
}

/**
 * `init.body` must be replayable (a string or a Blob, not a stream) — the retry
 * re-sends it. Every caller here sends JSON, which is fine.
 */
export async function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await idToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(url, { ...init, headers });
  if (response.status !== 401) return response;

  const refreshed = await idToken(true);
  if (!refreshed || refreshed === token) return response;

  headers.set('Authorization', `Bearer ${refreshed}`);
  return fetch(url, { ...init, headers });
}

/** POST JSON with auth. Returns the parsed body and the response together. */
export async function postJson<T>(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  const response = await authedFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  let data: T;
  try {
    data = (await response.json()) as T;
  } catch {
    data = {} as T;
  }

  return { ok: response.ok, status: response.status, data };
}

/**
 * Seconds to wait if the server rate-limited this request, else null.
 *
 * Read from the header rather than the body so it costs nothing and, more
 * importantly, leaves the body unread — a caller that wants the error text can
 * still have it.
 *
 * Callers must not treat a 429 as a generic failure and retry immediately: the
 * retry counts against the same budget, so it makes the situation worse and
 * charges the user's quota twice for one refusal.
 */
export function retryAfterSeconds(response: Response): number | null {
  if (response.status !== 429) return null;
  const header = Number(response.headers.get('Retry-After'));
  return Number.isFinite(header) && header > 0 ? Math.ceil(header) : 30;
}
