import { describe, expect, it } from 'vitest';
import { emptyRounds, totalElapsedMs, formatEvent, type InterviewEvent } from './session';

describe('session contracts', () => {
  it('emptyRounds covers all three rounds', () => {
    const r = emptyRounds();
    expect(Object.keys(r).sort()).toEqual(['core', 'hr', 'technical']);
  });
  it('totalElapsedMs sums rounds', () => {
    const r = emptyRounds();
    r.technical.elapsedMs = 60_000;
    r.core.elapsedMs = 30_000;
    expect(totalElapsedMs({ rounds: r })).toBe(90_000);
  });
  it('SSE events serialize with exactly one terminal', () => {
    const events: InterviewEvent[] = [
      { type: 'start', requestId: 'r', questionId: 'q', promptVersion: 'v2' },
      { type: 'delta', questionId: 'q', seq: 0, text: 'Hello' },
      { type: 'complete', questionId: 'q', text: 'Hello?', revision: 1, provider: 'groq', model: 'm' },
    ];
    const terminals = events.filter((e) => e.type === 'complete' || e.type === 'error');
    expect(terminals).toHaveLength(1);
    expect(formatEvent(events[0]!)).toContain('event: message');
  });
});
