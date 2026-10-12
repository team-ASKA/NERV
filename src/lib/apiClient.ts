/** Authenticated same-origin API client with the shared envelope. */
import { auth } from './firebase';
import { apiUrl, demoAllowed } from './config';
import { mockFetch } from '../fixtures/apiMocks';

export interface ApiError extends Error {
  code: string;
  status: number;
  retryable: boolean;
  retryAfterSeconds?: number;
}

export function toApiError(status: number, body: unknown): ApiError {
  const fallback: Record<number, [string, string, boolean]> = {
    400: ['validation', 'That request was invalid.', false],
    401: ['unauthorized', 'Sign in to continue.', false],
    404: ['not_found', 'That was not found.', false],
    409: ['conflict', 'That changed while you were working. Refresh and retry.', false],
    413: ['payload_too_large', 'That upload is too large.', false],
    429: ['rate_limited', 'Too many requests. Wait a moment and retry.', true],
    502: ['upstream', 'A provider request failed. Retry in a moment.', true],
    503: ['unavailable', 'That feature is unavailable right now.', true],
  };
  const rec = (body as { error?: { code?: string; message?: string; retryable?: boolean; retryAfterSeconds?: number } } | null)?.error;
  const [code, message, retryable] = fallback[status] ?? ['internal', 'Something went wrong.', status >= 500];
  const err = new Error(rec?.message || message) as ApiError;
  err.code = rec?.code || code;
  err.status = status;
  err.retryable = rec?.retryable ?? retryable;
  err.retryAfterSeconds = rec?.retryAfterSeconds;
  return err;
}

async function authHeaders(): Promise<Record<string, string>> {
  try {
    const token = await auth.currentUser?.getIdToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (demoAllowed()) {
    return mockFetch<T>(path, init);
  }
  const headers: Record<string, string> = {
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...((init.headers as Record<string, string> | undefined) ?? {}),
    ...(await authHeaders()),
  };
  const res = await fetch(apiUrl(path), { ...init, headers });
  const requestId = res.headers.get('x-request-id') ?? 'unknown';
  if (res.status === 204) return undefined as unknown as T;
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) throw toApiError(res.status, body);
  return (body as { data: T; requestId: string }).data ?? (body as T);
}

export async function apiFetchEnvelope<T>(path: string, init: RequestInit = {}): Promise<{ data: T; requestId: string }> {
  if (demoAllowed()) {
    const data = await mockFetch<T>(path, init);
    return { data, requestId: 'demo' };
  }
  const headers: Record<string, string> = {
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...((init.headers as Record<string, string> | undefined) ?? {}),
    ...(await authHeaders()),
  };
  const res = await fetch(apiUrl(path), { ...init, headers });
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    throw toApiError(res.status, body);
  }
  return (await res.json()) as { data: T; requestId: string };
}
