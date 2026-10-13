/**
 * Central operational telemetry: correlation IDs, latency/cost/error counters,
 * redacted exception reports. Never logs transcript text, resumes, frames,
 * tokens, or PII.
 */

const counters = new Map<string, number>();
const latencies = new Map<string, number[]>();

export function count(name: string, by = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + by);
}

export function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  return fn().finally(() => {
    const arr = latencies.get(name) ?? [];
    arr.push(Date.now() - start);
    if (arr.length > 100) arr.shift();
    latencies.set(name, arr);
  });
}

export function reportException(scope: string, err: unknown, extra?: Record<string, string>): void {
  // Redacted by construction: message only, no bodies, no user content.
  const message = err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
  count(`error:${scope}`);
  if (process.env.NODE_ENV !== 'production') {
    console.error(`[${scope}]`, message, extra ?? {});
  } else {
    console.error(JSON.stringify({ scope, message, ...extra }));
  }
}

export function snapshot(): { counters: Record<string, number>; p50: Record<string, number> } {
  const p50: Record<string, number> = {};
  for (const [k, arr] of latencies) {
    const sorted = [...arr].sort((a, b) => a - b);
    p50[k] = sorted[Math.floor(sorted.length / 2)] ?? 0;
  }
  return { counters: Object.fromEntries(counters), p50 };
}
