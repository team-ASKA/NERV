/**
 * Client-side mirror of the interview contracts in `api/_lib/session.ts`.
 * (The `src` and `api` trees are typechecked separately, so the shapes are
 * duplicated here rather than imported across the boundary.)
 */

export type Round = 'technical' | 'core' | 'hr';

export interface ResumeContext {
  name?: string;
  title?: string;
  summary?: string;
  skills: string[];
  projects: string[];
  achievements: string[];
  experience: string[];
  education: string[];
  rawText?: string;
}

export interface EmotionAggregate {
  available: boolean;
  dominantEmotion?: string;
  confidenceScore?: number; // 0..1
  isConfident?: boolean;
  isNervous?: boolean;
  isStruggling?: boolean;
  /** Top emotions for display, if available. */
  breakdown?: Array<{ name: string; score: number }>;
}

export type TurnRole = 'interviewer' | 'candidate';

export interface TranscriptTurn {
  role: TurnRole;
  text: string;
}

export const EMPTY_RESUME: ResumeContext = {
  skills: [],
  projects: [],
  achievements: [],
  experience: [],
  education: [],
};

export const ROUND_LABELS: Record<Round, string> = {
  technical: 'Technical',
  core: 'Core / Project',
  hr: 'HR / Behavioral',
};
