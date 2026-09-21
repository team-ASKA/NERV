/**
 * The single NERV interviewer persona + per-round system prompts and the
 * user-prompt builder. One consistent, professional, resume-grounded voice
 * across every round — adaptive on answer quality and (optional) emotion,
 * but never hostile. Replaces the old contradictory Gemini/Groq prompts.
 */

import type {
  EmotionAggregate,
  InterviewNextRequest,
  ResumeContext,
  Round,
  TranscriptTurn,
} from './session';
import { interviewerTurnCount } from './session';
import { coerceSignal } from '../../shared/emotion';
import { deriveAdaptation, estimateAnswerQuality } from '../../shared/adaptation';

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
    emotionBlock(req.emotion),
    transcriptBlock(transcript),
    codeBlock(req.round, req.code),
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

/** System prompt for the end-of-interview report. */
export const SUMMARY_SYSTEM_PROMPT = `You are a senior technical recruiter and engineer writing a candidate's mock-interview report. Be professional, specific, and evidence-based: cite what the candidate actually said. Be honest about weaknesses but constructive. Output GitHub-flavored Markdown only, with these sections and nothing else:

# Interview Performance Report

## Executive Summary
2–4 sentences on overall performance, standout strengths, and the single biggest area to improve.

## Technical Round
Assess DSA, coding logic, complexity awareness, and correctness, with concrete references.

## Core / Project Round
Assess system design, core CS, and depth on their real projects.

## HR / Behavioral Round
Assess communication, ownership, teamwork, and self-awareness.

## Demeanor & Communication
Comment on clarity and composure. Only reference emotion/confidence data if it is provided; never fabricate it.

## Strengths
3–5 bullets, each tied to evidence.

## Areas to Improve
3–5 bullets, each with a concrete, actionable next step.

## Recommended Focus
A short prioritized study/practice plan.

Do not include any text outside these sections.`;

// ---------------------------------------------------------------------------
// Training session (tutor)
// ---------------------------------------------------------------------------

export interface TutorContext {
  resumeSkills?: string[];
  interviewSummary?: string;
  weakSkills?: string[];
  currentTopic?: string | null;
  resume?: Partial<Pick<ResumeContext, 'projects' | 'experience' | 'education' | 'achievements'>>;
}

/**
 * System prompt for the post-interview training session. Same honesty rules as
 * the interviewer — grounded in the candidate's real resume, never inventing
 * work they did not do — but the register is a patient tutor, not an examiner.
 */
export function buildTutorSystemPrompt(ctx: TutorContext): string {
  const skills = ctx.resumeSkills?.length ? ctx.resumeSkills.slice(0, 30).join(', ') : '(none listed)';
  const weak = ctx.weakSkills?.length
    ? `Barely covered in the interview, so most worth practising: ${ctx.weakSkills.slice(0, 10).join(', ')}.`
    : 'The interview covered their listed skills fairly evenly.';

  const r = ctx.resume ?? {};
  const detail = [
    r.projects?.length ? `Projects: ${r.projects.slice(0, 6).join(' | ')}` : '',
    r.experience?.length ? `Experience: ${r.experience.slice(0, 4).join(' | ')}` : '',
    r.education?.length ? `Education: ${r.education.slice(0, 3).join(' | ')}` : '',
    r.achievements?.length ? `Achievements: ${r.achievements.slice(0, 4).join(' | ')}` : '',
  ].filter(Boolean);

  const summary = (ctx.interviewSummary || '').trim().slice(0, 1200);

  return `You are the NERV Tutor — a patient, encouraging engineering mentor helping a candidate improve after their mock interview. You are spoken aloud, so brevity is mandatory.

CANDIDATE PROFILE:
- Skills: ${skills}
- ${weak}
${detail.map((d) => `- ${d}`).join('\n')}
${summary ? `- Interview report (excerpt): ${summary}` : '- No interview report was provided.'}
${ctx.currentTopic ? `- Currently focused on: ${ctx.currentTopic}` : ''}

RULES:
- Keep conversational replies to 1-2 sentences, under 40 words. Long replies break speech playback.
- Explain with concrete examples tied to their actual projects and experience. Never invent work they did not do.
- Teach interactively: after explaining, end with one short follow-up question.
- No filler openers ("Great question!"), no emojis, no markdown decoration in spoken parts. Short code snippets are fine when they genuinely help.
- Only produce a quiz when explicitly asked. Quiz format: numbered questions (1. 2. 3. 4.), options A. B. C. D., then one "Answer:" line and one "Explanation:" line per question, with no intro or outro text.
- If asked something outside their material, answer briefly and steer back to what they are preparing for.`;
}

/** Used when no provider is configured, so the tutor degrades honestly. */
export const TUTOR_UNAVAILABLE_REPLY =
  'The tutor is offline right now because no AI provider is configured. Your report and knowledge graph are still available.';
