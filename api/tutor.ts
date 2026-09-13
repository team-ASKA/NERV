import type { VercelRequest, VercelResponse } from '@vercel/node';
import { completeReply, hasAnyProvider } from './_lib/llm';
import { buildTutorSystemPrompt, TUTOR_UNAVAILABLE_REPLY, type TutorContext } from './_lib/prompts';
import { sanitizeText } from './_lib/session';

/**
 * Training-session tutor. Stateless: the client owns the conversation and
 * replays the recent turns, so there is no per-instance memory to lose on a
 * cold start. Replaces the old `/api/groq-proxy`, which accepted arbitrary
 * caller-supplied system prompts.
 */

interface TutorTurn {
  role: 'user' | 'assistant';
  content: string;
}

const MAX_HISTORY = 10;
const MAX_TURN_CHARS = 1500;

function renderHistory(history: TutorTurn[]): string {
  if (!history.length) return 'CONVERSATION SO FAR: (none — this is the first turn.)';
  const lines = history
    .map((t) => `${t.role === 'assistant' ? 'Tutor' : 'Student'}: ${t.content}`)
    .join('\n');
  return `CONVERSATION SO FAR:\n${lines}`;
}

function coerceHistory(raw: unknown): TutorTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) => {
      const turn = t as { role?: unknown; content?: unknown };
      const content = sanitizeText(turn.content).slice(0, MAX_TURN_CHARS);
      if (!content) return null;
      return { role: turn.role === 'assistant' ? ('assistant' as const) : ('user' as const), content };
    })
    .filter((t): t is TutorTurn => t !== null)
    .slice(-MAX_HISTORY);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = (req.body || {}) as { message?: unknown; history?: unknown; context?: TutorContext };
  const message = sanitizeText(body.message).slice(0, MAX_TURN_CHARS);
  if (!message) {
    return res.status(400).json({ error: 'A message is required.' });
  }

  if (!hasAnyProvider()) {
    return res.status(200).json({ reply: TUTOR_UNAVAILABLE_REPLY, degraded: true });
  }

  const system = buildTutorSystemPrompt(body.context ?? {});
  const user = `${renderHistory(coerceHistory(body.history))}\n\nStudent just said: ${message}\n\nReply now, following every rule. Output only what you say aloud.`;

  try {
    const { text, provider } = await completeReply(system, user, { temperature: 0.6, maxTokens: 500 });
    if (!text) {
      return res.status(200).json({
        reply: "I couldn't generate an answer just then. Could you ask that another way?",
        degraded: true,
      });
    }
    return res.status(200).json({ reply: text, provider });
  } catch (err) {
    console.error('[tutor] error:', (err as Error)?.message);
    return res.status(200).json({
      reply: "Something went wrong on my end. Let's try that again.",
      degraded: true,
    });
  }
}
