import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  coerceResume,
  interviewerTurnCount,
  trimTranscript,
  type InterviewNextRequest,
  type Round,
} from '../_lib/session';
import { buildSystemPrompt, buildUserPrompt, fallbackReply } from '../_lib/prompts';
import { completeReply, hasAnyProvider, streamReply } from '../_lib/llm';
import { requireUser } from '../_lib/auth';

const VALID_ROUNDS: Round[] = ['technical', 'core', 'hr'];

function parseRound(input: unknown): Round {
  return VALID_ROUNDS.includes(input as Round) ? (input as Round) : 'technical';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Before anything else, and before any SSE header is written: this is the
  // most expensive endpoint in the system, and every field of the prompt comes
  // from the caller. Unauthenticated, it is an open invitation to spend the
  // account's model quota — which is the ceiling every real candidate shares.
  const authedUser = await requireUser(req, res);
  if (!authedUser) return;

  const body = (req.body || {}) as Partial<InterviewNextRequest>;
  const round = parseRound(body.round);
  const resume = body.resume ? coerceResume(body.resume) : null;
  const transcript = trimTranscript(body.transcript);
  const emotion = body.emotion && typeof body.emotion === 'object' ? body.emotion : null;
  const code = typeof body.code === 'string' ? body.code : undefined;

  const isOpening = interviewerTurnCount(transcript) === 0;
  const isFollowUp = !isOpening;

  const reqForPrompt: InterviewNextRequest = { round, resume, transcript, emotion, code };
  const system = buildSystemPrompt(round);
  const user = buildUserPrompt(reqForPrompt, transcript);

  const wantsStream = req.query.stream === '1' || req.query.stream === 'true';

  // Degraded mode: no provider configured. Keep the interview flowing honestly.
  if (!hasAnyProvider()) {
    const message = fallbackReply(round, isOpening);
    if (wantsStream) {
      startSse(res);
      sse(res, { delta: message });
      sse(res, { done: true, message, round, isFollowUp, degraded: true });
      res.write('data: [DONE]\n\n');
      return res.end();
    }
    return res.status(200).json({ message, round, isFollowUp, degraded: true });
  }

  // Abort upstream work if the client disconnects.
  const controller = new AbortController();
  req.on('close', () => controller.abort());

  if (wantsStream) {
    startSse(res);
    let full = '';
    try {
      for await (const delta of streamReply(system, user, { signal: controller.signal, maxTokens: 320 })) {
        full += delta;
        sse(res, { delta });
      }
    } catch (err) {
      console.error('[interview/next] stream error:', (err as Error)?.message);
    }
    if (!full.trim()) {
      full = fallbackReply(round, isOpening);
      sse(res, { delta: full });
    }
    sse(res, { done: true, message: full.trim(), round, isFollowUp });
    res.write('data: [DONE]\n\n');
    return res.end();
  }

  // JSON mode.
  try {
    const { text } = await completeReply(system, user, { signal: controller.signal, maxTokens: 320 });
    const message = text.trim() || fallbackReply(round, isOpening);
    return res.status(200).json({ message, round, isFollowUp, degraded: !text.trim() });
  } catch (err) {
    console.error('[interview/next] error:', (err as Error)?.message);
    return res.status(200).json({
      message: fallbackReply(round, isOpening),
      round,
      isFollowUp,
      degraded: true,
    });
  }
}

function startSse(res: VercelResponse) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
}

function sse(res: VercelResponse, obj: unknown) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}
