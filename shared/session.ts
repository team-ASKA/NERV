/**
 * Durable interview session contracts shared by browser + API + worker.
 */

export type SessionStatus = 'active' | 'paused' | 'complete' | 'abandoned';
export type RoundStatus = 'pending' | 'active' | 'complete';
export type RoundKind = 'technical' | 'core' | 'hr';
export type TurnRole = 'interviewer' | 'candidate';
export type TurnStatus = 'complete' | 'interrupted';

export const ROUND_ORDER: readonly RoundKind[] = ['technical', 'core', 'hr'];
export const SESSION_SCHEMA_VERSION = 1;
export const DEFAULT_ROUND_MINUTES = 10;
export const ALLOWED_DURATIONS = [5, 10, 15] as const;

export interface ResumeSnapshot {
  resumeId: string;
  contentHash: string;
  extractedAt: string;
  name: string;
  skills: string[];
  projects: string[];
  experience: string[];
}

export interface InterviewTurn {
  turnId: string;
  sequence: number;
  role: TurnRole;
  text: string;
  /** Server-kept delivered text when an interviewer turn was interrupted. */
  deliveredText?: string | null;
  questionId?: string | null;
  status: TurnStatus;
  createdAt: string;
  expressionNote?: string | null;
}

export interface RoundState {
  round: RoundKind;
  status: RoundStatus;
  elapsedMs: number;
  questionCount: number;
  turns: InterviewTurn[];
  codeText?: string | null;
  codeLanguage?: string | null;
}

export interface InterviewSession {
  id: string;
  status: SessionStatus;
  currentRound: RoundKind;
  resume: ResumeSnapshot | null;
  genericMode: boolean;
  durationMinutes: number;
  inputMode: 'voice' | 'text' | 'both';
  revision: number;
  rounds: Record<RoundKind, RoundState>;
  promptVersion: string;
  rubricVersion: string;
  createdAt: string;
  updatedAt: string;
}

export interface CheckpointInput {
  sessionId: string;
  expectedRevision: number;
  round: RoundKind;
  appendTurns: Array<{
    turnId: string;
    role: TurnRole;
    text: string;
    status?: TurnStatus;
    questionId?: string | null;
    deliveredText?: string | null;
  }>;
  elapsedMs: number;
  codeText?: string | null;
  codeLanguage?: string | null;
}

export type InterviewEvent =
  | { type: 'start'; requestId: string; questionId: string; promptVersion: string }
  | { type: 'delta'; questionId: string; seq: number; text: string }
  | { type: 'complete'; questionId: string; text: string; revision: number; provider: string; model: string }
  | { type: 'error'; questionId?: string; code: string; retryable: boolean; partial: boolean };

export function formatEvent(e: InterviewEvent): string {
  return `event: message\ndata: ${JSON.stringify(e)}\n\n`;
}

export function emptyRounds(): Record<RoundKind, RoundState> {
  const mk = (round: RoundKind): RoundState => ({
    round,
    status: 'pending',
    elapsedMs: 0,
    questionCount: 0,
    turns: [],
    codeText: null,
    codeLanguage: null,
  });
  return { technical: mk('technical'), core: mk('core'), hr: mk('hr') };
}

export function totalElapsedMs(s: Pick<InterviewSession, 'rounds'>): number {
  return ROUND_ORDER.reduce((acc, r) => acc + (s.rounds[r]?.elapsedMs ?? 0), 0);
}
