/** Shared response envelope: { data, requestId } / { error, requestId }. */
import type { VercelResponse } from '@vercel/node';
import { newRequestId, type ApiErrorCode } from '../../shared/api';

const STATUS: Record<ApiErrorCode, number> = {
  validation: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  rate_limited: 429,
  unavailable: 503,
  upstream: 502,
  internal: 500,
};

export function ok<T>(res: VercelResponse, data: T, status = 200): void {
  const requestId = newRequestId();
  res.setHeader('x-request-id', requestId);
  res.status(status).json({ data, requestId });
}

export function fail(
  res: VercelResponse,
  code: ApiErrorCode,
  message?: string,
  opts: { retryable?: boolean; retryAfterSeconds?: number } = {},
): void {
  const requestId = newRequestId();
  const retryable = opts.retryable ?? (code === 'rate_limited' || code === 'unavailable' || code === 'upstream');
  res.setHeader('x-request-id', requestId);
  res.setHeader('Cache-Control', 'no-store');
  if (code === 'rate_limited' && opts.retryAfterSeconds) {
    res.setHeader('Retry-After', String(opts.retryAfterSeconds));
  }
  res.status(STATUS[code]).json({
    error: { code, message: message ?? code, retryable, retryAfterSeconds: opts.retryAfterSeconds },
    requestId,
  });
}

export function methodNotAllowed(res: VercelResponse, allow: string[]): void {
  res.setHeader('Allow', allow.join(', '));
  fail(res, 'validation', `Use ${allow.join(' or ')}.`);
}
