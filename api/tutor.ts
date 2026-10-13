import type { VercelRequest, VercelResponse } from '@vercel/node';
import { completeReply, hasAnyProvider } from './_lib/llm';
import { buildTutorSystemPrompt, TUTOR_UNAVAILABLE_REPLY, type TutorContext } from './_lib/prompts';
import { sanitizeText } from './_lib/session';
import { requireUser } from './_lib/auth';
import { enforce } from './_lib/rateLimit';
import { fail, ok, methodNotAllowed } from './_lib/respond';

/**
 * Training tutor with typed actions: explain/quiz/flashcards/deep-dive.
 * Quiz/flashcards get real token budgets + schema validation; malformed
 * output returns retryable error, never a falsely scored quiz.
 */

interface TutorTurn {
  role: 'user' | 'assistant';
  content: string;
}

const MAX_HISTORY = 10;
const MAX_TURN_CHARS = 1500;
const ACTIONS = ['explain', 'quiz', 'flashcards', 'deep-dive'] as const;
type Action = (typeof ACTIONS)[number];

const BUDGETS: Record<Action, number> = { explain: 500, quiz: 1500, flashcards: 1200, 'deep-dive': 1500 };

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

interface QuizQuestion {
  question: string;
  options: string[];
  correct: number;
  explanation: string;
}

function parseQuiz(text: string, count: number): QuizQuestion[] | null {
  try {
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start < 0 || end <= start) return null;
    const arr = JSON.parse(text.slice(start, end + 1)) as Array<Record<string, unknown>>;
    if (!Array.isArray(arr) || arr.length === 0 || arr.length > count + 2) return null;
    const out: QuizQuestion[] = [];
    for (const q of arr.slice(0, count)) {
      if (typeof q.question !== 'string' || !Array.isArray(q.options) || typeof q.correct !== 'number' || typeof q.explanation !== 'string') return null;
      if (q.options.length < 2 || q.options.length > 5) return null;
      if (q.correct < 0 || q.correct >= q.options.length) return null;
      out.push({ question: q.question.slice(0, 500), options: q.options.map((o) => String(o).slice(0, 300)), correct: q.correct, explanation: q.explanation.slice(0, 500) });
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const authedUser = await requireUser(req, res);
  if (!authedUser) return;
  if (!(await enforce(req, res, 'tutor', authedUser.uid))) return;

  const body = (req.body || {}) as {
    message?: unknown;
    history?: unknown;
    context?: TutorContext;
    topicId?: unknown;
    action?: unknown;
    requestId?: unknown;
    trainingSessionId?: unknown;
  };
  const action: Action = (ACTIONS as readonly string[]).includes(body.action as string)
    ? (body.action as Action)
    : 'explain';
  const message = sanitizeText(body.message).slice(0, MAX_TURN_CHARS);
  if (!message) return fail(res, 'validation', 'A message is required.');
  const history = coerceHistory(body.history);
  const topicId = typeof body.topicId === 'string' ? body.topicId.slice(0, 200) : undefined;

  if (!hasAnyProvider()) {
    return ok(res, { text: TUTOR_UNAVAILABLE_REPLY, degraded: true, action });
  }

  const context: TutorContext = {
    ...(body.context ?? {}),
    topic: topicId ?? body.context?.topic ?? 'general practice',
  } as TutorContext;

  const system = buildTutorSystemPrompt(context, action);
  const rendered =
    history.length === 0
      ? `CONVERSATION SO FAR: (none — this is the first turn.)`
      : `CONVERSATION SO FAR:\n${history.map((t) => `${t.role === 'assistant' ? 'Tutor' : 'Student'}: ${t.content}`).join('\n')}`;
  const prompt = action === 'quiz'
    ? `${rendered}\n\nSTUDENT: ${message}\n\nReply with a JSON array of exactly 4 quiz questions (question, options[4], correct index, explanation). JSON ONLY, no prose.`
    : action === 'flashcards'
      ? `${rendered}\n\nSTUDENT: ${message}\n\nReply with a JSON array of exactly 6 flashcards {front, back}. JSON ONLY.`
      : `${rendered}\n\nSTUDENT: ${message}`;

  try {
    const { text } = await completeReply(system, prompt, { maxTokens: BUDGETS[action], timeoutMs: 30_000 });
    if (!text.trim()) return fail(res, 'upstream', 'The tutor gave no answer. Retry.', { retryable: true });
    if (action === 'quiz') {
      const quiz = parseQuiz(text, 4);
      if (!quiz) return fail(res, 'upstream', 'The quiz came back malformed. Retry for a fresh one.', { retryable: true });
      return ok(res, { text: 'Your quiz is ready below.', quiz, action });
    }
    return ok(res, { text: text.trim(), action });
  } catch {
    return fail(res, 'upstream', 'The tutor failed. Retry.', { retryable: true });
  }
}
