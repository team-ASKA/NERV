/** Deterministic demo fixtures. Synthetic content only — no real PII. */
import type { InterviewSession } from '../../shared/session';
import { emptyRounds } from '../../shared/session';

export const demoResume = {
  id: 'demo-resume-1',
  contentHash: 'demo-hash',
  name: 'Aarav Demo',
  title: 'Frontend Developer',
  skills: ['React', 'TypeScript', 'Node.js', 'Postgres', 'Docker', 'Testing'],
  projects: [
    { id: 'project-0', label: 'Realtime dashboard', text: 'Built a realtime dashboard with React and websockets.' },
    { id: 'project-1', label: 'Design system', text: 'Shipped a small accessible component library.' },
  ],
  experience: [{ id: 'experience-0', label: 'Frontend intern, Demo Labs', text: 'Prototype work and bug fixes.' }],
  education: ['B.Tech, Computer Science (demo)'],
  achievements: ['Campus hackathon finalist (demo)'],
  reviewState: 'ready' as const,
  warnings: [] as string[],
};

export const demoSession: InterviewSession = {
  id: '00000000-0000-4000-8000-000000000001',
  status: 'active',
  currentRound: 'technical',
  resume: {
    resumeId: demoResume.id,
    contentHash: demoResume.contentHash,
    extractedAt: new Date().toISOString(),
    name: demoResume.name,
    skills: demoResume.skills,
    projects: demoResume.projects.map((p) => p.label),
    experience: demoResume.experience.map((e) => e.label),
  },
  genericMode: false,
  durationMinutes: 10,
  inputMode: 'both',
  revision: 3,
  rounds: {
    ...emptyRounds(),
    technical: {
      round: 'technical',
      status: 'active',
      elapsedMs: 42_000,
      questionCount: 2,
      turns: [
        { turnId: 'q-demo-1', sequence: 1, role: 'interviewer', text: 'Walk me through how you structure a React feature.', status: 'complete', createdAt: new Date().toISOString() },
        { turnId: 'a-demo-1', sequence: 2, role: 'candidate', text: 'I start with the data flow, then split presentational and container pieces…', status: 'complete', createdAt: new Date().toISOString() },
        { turnId: 'q-demo-2', sequence: 3, role: 'interviewer', text: 'How do you handle async errors in that flow?', status: 'complete', createdAt: new Date().toISOString() },
      ],
      codeText: '// demo scratchpad\n',
      codeLanguage: 'typescript',
    },
  },
  promptVersion: 'demo-1',
  rubricVersion: 'demo-1',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export const demoReport = {
  sessionId: demoSession.id,
  status: 'ready' as const,
  summary: 'Demo report: clear structure on React data flow; async error handling is the next topic to practise.',
  nextStep: 'Practise async error boundaries with the quiz on React.',
  competencies: [
    { name: 'React structure', observation: 'Gave a coherent data-flow-first answer.', evidenceTurnIds: ['a-demo-1'] },
  ],
  quotes: [{ turnId: 'a-demo-1', round: 'technical' as const, quote: 'I start with the data flow' }],
  recommendations: ['Try the error-boundary deep dive next.'],
  unassessedTopics: ['Docker', 'Postgres'],
  expressionNotes: ['Expression observation unavailable in demo mode.'],
};

export type DashboardFixtureKind = 'no-resume' | 'ready' | 'active' | 'pending-report' | 'fetch-error';
