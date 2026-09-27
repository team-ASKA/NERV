/**
 * Per-user rate limiting for the endpoints that cost money.
 *
 * `requireUser` closed the anonymous hole, but authentication alone does not
 * bound spend: one signed-in account can still drain the whole project's model
 * quota, and every candidate in the system shares that ceiling. A script
 * hammering `/api/interview/next` is not a security problem any more — it is an
 * availability problem for everyone else mid-interview.
 *
 * Three properties matter more than precision here:
 *
 *  - **It fails open.** No Redis, a Redis outage, or a slow round trip all mean
 *    "allow". A limiter that takes the product down under load, or that blocks
 *    every request before the env vars are filled in, is worse than no limiter.
 *  - **It is off the critical path.** One pipelined round trip, hard-capped at
 *    `CHECK_TIMEOUT_MS`. `/api/tts` is called once per sentence while the
 *    candidate waits to hear the question; the check must not be audible.
 *  - **It is per user, not per IP.** Every route is authenticated now, and a
 *    campus placement drive puts a whole cohort behind one NAT address.
 *
 * Counting is a fixed window: `INCR` a key that expires at the window's end.
 * That allows up to 2x the limit across a boundary, which is the accepted
 * trade-off — it costs one counter per user per window instead of a sorted set
 * of timestamps, and the limits below are set for quota protection, not for
 * precise fairness.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { hasRedis, redis } from './redis';

/** A budget: at most `limit` requests per `windowMs`. */
export interface Window {
  limit: number;
  windowMs: number;
}

/**
 * Most endpoints get two windows. A per-minute limit alone still permits tens of
 * thousands of calls a day from one account, so the hourly window is the one
 * that actually protects the bill; the per-minute window is what protects the
 * provider's account-wide rate limit from a burst.
 *
 * Limits are deliberately far above real use. A candidate answers a question
 * every 30-60 seconds; a resume is parsed once. Anything near these numbers is
 * a loop, not a person.
 */
export const LIMITS = {
  /** Streaming LLM, the most expensive call in the system. */
  interviewNext: [
    { limit: 20, windowMs: 60_000 },
    { limit: 300, windowMs: 3_600_000 },
  ],
  /** One long generation over the whole transcript. */
  summary: [
    { limit: 5, windowMs: 60_000 },
    { limit: 40, windowMs: 3_600_000 },
  ],
  /** Called once per sentence, so the natural burst is several per question. */
  tts: [
    { limit: 90, windowMs: 60_000 },
    { limit: 1_500, windowMs: 3_600_000 },
  ],
  /** Billed per second of audio; one call per answer. */
  stt: [
    { limit: 40, windowMs: 60_000 },
    { limit: 500, windowMs: 3_600_000 },
  ],
  tutor: [
    { limit: 20, windowMs: 60_000 },
    { limit: 200, windowMs: 3_600_000 },
  ],
  /** Fans out to one model call per resume chunk. */
  resumeParse: [
    { limit: 5, windowMs: 60_000 },
    { limit: 30, windowMs: 3_600_000 },
  ],
  /** Enqueues worker jobs, which cost VLM calls downstream. */
  resumeIngest: [
    { limit: 10, windowMs: 60_000 },
    { limit: 50, windowMs: 3_600_000 },
  ],
  /** Mints a storage credential. */
  uploadUrl: [
    { limit: 10, windowMs: 60_000 },
    { limit: 50, windowMs: 3_600_000 },
  ],
  /** Mints a working Hume credential. One per session is the real pattern. */
  emotionToken: [
    { limit: 10, windowMs: 60_000 },
    { limit: 60, windowMs: 3_600_000 },
  ],
  openers: [
    { limit: 15, windowMs: 60_000 },
    { limit: 150, windowMs: 3_600_000 },
  ],
  /**
   * Job status is polled from 700ms, backing off — roughly 85 requests in the
   * first minute per upload, doubled if the candidate has the dashboard open in
   * a second tab. So the ceiling clears the legitimate case with room to spare.
   * It reads one row and calls no provider; this limit exists only to stop a
   * runaway client loop, not to shape normal polling.
   */
  jobStatus: [{ limit: 240, windowMs: 60_000 }],
} as const satisfies Record<string, readonly Window[]>;

export type LimitName = keyof typeof LIMITS;

/**
 * Redis must not add measurable latency to a request that is already waiting on
 * a model. If the check has not come back by now, we allow and move on.
 */
const CHECK_TIMEOUT_MS = 150;

/**
 * `INCR` and set the expiry in one atomic step.
 *
 * Doing this as two commands has a real failure mode: if the process or the
 * connection dies between `INCR` and `EXPIRE`, the key never expires and the
 * user is locked out of that endpoint permanently. Returning the TTL as well
 * means `Retry-After` costs no extra round trip.
 *
 * Sent with EVAL rather than registered as a custom command, because ioredis
 * only types `defineCommand` methods on the client, not on a pipeline — and
 * these have to be pipelined to stay at one round trip. Redis caches the script
 * by digest either way; EVAL just re-sends the body, which is under 150 bytes.
 */
const TOUCH_WINDOW = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return {n, redis.call('PTTL', KEYS[1])}
`;

export interface Decision {
  allowed: boolean;
  /** The window that rejected, for the response headers. */
  limit: number;
  remaining: number;
  /** Seconds until the offending window resets. At least 1. */
  retryAfter: number;
}

const ALLOW: Decision = { allowed: true, limit: 0, remaining: 0, retryAfter: 0 };

/**
 * Count this request against every window for `name` and decide.
 *
 * All windows are incremented even when an earlier one has already rejected:
 * the counters have to stay consistent with each other, and it is a single
 * pipeline either way.
 */
export async function check(name: LimitName, uid: string): Promise<Decision> {
  if (!hasRedis()) return ALLOW;

  const windows = LIMITS[name] as readonly Window[];

  try {
    const pipeline = redis().pipeline();
    for (const w of windows) {
      // The window start is in the key, so a window rolls over by expiry *and*
      // by name — a clock skew between instances cannot resurrect an old count.
      const bucket = Math.floor(Date.now() / w.windowMs);
      pipeline.eval(TOUCH_WINDOW, 1, `rl:${name}:${uid}:${w.windowMs}:${bucket}`, String(w.windowMs));
    }

    const settled = await Promise.race([
      pipeline.exec(),
      new Promise<null>((resolve) => {
        const t = setTimeout(() => resolve(null), CHECK_TIMEOUT_MS);
        // Never hold a serverless invocation open on account of this timer.
        t.unref?.();
      }),
    ]);

    // Timed out, or the pipeline reported nothing: allow.
    if (!settled) return ALLOW;

    let worst: Decision | null = null;

    for (let i = 0; i < windows.length; i += 1) {
      const budget = windows[i];
      const entry = settled[i];
      if (!budget || !entry) continue;

      const [err, value] = entry;
      // One window erroring should not veto the request, and should not be read
      // as a rejection either.
      if (err || !Array.isArray(value)) continue;

      const count = Number(value[0]);
      const ttlMs = Number(value[1]);
      if (!Number.isFinite(count)) continue;

      const remaining = Math.max(0, budget.limit - count);
      if (count <= budget.limit) continue;

      // PTTL returns -1 for a key with no expiry and -2 if it vanished between
      // the INCR and the read; in both cases fall back to the full window
      // rather than telling the client to retry immediately.
      const resetMs = ttlMs > 0 ? ttlMs : budget.windowMs;
      const decision: Decision = {
        allowed: false,
        limit: budget.limit,
        remaining,
        retryAfter: Math.max(1, Math.ceil(resetMs / 1000)),
      };
      // Report the window with the longest wait — telling a user to retry in a
      // second when the hourly budget is gone just produces another rejection.
      if (!worst || decision.retryAfter > worst.retryAfter) worst = decision;
    }

    return worst ?? ALLOW;
  } catch (err) {
    // Includes an unset-at-runtime REDIS_URL and a connection in a failed state.
    console.error('[rateLimit] check failed, allowing:', (err as Error)?.message);
    return ALLOW;
  }
}

/**
 * Enforce a limit, responding 429 and returning false when it is exceeded.
 *
 * Handlers should call this straight after `requireUser` and before writing any
 * headers — `/api/interview/next` streams, and a 429 cannot be sent once the
 * SSE preamble is out.
 *
 *     if (!(await enforce(req, res, 'interviewNext', user.uid))) return;
 */
export async function enforce(
  _req: VercelRequest,
  res: VercelResponse,
  name: LimitName,
  uid: string,
): Promise<boolean> {
  const decision = await check(name, uid);
  if (decision.allowed) return true;

  // draft-ietf-httpapi-ratelimit-headers names, plus Retry-After, which is the
  // one every HTTP client already understands.
  res.setHeader('Retry-After', String(decision.retryAfter));
  res.setHeader('RateLimit-Limit', String(decision.limit));
  res.setHeader('RateLimit-Remaining', String(decision.remaining));
  res.setHeader('RateLimit-Reset', String(decision.retryAfter));
  res.status(429).json({
    error: 'You are going a little fast for us. Give it a moment and try again.',
    retryAfter: decision.retryAfter,
  });
  return false;
}
