/**
 * Shared request/response contracts + transcript utilities for the NERV
 * interview engine. Imported by the serverless handlers under `api/`.
 *
 * This file is under `api/_lib/` — Vercel does not treat `_`-prefixed
 * directories as routes, so it is safe shared code (never a function).
 */

import type { EmotionDimensions, EmotionSource } from '../../shared/emotion';

export type Round = 'technical' | 'core' | 'hr';

/** Structured, resume-grounded context. All list fields are plain strings. */
export interface ResumeContext {
  name?: string;
  title?: string;
  summary?: string;
  skills: string[];
  projects: string[];
  achievements: string[];
  experience: string[];
  education: string[];
  /** Optional raw text, already truncated by the parser. */
  rawText?: string;
}

/** Rolling emotion read. `available:false` = we have no honest signal. */
export interface EmotionAggregate {
  available: boolean;
  /** Which provider produced this (local model or cloud). */
  source?: EmotionSource;
  /** 0..1 — how much weight this read deserves. See `shared/emotion.ts`. */
  reliability?: number;
  /** Frames behind the read. */
  samples?: number;
  /** The weighted, provider-independent read the prompt actually uses. */
  dimensions?: EmotionDimensions;
  dominantEmotion?: string;
  confidenceScore?: number; // 0..1
  isConfident?: boolean;
  isNervous?: boolean;
  isStruggling?: boolean;
}

export type TurnRole = 'interviewer' | 'candidate';

export interface TranscriptTurn {
  role: TurnRole;
  text: string;
}

export interface InterviewNextRequest {
  round: Round;
  resume: ResumeContext | null;
  transcript: TranscriptTurn[];
  emotion?: EmotionAggregate | null;
  /** Monaco scratchpad contents (technical round only). */
  code?: string;
}

export interface InterviewNextResponse {
  message: string;
  round: Round;
  isFollowUp: boolean;
  /** true when no LLM provider is configured and a canned reply was used. */
  degraded?: boolean;
}

const EMPTY_RESUME: ResumeContext = {
  skills: [],
  projects: [],
  achievements: [],
  experience: [],
  education: [],
};

/** Coerce arbitrary list items (string | object) into readable strings. */
export function normalizeList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        const name = (o.name || o.title || o.role || o.company) as string | undefined;
        const detail = (o.description || o.summary || o.details) as string | undefined;
        if (name && detail) return `${name} — ${detail}`;
        if (name) return String(name);
        try {
          return JSON.stringify(item);
        } catch {
          return '';
        }
      }
      return item == null ? '' : String(item);
    })
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Normalize any loosely-typed resume payload into a ResumeContext. */
export function coerceResume(raw: unknown): ResumeContext {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_RESUME };
  const r = raw as Record<string, unknown>;
  return {
    name: typeof r.name === 'string' ? r.name : undefined,
    title: typeof r.title === 'string' ? r.title : undefined,
    summary: typeof r.summary === 'string' ? r.summary : undefined,
    skills: normalizeList(r.skills),
    projects: normalizeList(r.projects),
    achievements: normalizeList(r.achievements),
    experience: normalizeList(r.experience ?? r.experiences),
    education: normalizeList(r.education),
    rawText: typeof r.rawText === 'string' ? r.rawText : undefined,
  };
}

/** Sanitize a free-text answer so "undefined"/"null" never leak into prompts. */
export function sanitizeText(input: unknown): string {
  const s = typeof input === 'string' ? input.trim() : '';
  if (!s || s.toLowerCase() === 'undefined' || s.toLowerCase() === 'null') return '';
  return s;
}

/**
 * Keep the transcript compact: drop empty turns, cap to the most recent
 * `maxTurns`, and clamp each turn's length so prompts stay within budget.
 */
export function trimTranscript(
  transcript: TranscriptTurn[] | undefined,
  maxTurns = 16,
  maxCharsPerTurn = 1200,
): TranscriptTurn[] {
  if (!Array.isArray(transcript)) return [];
  const cleaned = transcript
    .filter((t) => t && typeof t.text === 'string' && t.text.trim().length > 0)
    .map((t) => ({
      role: t.role === 'interviewer' ? ('interviewer' as const) : ('candidate' as const),
      text: t.text.trim().slice(0, maxCharsPerTurn),
    }));
  return cleaned.slice(-maxTurns);
}

/** Count how many questions the interviewer has already asked. */
export function interviewerTurnCount(transcript: TranscriptTurn[]): number {
  return transcript.filter((t) => t.role === 'interviewer').length;
}
