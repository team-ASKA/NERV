/**
 * Resume parsing for the API layer.
 *
 * The parsing logic itself lives in `shared/resumeParse` so the BullMQ worker
 * and these serverless handlers extract identically — a resume ingested by one
 * path and re-parsed by the other must yield the same structure, or the
 * interviewer's grounding would change depending on which ran. This module adds
 * only the piece that is API-specific: widening a parse into the engine's
 * `ResumeContext`.
 */

export * from '../../shared/resumeParse';

import type { ParsedResume } from '../../shared/resumeParse';
import type { ResumeContext } from './session';

/** Widen a ParsedResume into the ResumeContext shape the engine consumes. */
export function toResumeContext(parsed: ParsedResume, rawText?: string): ResumeContext {
  return {
    name: parsed.name || undefined,
    title: parsed.title || undefined,
    summary: parsed.summary || undefined,
    skills: parsed.skills,
    projects: parsed.projects,
    achievements: parsed.achievements,
    experience: parsed.experience,
    education: parsed.education,
    rawText,
  };
}
