import type { VercelRequest, VercelResponse } from '@vercel/node';
import { coerceResume, type TranscriptTurn } from './_lib/session';
import { SUMMARY_SYSTEM_PROMPT } from './_lib/prompts';
import { completeReply, hasAnyProvider } from './_lib/llm';
import { requireUser } from './_lib/auth';

/**
 * End-of-interview report generator. Uses the shared LLM layer (Groq → Gemini)
 * and the single report persona. Accepts either the new unified shape or the
 * legacy { technical, project, hr, resume, emotions } shape.
 */

type LooseTurn = { role?: string; sender?: string; text?: string; content?: string };

/** Normalize any round payload (array of turns, or { messages: [...] }) to lines. */
function toTurns(input: unknown): TranscriptTurn[] {
  const arr: LooseTurn[] = Array.isArray(input)
    ? (input as LooseTurn[])
    : input && typeof input === 'object' && Array.isArray((input as { messages?: unknown }).messages)
      ? ((input as { messages: LooseTurn[] }).messages)
      : [];
  return arr
    .map((m) => {
      const text = (m.text ?? m.content ?? '').toString().trim();
      const isInterviewer = m.role === 'interviewer' || m.sender === 'ai' || m.role === 'assistant';
      return { role: isInterviewer ? ('interviewer' as const) : ('candidate' as const), text };
    })
    .filter((t) => t.text.length > 0)
    .slice(-40);
}

function renderRound(title: string, turns: TranscriptTurn[]): string {
  if (!turns.length) return `### ${title}\n(no exchange recorded)`;
  const body = turns.map((t) => `${t.role === 'interviewer' ? 'Interviewer' : 'Candidate'}: ${t.text}`).join('\n');
  return `### ${title}\n${body}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // The longest single generation in the product. Gated for the same reason as
  // the interview engine: an open one bills the account for anyone's transcript.
  const authedUser = await requireUser(req, res);
  if (!authedUser) return;

  const body = (req.body || {}) as Record<string, unknown>;
  const resume = coerceResume(body.resume);
  const technical = toTurns(body.technical);
  const core = toTurns(body.core ?? body.project);
  const hr = toTurns(body.hr);
  const emotions = body.emotions ?? body.emotion ?? body.emotionTimeline ?? null;
  const code = typeof body.code === 'string' ? (body.code as string) : '';

  if (!hasAnyProvider()) {
    return res.status(200).json({
      summary:
        '# Interview Performance Report\n\n_Report generation is not configured on the server yet (no LLM API key). Your transcript has been saved and a full report will be available once the server is configured._',
      degraded: true,
    });
  }

  const resumeSummary = [
    resume.name ? `Name: ${resume.name}` : '',
    resume.skills.length ? `Skills: ${resume.skills.slice(0, 30).join(', ')}` : '',
    resume.projects.length ? `Projects: ${resume.projects.slice(0, 8).join(' | ')}` : '',
    resume.experience.length ? `Experience: ${resume.experience.slice(0, 8).join(' | ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const user = [
    'CANDIDATE RESUME:',
    resumeSummary || '(none provided)',
    '',
    'INTERVIEW TRANSCRIPT:',
    renderRound('Technical Round', technical),
    renderRound('Core / Project Round', core),
    renderRound('HR / Behavioral Round', hr),
    code ? `\nCANDIDATE CODE SCRATCHPAD (technical round):\n${code.slice(0, 4000)}` : '',
    emotions ? `\nEMOTION / CONFIDENCE DATA (only reference if meaningful):\n${JSON.stringify(emotions).slice(0, 2000)}` : '',
    '',
    'Write the report now, following the required section structure exactly.',
  ].join('\n');

  try {
    const { text } = await completeReply(SUMMARY_SYSTEM_PROMPT, user, { temperature: 0.4, maxTokens: 1800 });
    if (!text.trim()) {
      return res.status(200).json({
        summary: '# Interview Performance Report\n\n_The report could not be generated right now. Please try again._',
        degraded: true,
      });
    }
    return res.status(200).json({ summary: text });
  } catch (err) {
    console.error('[summary] error:', (err as Error)?.message);
    return res.status(500).json({ error: 'Failed to generate summary', detail: (err as Error)?.message });
  }
}
