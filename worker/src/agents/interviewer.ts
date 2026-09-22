/**
 * The interviewer agent.
 *
 * Deliberately thin. Every decision about what NERV asks — the persona, the
 * round guides, the resume block, the adaptive directive — lives in
 * `shared/interview.ts`, and the deployed handler builds its prompt from the
 * same functions. This file supplies only the worker's transport.
 *
 * That split is the whole point of the simulation: if this agent had its own
 * prompt it would drift from production within a week, and a cached opener
 * would come from an interviewer no candidate ever meets.
 *
 * Mirrors `api/interview/next.ts` turn for turn: same trim, same token ceiling,
 * same `text.trim() || fallbackReply(...)` substitution.
 */

import {
  buildSystemPrompt,
  buildUserPrompt,
  fallbackReply,
  interviewerTurnCount,
  trimTranscript,
  type EmotionAggregate,
  type InterviewNextRequest,
  type ResumeContext,
  type Round,
  type TranscriptTurn,
} from '../../../shared/interview.js';
import { completeText } from '../llm/groq.js';

/** Matches `api/interview/next.ts`. Past this the persona's word cap is moot. */
const MAX_TOKENS = 320;

/**
 * The temperature the live path uses (`api/_lib/llm.ts` defaults to 0.6).
 * Duplicated rather than imported because that module is Vercel-only — the
 * *prompt* is shared, the transport is not.
 */
const TEMPERATURE = 0.6;

export interface InterviewerTurn {
  text: string;
  /** Wall-clock ms the model call took, including retries inside the client. */
  latencyMs: number;
  /** True when the model was unusable and the canned reply stood in. */
  degraded: boolean;
  /** True when this was the round's opening question. */
  isOpening: boolean;
  /** Why it degraded. Logged, never stored — it is about us, not the prompt. */
  error?: string;
}

export interface AskOptions {
  round: Round;
  resume: ResumeContext | null;
  transcript: TranscriptTurn[];
  /** Always null in a simulation: there is no camera and we never invent one. */
  emotion?: EmotionAggregate | null;
  /** Technical round only. A simulated candidate writes no code today. */
  code?: string;
}

/**
 * Generate one interviewer turn.
 *
 * Never throws. A provider outage degrades the turn to the canned reply and
 * flags it, which is itself information — a run of `degraded` turns says the
 * provider was down, not that the prompt is bad. Throwing would instead abandon
 * a simulation that had already paid for everything before it.
 */
export async function askInterviewer(opts: AskOptions): Promise<InterviewerTurn> {
  const transcript = trimTranscript(opts.transcript);
  const isOpening = interviewerTurnCount(transcript) === 0;

  const request: InterviewNextRequest = {
    round: opts.round,
    resume: opts.resume,
    transcript,
    emotion: opts.emotion ?? null,
    code: opts.code,
  };

  const system = buildSystemPrompt(opts.round);
  const user = buildUserPrompt(request, transcript);

  const started = Date.now();
  try {
    const raw = await completeText(system, user, {
      temperature: TEMPERATURE,
      maxTokens: MAX_TOKENS,
    });
    const text = raw.trim();
    return {
      text: text || fallbackReply(opts.round, isOpening),
      latencyMs: Date.now() - started,
      degraded: !text,
      isOpening,
      ...(text ? {} : { error: 'model returned an empty turn' }),
    };
  } catch (err) {
    return {
      text: fallbackReply(opts.round, isOpening),
      latencyMs: Date.now() - started,
      degraded: true,
      isOpening,
      error: (err as Error).message,
    };
  }
}
