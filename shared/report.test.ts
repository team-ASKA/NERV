import { describe, expect, it } from 'vitest';
import { validateReport, quotesMatchTurns, type StructuredReport } from './report';

const base: StructuredReport = {
  schemaVersion: 1,
  sessionId: 's',
  status: 'ready',
  summary: 'Did well.',
  nextStep: 'Practise X.',
  roundObservations: [],
  competencies: [],
  quotes: [{ turnId: 't1', round: 'technical', quote: 'I start with the data flow' }],
  recommendations: [],
  unassessedTopics: [],
  expressionNotes: [],
  resumeSnapshotId: null,
  promptVersion: 'v2',
  model: 'm',
  provider: 'groq',
  generatedAt: new Date().toISOString(),
};

describe('report validation', () => {
  it('accepts a valid report', () => {
    expect(validateReport(base).ok).toBe(true);
  });
  it('rejects empty summary and empty quotes', () => {
    expect(validateReport({ ...base, summary: ' ' }).ok).toBe(false);
    expect(validateReport({ ...base, quotes: [{ turnId: 't1', round: 'technical', quote: ' ' }] }).ok).toBe(false);
  });
  it('quotes must match stored turns', () => {
    const texts = new Map([['t1', 'I start with the data flow and split components']]);
    expect(quotesMatchTurns(base, texts)).toBeNull();
    expect(quotesMatchTurns(base, new Map())).toContain('unknown turn');
    expect(quotesMatchTurns(base, new Map([['t1', 'something else entirely different here']])))
      .toContain('does not match');
  });
});
