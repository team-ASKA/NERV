/**
 * Raw resume text → the structured record the interviewer grounds questions in.
 *
 * Two extractors run and are merged: the deterministic heading parser, which
 * costs nothing and never hallucinates, and the model, which handles the
 * layouts headings alone cannot. Model output takes precedence for scalars and
 * the two are unioned for lists, so a model that misses a section cannot delete
 * what the regex found — and a model that is unavailable degrades to a usable
 * parse instead of a failure.
 */

import {
  chunkResume,
  coerceParsed,
  mergeParsed,
  regexExtract,
  type ParsedResume,
} from '../../../shared/resumeParse.js';
import { hasModelProvider, logger } from '../config.js';
import { completeJson, extractJson } from '../llm/groq.js';

const SYSTEM = `You extract structured data from resume text. You are an extractor, not an author.

Return a single JSON object with exactly these keys:
{
  "name": string,          // the candidate's full name, "" if not present
  "title": string,         // their stated role or headline, "" if not present
  "summary": string,       // their own summary/objective text, "" if not present
  "skills": string[],      // technologies, languages, tools — as written
  "projects": string[],    // one entry per project: "Name — what it does, tech used"
  "achievements": string[],// awards, rankings, quantified wins
  "experience": string[],  // one entry per role: "Title, Company (dates) — what they did"
  "education": string[]    // degrees, institutions, certifications
}

Rules:
- Only include information that is literally present in the text. Never infer, embellish, or add plausible details.
- If a section is absent, return an empty array or empty string. An empty field is correct; an invented one is not.
- Preserve the candidate's own wording for skills and technology names.
- Keep each list entry under 200 characters.
- Output only the JSON object.`;

function prompt(chunk: string, index: number, total: number): string {
  const scope =
    total > 1
      ? `This is part ${index + 1} of ${total} of one resume. Extract only what appears in this part; other parts are handled separately.\n\n`
      : '';
  return `${scope}Resume text:\n"""\n${chunk}\n"""`;
}

export interface StructureResult {
  parsed: ParsedResume;
  /** False when the parse came from headings alone. Surfaced, not hidden. */
  usedModel: boolean;
  chunks: number;
}

export async function structureResume(text: string): Promise<StructureResult> {
  const baseline = regexExtract(text);

  if (!hasModelProvider()) {
    logger.warn('no model provider configured; using heuristic extraction only');
    return { parsed: baseline, usedModel: false, chunks: 0 };
  }

  const chunks = chunkResume(text);
  if (chunks.length === 0) return { parsed: baseline, usedModel: false, chunks: 0 };

  // Chunks are independent, so issue them together and let the token bucket
  // decide the real pacing. A chunk that fails is dropped, not fatal: a partial
  // model parse merged over the baseline still beats the baseline alone.
  const settled = await Promise.allSettled(
    chunks.map(async (chunk, i) => {
      const raw = await completeJson(SYSTEM, prompt(chunk, i, chunks.length));
      const json = extractJson(raw);
      if (json === null) throw new Error('model output was not JSON');
      return coerceParsed(json);
    }),
  );

  const parts: ParsedResume[] = [];
  for (const [i, result] of settled.entries()) {
    if (result.status === 'fulfilled') parts.push(result.value);
    else logger.warn({ chunk: i, err: (result.reason as Error).message }, 'chunk extraction failed');
  }

  if (parts.length === 0) {
    return { parsed: baseline, usedModel: false, chunks: chunks.length };
  }

  // Model parts first so their scalars win; baseline last so its list items
  // survive as a floor.
  return {
    parsed: mergeParsed(...parts, baseline),
    usedModel: true,
    chunks: chunks.length,
  };
}
