import type { VercelRequest, VercelResponse } from '@vercel/node';
import { coerceResume, type ResumeContext } from '../_lib/session';
import { completeReply, hasAnyProvider } from '../_lib/llm';

/**
 * Server-side resume parser. Client sends the extracted PDF text; we ask the
 * LLM (Groq → Gemini) for a strict JSON structure, validate it, and return a
 * normalized ResumeContext. No keys ever reach the browser.
 */

const MAX_INPUT = 30000;

const SYSTEM = `You extract structured data from a resume. Output ONLY a single minified JSON object, no prose, no code fences. Use this exact shape:
{"name":string,"title":string,"summary":string,"skills":string[],"projects":string[],"achievements":string[],"experience":string[],"education":string[]}
Rules: Use "" or [] when a field is absent — never invent data. For projects/experience/achievements, each array item is one concise line (e.g. "Project Name — one-line description"). Keep skills as short tokens. Do not include anything outside the JSON object.`;

/** Take head + tail if the resume is unusually long, so nothing critical is lost. */
function clampText(text: string): string {
  if (text.length <= MAX_INPUT) return text;
  const head = text.slice(0, Math.floor(MAX_INPUT * 0.7));
  const tail = text.slice(-Math.floor(MAX_INPUT * 0.3));
  return `${head}\n...\n${tail}`;
}

/** Extract the first balanced JSON object from a possibly-decorated string. */
function extractJson(raw: string): unknown | null {
  const fenced = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(fenced.slice(start, end + 1));
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text } = (req.body || {}) as { text?: string };
  if (!text || typeof text !== 'string' || text.trim().length < 20) {
    return res.status(400).json({ error: 'Resume text is required (min 20 chars).' });
  }

  const rawText = text.trim().slice(0, MAX_INPUT * 2);

  if (!hasAnyProvider()) {
    // Honest degraded mode: return raw text so the interview can still run,
    // flagged so the UI can prompt the user that parsing was skipped.
    const empty: ResumeContext = coerceResume({ rawText });
    return res.status(200).json({ resume: empty, degraded: true });
  }

  try {
    const user = `Resume text:\n"""\n${clampText(rawText)}\n"""\n\nReturn the JSON object now.`;
    const { text: out } = await completeReply(SYSTEM, user, { temperature: 0.1, maxTokens: 1200 });
    const parsed = extractJson(out);
    if (!parsed) {
      const fallback: ResumeContext = coerceResume({ rawText });
      return res.status(200).json({ resume: fallback, degraded: true, error: 'Could not parse structured data.' });
    }
    const resume = coerceResume({ ...(parsed as object), rawText });
    return res.status(200).json({ resume });
  } catch (err) {
    console.error('[resume/parse] error:', (err as Error)?.message);
    const fallback: ResumeContext = coerceResume({ rawText });
    return res.status(200).json({ resume: fallback, degraded: true, error: (err as Error)?.message });
  }
}
