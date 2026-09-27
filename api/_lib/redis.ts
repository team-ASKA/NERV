/**
 * The API's single Redis connection.
 *
 * Extracted from `queue.ts` because a second consumer appeared (rate limiting),
 * and a connection per feature does not scale: Vercel runs one instance per
 * concurrent request, managed Redis plans cap total connections in the low
 * hundreds, and the connection count is the first thing to break at 10k users —
 * long before throughput is a concern. One socket per warm instance, shared.
 *
 * Never closed. A serverless function is frozen the moment it responds, so
 * closing after each request would mean a TCP + AUTH round trip on every call,
 * which is most of the latency budget for the endpoints that use it.
 */

import IORedis from 'ioredis';

let connection: IORedis | null = null;

/** Whether Redis is configured at all. Callers degrade rather than throw. */
export function hasRedis(): boolean {
  return Boolean(process.env.REDIS_URL);
}

/**
 * The shared client. Throws if `REDIS_URL` is unset — guard with `hasRedis()`.
 *
 * The options are BullMQ's requirements, which are also the right ones for a
 * request-path client: BullMQ manages its own retries, and ioredis's default of
 * 20 makes blocking commands throw during a failover instead of waiting it out.
 */
export function redis(): IORedis {
  if (connection) return connection;

  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set on the server.');

  connection = new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    // Buffer commands issued before the socket is up, so the first request
    // after a cold start doesn't fail on a race with the handshake.
    enableOfflineQueue: true,
    // Fail fast rather than hanging: a client is waiting on this request, and a
    // queue outage should surface as a clear error, not a timeout.
    connectTimeout: 5_000,
    retryStrategy: (times) => (times > 3 ? null : Math.min(times * 150, 600)),
    ...(url.startsWith('rediss://') ? { tls: { rejectUnauthorized: true } } : {}),
  });

  connection.on('error', (err) => console.error('[redis] error:', err.message));
  return connection;
}
