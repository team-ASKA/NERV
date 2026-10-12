/** Dev-only mocked API responses. Rejected by production build rules. */
import { demoReport, demoResume, demoSession } from './demo';

function ok<T>(data: T): { data: T; requestId: string } {
  return { data, requestId: 'demo' };
}

export async function mockFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const url = new URL(path, 'http://demo.local');
  const p = url.pathname;

  if (p === '/api/capabilities') {
    return ok({ demo: true, auth: 'mock', resume: true, interview: true, report: true, voice: false, cloudExpression: false, reasons: { voice: 'demo-no-mic' } }) as unknown as T;
  }
  if (p === '/api/dashboard') {
    return ok({
      profile: { displayName: 'Demo User', preferences: { durationMinutes: 10, inputMode: 'both' } },
      currentResume: demoResume,
      activeSession: { id: demoSession.id, status: 'active', currentRound: 'technical' },
      latestReport: null,
      recentSessions: [{ id: demoSession.id, status: 'active', currentRound: 'technical', updatedAt: new Date().toISOString() }],
      practiceSuggestion: { topicId: 'skill:demo:react', label: 'React', reason: 'Discussed once — try the quiz.' },
      errors: {},
    }) as unknown as T;
  }
  if (p === '/api/profile' && method === 'GET') {
    return ok({ displayName: 'Demo User', preferences: {} }) as unknown as T;
  }
  if (p === '/api/resume/current') {
    return ok({ resume: demoResume }) as unknown as T;
  }
  if (p === '/api/history') {
    return ok({ items: [], nextCursor: null }) as unknown as T;
  }
  if (p.startsWith('/api/sessions/') && method === 'GET') {
    return ok({ session: demoSession }) as unknown as T;
  }
  if (p === '/api/sessions' && method === 'POST') {
    return ok({ session: demoSession }) as unknown as T;
  }
  if (p.startsWith('/api/reports/')) {
    return ok({ report: demoReport, jobStatus: 'ready' }) as unknown as T;
  }
  if (p.startsWith('/api/training')) {
    return ok({ messages: [{ role: 'tutor', text: 'Demo tutor reply. Real tutoring needs configuration.' }] }) as unknown as T;
  }
  if (p === '/api/tutor') {
    return ok({ text: 'Demo tutor reply. Configure providers for live tutoring.', exercises: null }) as unknown as T;
  }
  throw Object.assign(new Error(`Demo has no mock for ${method} ${p}.`), { code: 'unavailable', status: 503, retryable: false });
}
