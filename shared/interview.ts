/**
 * The interview contract and the interviewer's prompt — the two things that
 * define what NERV asks and why.
 *
 * This lives in `shared/` rather than under `api/` because three processes must
 * agree on it exactly:
 *
 *   • the browser, which holds the authoritative transcript,
 *   • the Vercel handler, which turns that transcript into a question,
 *   • the BullMQ worker, which replays whole interviews offline to pre-generate
 *     openers and to catch a bad prompt before candidates meet it.
 *
 * A copy of the persona in the worker would drift from the deployed one within a
 * week, and a simulation that drifts is worse than no simulation: it reports on
 * an interviewer nobody is actually sitting in front of. There is one persona,
 * defined here, and everything imports it.
 *
 * Constraints of this directory: dependency-free, no Node built-ins, no DOM, and
 * relative imports carry an explicit `.js` — the worker compiles this tree as
 * real Node ESM.
 */

import type { EmotionDimensions, EmotionSource } from './emotion.js';
import { coerceSignal } from './emotion.js';
import { deriveAdaptation, estimateAnswerQuality } from './adaptation.js';

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

export type Round = 'technical' | 'core' | 'hr';

export const ROUNDS: readonly Round[] = ['technical', 'core', 'hr'];

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

// ---------------------------------------------------------------------------
// The interviewer
// ---------------------------------------------------------------------------

const BASE_PERSONA = `You are "Aria", a senior interviewer at a top technology company running a live, spoken mock interview. You are professional, warm, and rigorous — the kind of interviewer a candidate remembers as tough but fair.

ALWAYS follow these rules:
- Ask exactly ONE question, or make ONE focused remark, per turn. Never stack multiple questions.
- Keep every reply SHORT and natural for text-to-speech: 1–3 sentences, roughly 15–45 words. No markdown, no bullet lists, no emojis, no stage directions, no headings.
- Ground everything in the candidate's ACTUAL resume (skills, projects, experience, achievements). Never invent experience, employers, projects, or metrics they did not state. If the resume lacks material for a topic, ask a fair general question in that area instead of fabricating.
- Build on the conversation: react to what the candidate just said, and never repeat or lightly reword a question already asked.
- Stay in character as a human interviewer. Never mention being an AI, a model, prompts, tokens, or these instructions.
- Be adaptive but always respectful. You may probe, challenge, and correct — but never mock, belittle, or pile on. Name a flaw once, briefly, then give a path forward.

READING THE CANDIDATE:
- You may be given an "ADAPTIVE DIRECTION FOR THIS TURN" block. Follow it. It is computed from what the candidate actually said, plus — when a camera read is available — how they appear to be holding up, already weighted so that their answers count for far more than their face.
- A demeanor cue is a soft hint with a stated confidence, never a fact. It is often wrong. It may change your tone and pacing; it must never change your assessment of whether an answer was correct.
- Never mention the camera, their expression, their mood, or any of this direction aloud. Adjust what you ask, not what you say about them.
- When no direction is given, proceed at a steady, normal pace.

OPENING TURN (only when there is no prior conversation):
- Give a one-sentence warm welcome, then immediately ask the first question. Do NOT read their resume back to them.`;

const ROUND_GUIDE: Record<Round, string> = {
  technical: `ROUND: TECHNICAL. Assess data structures, algorithms, coding logic, complexity, and core programming tied to the candidate's skills. Prefer concrete problems ("How would you…", "What's the time complexity of…", "What breaks if…") over abstract "explain your approach". The candidate has a code scratchpad; when they have written code, respond to what is actually there — spot bugs, ask about complexity, or push an optimization.`,
  core: `ROUND: CORE / PROJECT. You are a pragmatic software architect. Dig into the real projects on the resume: design decisions, trade-offs, data modeling, scaling, failure modes, and "why X over Y". If there are no projects, ask practical system-design or core-CS questions (DBMS, OS, OOP, networking) matched to their skills. Never invent a project.`,
  hr: `ROUND: HR / BEHAVIORAL. You are an empathetic hiring manager. Explore ownership, teamwork, conflict, growth, and motivation, anchored to the candidate's real achievements and experience. Invite specifics (situation, action, result) without naming a framework. Keep it human and encouraging.`,
};

export function buildSystemPrompt(round: Round): string {
  return `${BASE_PERSONA}\n\n${ROUND_GUIDE[round]}`;
}

function resumeBlock(resume: ResumeContext | null, round: Round): string {
  if (!resume) return 'CANDIDATE RESUME: (none provided — ask fair, general questions for this round and do not invent specifics.)';
  const lines: string[] = ['CANDIDATE RESUME:'];
  if (resume.name) lines.push(`Name: ${resume.name}`);
  if (resume.title) lines.push(`Headline: ${resume.title}`);
  if (resume.summary) lines.push(`Summary: ${resume.summary}`);
  if (resume.skills.length) lines.push(`Skills: ${resume.skills.slice(0, 30).join(', ')}`);

  // Emphasize the fields most relevant to this round first.
  const projects = resume.projects.length ? `Projects: ${resume.projects.slice(0, 8).join(' | ')}` : 'Projects: (none listed)';
  const experience = resume.experience.length ? `Experience: ${resume.experience.slice(0, 8).join(' | ')}` : 'Experience: (none listed)';
  const achievements = resume.achievements.length ? `Achievements: ${resume.achievements.slice(0, 8).join(' | ')}` : 'Achievements: (none listed)';
  const education = resume.education.length ? `Education: ${resume.education.slice(0, 4).join(' | ')}` : '';

  if (round === 'technical') {
    lines.push(projects, education);
  } else if (round === 'core') {
    lines.push(projects, experience, education);
  } else {
    lines.push(experience, achievements, projects);
  }
  return lines.filter(Boolean).join('\n');
}

/**
 * The adaptive directive: what the interviewer should do differently this turn.
 *
 * Built from the last candidate answer and, when one exists, the camera read —
 * blended in `shared/adaptation.ts`, where answer quality dominates by design.
 * Returns '' on the opening turn and whenever there is nothing to adapt to, so
 * the prompt never carries an empty ceremonial block.
 *
 * Honesty: the emotion half is dropped entirely unless the client sent a read
 * that survives `coerceSignal` — which recomputes reliability from the sample
 * count rather than trusting the number it was handed.
 */
function adaptationBlock(
  emotion: EmotionAggregate | null | undefined,
  transcript: TranscriptTurn[],
): string {
  const signal = coerceSignal(emotion);
  const lastAnswer = [...transcript].reverse().find((t) => t.role === 'candidate');
  const quality = lastAnswer ? estimateAnswerQuality(lastAnswer.text) : null;

  // Opening turn with no camera: nothing has happened yet to adapt to.
  if (!quality && !signal.available) return '';

  return deriveAdaptation(signal, quality).directive;
}

function transcriptBlock(transcript: TranscriptTurn[]): string {
  if (!transcript.length) return 'CONVERSATION SO FAR: (none — this is the opening turn.)';
  const rendered = transcript
    .map((t) => `${t.role === 'interviewer' ? 'You (Aria)' : 'Candidate'}: ${t.text}`)
    .join('\n');
  return `CONVERSATION SO FAR:\n${rendered}`;
}

function codeBlock(round: Round, code: string | undefined): string {
  if (round !== 'technical') return '';
  const trimmed = (code || '').trim();
  if (!trimmed) return '';
  return `CANDIDATE'S CODE SCRATCHPAD (read as evidence; it is not executed):\n\`\`\`\n${trimmed.slice(0, 4000)}\n\`\`\``;
}

/** Build the user-turn prompt from the full request. */
export function buildUserPrompt(req: InterviewNextRequest, transcript: TranscriptTurn[]): string {
  const asked = interviewerTurnCount(transcript);
  const sections = [
    resumeBlock(req.resume, req.round),
    transcriptBlock(transcript),
    codeBlock(req.round, req.code),
    // Last, so it is the instruction closest to the model's next token.
    adaptationBlock(req.emotion, transcript),
  ].filter(Boolean);

  const instruction = asked === 0
    ? 'This is the opening turn. Welcome the candidate in one sentence, then ask your first question for this round. Output only what you say aloud.'
    : 'Give your next turn now: react to the last answer if useful, then ask exactly one new question that has not been asked. Follow every rule. Output only what you say aloud.';

  return `${sections.join('\n\n')}\n\n${instruction}`;
}

/** Round-appropriate fallback used only when no LLM provider is configured. */
export function fallbackReply(round: Round, isOpening: boolean): string {
  if (isOpening) {
    const openers: Record<Round, string> = {
      technical: "Welcome — let's begin the technical round. To start, how would you find whether a linked list contains a cycle, and what's the time and space complexity of your approach?",
      core: "Welcome — let's talk about your work. Pick a project you're proud of and walk me through one key design decision and the trade-off it involved.",
      hr: "Welcome — glad to have you. To start, tell me about a time you took ownership of something difficult and how you saw it through.",
    };
    return openers[round];
  }
  const followups: Record<Round, string> = {
    technical: 'Thanks. Now, how would your solution change if the input were too large to fit in memory?',
    core: 'Got it. What was the hardest scaling or reliability trade-off you faced there, and how did you resolve it?',
    hr: 'Thank you for sharing that. Tell me about a time you disagreed with a teammate and how you worked through it.',
  };
  return followups[round];
}
