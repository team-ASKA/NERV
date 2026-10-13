import { describe, expect, it } from 'vitest';
import { bullJobId, reportBullId, resumeBullId, simBullId } from './queueIds';

describe('safe BullMQ IDs', () => {
  it('contains no colons', () => {
    for (const id of [resumeBullId('u1', 'a'.repeat(64)), reportBullId('session', 1), simBullId('s', 'r', 'technical'), bullJobId('resume:u:h')]) {
      expect(id).not.toContain(':');
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
  it('is deterministic and distinct', () => {
    expect(resumeBullId('u', 'h')).toBe(resumeBullId('u', 'h'));
    expect(resumeBullId('u', 'h')).not.toBe(resumeBullId('u', 'g'));
  });
});
