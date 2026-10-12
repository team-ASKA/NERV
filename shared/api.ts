/**
 * Shared API envelope, error codes, and tiny runtime validation helpers.
 * Dependency-free and runtime-agnostic (browser + Vercel + worker).
 */

export type ApiErrorCode =
  | 'validation'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'payload_too_large'
  | 'rate_limited'
  | 'unavailable'
  | 'upstream'
  | 'internal';

export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
  retryable: boolean;
  retryAfterSeconds?: number;
}

export interface ApiSuccess<T> {
  data: T;
  requestId: string;
}

export interface ApiFailure {
  error: ApiErrorBody;
  requestId: string;
}

export function newRequestId(): string {
  try {
    const c = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch {
    /* fall through */
  }
  return `req-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export function errorMessage(code: ApiErrorCode): string {
  switch (code) {
    case 'validation':
      return 'That request was invalid. Check the highlighted fields and retry.';
    case 'unauthorized':
      return 'Sign in to continue.';
    case 'forbidden':
      return 'You do not have access to that.';
    case 'not_found':
      return 'That was not found.';
    case 'conflict':
      return 'That changed while you were working. Refresh and retry.';
    case 'payload_too_large':
      return 'That upload is too large.';
    case 'rate_limited':
      return 'Too many requests. Wait a moment and retry.';
    case 'unavailable':
      return 'That feature is unavailable right now.';
    case 'upstream':
      return 'A provider request failed. Retry in a moment.';
    default:
      return 'Something went wrong. Retry in a moment.';
  }
}

// --- minimal validators (no new deps) ---

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isNonEmptyString(v: unknown, max = 10_000): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max;
}

export function isUuid(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
  );
}

export function isStringArray(v: unknown, maxItems = 200, maxLen = 2_000): v is string[] {
  return (
    Array.isArray(v) &&
    v.length <= maxItems &&
    v.every((s) => typeof s === 'string' && s.length <= maxLen)
  );
}
