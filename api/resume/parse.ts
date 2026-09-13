import type { VercelRequest, VercelResponse } from '@vercel/node';
import { completeReply, hasAnyProvider } from '../_lib/llm';
import {
  chunkResume,
  isEmptyParse,
  mergeParsed,
  regexExtract,
  toResumeContext,
  type ParsedResume,
} from '../_lib/resume';

/**
 * Server-side resume parser. The client sends text extracted from the PDF; we
 * split it into sections, ask the LLM (Groq → Gemini) for strict JSON per
 * chunk, merge the results, and return a normalized ResumeContext. No AI key
 * ever reaches the browser.
 *
 * Every failure path still returns 200 with a usable resume: a deterministic
 * heading/keyword extraction runs alongside the model and is merged underneath
 * it, so a model outage degrades quality rather than breaking the interview.
 */

/** Cap on stored raw text — enough for the evaluator, bounded for storage. */
const MAX_RAW = 60000;

const SYSTEM = `You extract structured data from one section of a resume. Output ONLY a single minified JSON object, no prose, no code fences. Use this exact shape:
{"name":string,"title":string,"summary":string,"skills":string[],"projects":string[],"achievements":string[],"experience":string[],"education":string[]}

Rules:
- Use "" or [] when a field is absent from THIS text. Never invent data, never carry over examples.
- Infer categories even without explicit headings: something built or shipped is a project; an internship, freelance or salaried role is experience; a quantified result, rank or award is an achievement.
- skills: short tokens ("React", "PostgreSQL"), not sentences.
- projects / experience / achievements: one concise line each, e.g. "Project Name — what it does and the stack".
- education: "Degree in Field, Institution (Year)".
- Output nothing outside the JSON object.`;

/** Extract the first balanced JSON object from a possibly-decorated string. */
function extractJson(raw: string): Partial<ParsedResume> | null {
  const fenced = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(fenced.slice(start, end + 1));
    return parsed && typeof parsed === 'object' ? (parsed as Partial<ParsedResume>) : null;
  } catch {
    return null;
  }
}

async function parseChunk(chunk: string, index: number, total: number): Promise<Partial<ParsedResume> | null> {
  const position =
    total > 1 ? `This is part ${index + 1} of ${total} of one resume. Extract only what appears here.\n\n` : '';
  const user = `${position}Resume text:\n"""\n${chunk}\n"""\n\nReturn the JSON object now.`;
  try {
    const { text } = await completeReply(SYSTEM, user, { temperature: 0.1, maxTokens: 1200 });
    return text ? extractJson(text) : null;
  } catch (err) {
    console.warn(`[resume/parse] chunk ${index + 1}/${total} failed:`, (err as Error)?.message);
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

  const rawText = text.trim().slice(0, MAX_RAW);
  // Deterministic baseline — always computed, merged under the model output.
  const baseline = regexExtract(rawText);

  if (!hasAnyProvider()) {
    return res.status(200).json({
      resume: toResumeContext(baseline, rawText),
      degraded: true,
      source: 'heuristic',
      reason: 'No AI provider configured; used heading-based extraction.',
    });
  }

  const chunks = chunkResume(rawText);
  if (chunks.length === 0) {
    return res.status(400).json({ error: 'Resume text is empty after trimming.' });
  }

  try {
    const results = await Promise.all(chunks.map((chunk, i) => parseChunk(chunk, i, chunks.length)));
    const modelParts = results.filter(Boolean) as Array<Partial<ParsedResume>>;

    if (modelParts.length === 0) {
      return res.status(200).json({
        resume: toResumeContext(baseline, rawText),
        degraded: true,
        source: 'heuristic',
        chunks: chunks.length,
        reason: 'The model returned no usable JSON; used heading-based extraction.',
      });
    }

    // Model output first (higher quality wins scalar fields), heuristics merged
    // underneath so items the model skipped are still available.
    const merged = mergeParsed(...modelParts, baseline);
    const empty = isEmptyParse(merged);

    return res.status(200).json({
      resume: toResumeContext(merged, rawText),
      degraded: empty,
      source: modelParts.length === chunks.length ? 'model' : 'partial',
      chunks: chunks.length,
      ...(empty ? { reason: 'Nothing extractable was found in this document.' } : {}),
    });
  } catch (err) {
    console.error('[resume/parse] error:', (err as Error)?.message);
    return res.status(200).json({
      resume: toResumeContext(baseline, rawText),
      degraded: true,
      source: 'heuristic',
      error: (err as Error)?.message,
    });
  }
}
