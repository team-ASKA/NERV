/**
 * Prompts that belong to the HTTP surface only: the end-of-interview report and
 * the post-interview tutor. Both are one-shot requests from the browser; neither
 * is ever replayed offline, so neither needs to live in `shared/`.
 *
 * The interviewer's own persona does — the worker replays whole interviews with
 * it — so it now lives in `shared/interview.ts` and is re-exported here to keep
 * the handlers' imports unchanged.
 */

import type { ResumeContext } from '../../shared/interview';

export { buildSystemPrompt, buildUserPrompt, fallbackReply } from '../../shared/interview';

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
