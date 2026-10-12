import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  coerceResume,
  interviewerTurnCount,
  trimTranscript,
  type InterviewNextRequest,
  type Round,
} from '../_lib/session';
import { buildSystemPrompt, buildUserPrompt, fallbackReply } from '../_lib/prompts';
import { completeReply, hasAnyProvider, providerInfo, streamReply } from '../_lib/llm';
import { requireUser } from '../_lib/auth';
import { enforce } from '../_lib/rateLimit';
import { fail, ok } from '../_lib/respond';
import { formatEvent, type InterviewEvent } from '../../shared/session';
import { isUuid } from '../../shared/api';

const VALID_ROUNDS: Round[] = ['technical', 'core', 'hr'];

function parseRound(input: unknown): Round {
  return VALID_ROUNDS.includes(input as Round) ? (input as Round) : 'technical';
}

/** Active generation attempts: one lease per (session, requestId). */
const attemptLeases = new Map<string, { expires: number }>();
function claimAttempt(key: string): boolean {
  const now = Date.now();
  const cur = attemptLeases.get(key);
  if (cur && cur.expires > now) return false;
  attemptLeases.set(key, { expires: now + 60_000 });
  return true;
}
function releaseAttempt(key: string): void {
  attemptLeases.delete(key);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(res, 'validation', 'Use POST.');
  }

  // Auth + quota BEFORE paid work and BEFORE SSE headers.
  const authedUser = await requireUser(req, res);
  if (!authedUser) return;
  if (!(await enforce(req, res, 'interviewNext', authedUser.uid))) return;

  const body = (req.body || {}) as Partial<InterviewNextRequest> & {
    sessionId?: unknown;
    turnRequestId?: unknown;
    expectedRevision?: unknown;
  };
  const round = parseRound(body.round);
  const resume = body.resume ? coerceResume(body.resume) : null;
  const transcript = trimTranscript(body.transcript);
  const emotion = body.emotion && typeof body.emotion === 'object' ? body.emotion : null;
  const code = typeof body.code === 'string' ? body.code.slice(0, 20_000) : undefined;

  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : null;
  const turnRequestId = typeof body.turnRequestId === 'string' ? body.turnRequestId : null;
  const expectedRevision = typeof body.expectedRevision === 'number' ? body.expectedRevision : null;

  if (sessionId !== null && !isUuid(sessionId)) return fail(res, 'validation', 'Invalid sessionId.');
  if (turnRequestId !== null && !isUuid(turnRequestId)) return fail(res, 'validation', 'Invalid turnRequestId.');

  const attemptKey = sessionId && turnRequestId ? `${sessionId}:${turnRequestId}` : null;
  if (attemptKey && !claimAttempt(attemptKey)) {
    return fail(res, 'conflict', 'That question is already being generated. Wait, then retry.');
  }

  const isOpening = interviewerTurnCount(transcript) === 0;
  const isFollowUp = !isOpening;
  const reqForPrompt: InterviewNextRequest = { round, resume, transcript, emotion, code };
  const system = buildSystemPrompt(round);
  const user = buildUserPrompt(reqForPrompt, transcript);
  const info = providerInfo();

  const wantsStream = req.query.stream === '1' || req.query.stream === 'true';
  const questionId = turnRequestId ?? crypto.randomUUID();
  const promptVersion = 'v2';

  // Cancellation is tied to RESPONSE disconnection, guarded by `finished`.
  // (req 'close' fires after the request body completes on Node — P0-3.)
  const controller = new AbortController();
  let finished = false;
  let responded = false;
  const finish = () => {
    finished = true;
    if (attemptKey) releaseAttempt(attemptKey);
  };
  res.on('close', () => {
    if (!finished && !responded) controller.abort();
  });

  // Best-effort durable commit of the completed question. Returns the new
  // revision, or null when the DB is unavailable (degraded but honest).
  async function commitQuestion(text: string): Promise<number | null> {
    if (!sessionId) return expectedRevision;
    try {
      const { admin } = await import('../_lib/supabaseAdmin');
      const db = admin();
      const { data: sess } = await db
        .from('interview_sessions')
        .select('id,revision,user_id')
        .eq('id', sessionId)
        .eq('user_id', authedUser!.uid)
        .single();
      if (!sess) return null;
      const s = sess as { revision: number };
      if (expectedRevision !== null && s.revision !== expectedRevision) return null;
      const { data: maxRow } = await db
        .from('interview_turns')
        .select('seq')
        .eq('session_id', sessionId)
        .eq('round', round)
        .order('seq', { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextSeq = (((maxRow as { seq?: number } | null)?.seq ?? 0) as number) + 1;
      const { error } = await db.from('interview_turns').insert({
        session_id: sessionId,
        round,
        turn_uuid: questionId,
        seq: nextSeq,
        role: 'interviewer',
        text,
        status: 'complete',
      });
      if (error) return null;
      await db.from('interview_sessions').update({ revision: s.revision + 1 }).eq('id', sessionId);
      return s.revision + 1;
    } catch {
      return null;
    }
  }

  try {
    if (!hasAnyProvider()) {
      const message = fallbackReply(round, isOpening);
      if (wantsStream) {
        startSse(res);
        send(res, { type: 'start', requestId: questionId, questionId, promptVersion });
        send(res, { type: 'delta', questionId, seq: 0, text: message });
        send(res, { type: 'error', questionId, code: 'unavailable', retryable: false, partial: false });
        responded = true;
        finish();
        return res.end();
      }
      finish();
      return ok(res, { message, round, isFollowUp, degraded: true, questionId });
    }

    if (wantsStream) {
      startSse(res);
      send(res, { type: 'start', requestId: questionId, questionId, promptVersion });
      let full = '';
      let seq = 0;
      let failed = false;
      try {
        for await (const delta of streamReply(system, user, { signal: controller.signal, maxTokens: 320 })) {
          if (finished) break;
          full += delta;
          send(res, { type: 'delta', questionId, seq: seq++, text: delta });
        }
      } catch {
        failed = true;
      }
      if (controller.signal.aborted && !finished) {
        // Client went away or barge-in: preserve partial boundary, no commit.
        send(res, { type: 'error', questionId, code: 'cancelled', retryable: true, partial: full.trim().length > 0 });
        responded = true;
        finish();
        return res.end();
      }
      if (failed || !full.trim()) {
        if (!full.trim()) {
          send(res, { type: 'error', questionId, code: 'upstream', retryable: true, partial: false });
        } else {
          // After-token failure: interrupted, never a second provider's question.
          send(res, { type: 'error', questionId, code: 'upstream', retryable: true, partial: true });
        }
        responded = true;
        finish();
        return res.end();
      }
      const revision = await commitQuestion(full.trim());
      if (revision === null && sessionId) {
        send(res, { type: 'error', questionId, code: 'upstream', retryable: true, partial: false });
        responded = true;
        finish();
        return res.end();
      }
      send(res, {
        type: 'complete',
        questionId,
        text: full.trim(),
        revision: revision ?? expectedRevision ?? 0,
        provider: info.provider,
        model: info.model,
      });
      responded = true;
      finish();
      return res.end();
    }

    // JSON mode.
    const { text } = await completeReply(system, user, { signal: controller.signal, maxTokens: 320 });
    const message = text.trim() || fallbackReply(round, isOpening);
    if (text.trim()) await commitQuestion(message);
    finish();
    return ok(res, { message, round, isFollowUp, degraded: !text.trim(), questionId });
  } catch (err) {
    if (!responded && !wantsStream) {
      finish();
      const retryable = (err as { retryable?: boolean })?.retryable ?? true;
      return fail(res, 'upstream', 'Question generation failed.', { retryable });
    }
    try {
      send(res, { type: 'error', questionId, code: 'upstream', retryable: true, partial: false });
    } catch {
      /* connection gone */
    }
    responded = true;
    finish();
    return res.end();
  }
}

function startSse(res: VercelResponse) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
}

function send(res: VercelResponse, e: InterviewEvent) {
  res.write(formatEvent(e));
}
