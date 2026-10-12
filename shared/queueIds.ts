/**
 * Safe BullMQ job IDs (no colons) + stable DB idempotency keys.
 * BullMQ prohibits ':' in custom job IDs; DB keys keep the readable form.
 */

function hex(input: string): string {
  // FNV-1a 64-bit twice with different seeds → 128-bit hex. Dependency-free,
  // deterministic across browser/Node. Not cryptographic; only an ID mapping.
  let h1 = 0xcbf29ce484222325n;
  let h2 = 0x84222325cbf29ce4n;
  const mask = (1n << 64n) - 1n;
  for (let i = 0; i < input.length; i++) {
    const c = BigInt(input.charCodeAt(i));
    h1 = ((h1 ^ c) * 0x100000001b3n) & mask;
    h2 = ((h2 ^ (c + 0x9e37n)) * 0x100000001b3n) & mask;
  }
  return h1.toString(16).padStart(16, '0') + h2.toString(16).padStart(16, '0');
}

/** DB-level idempotency key (readable, may contain colons). */
export function dbIdempotencyKey(kind: string, ...parts: string[]): string {
  return [kind, ...parts].join(':');
}

/** BullMQ-safe job ID derived from the DB key (hex, hyphenated, no colons). */
export function bullJobId(dbKey: string): string {
  const h = hex(dbKey);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function resumeDbKey(userId: string, contentHash: string): string {
  return dbIdempotencyKey('resume', userId, contentHash);
}

export function resumeBullId(userId: string, contentHash: string): string {
  return bullJobId(resumeDbKey(userId, contentHash));
}

export function reportDbKey(sessionId: string, reportVersion: number): string {
  return dbIdempotencyKey('report', sessionId, `v${reportVersion}`);
}

export function reportBullId(sessionId: string, reportVersion: number): string {
  return bullJobId(reportDbKey(sessionId, reportVersion));
}

export function simBullId(simId: string, runId: string, round: string): string {
  return bullJobId(dbIdempotencyKey('sim', simId, runId, round));
}
