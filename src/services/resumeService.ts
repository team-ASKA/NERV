/**
 * Resume service (client). Text extraction stays in the browser (pdf.js); all
 * parsing happens server-side at `/api/resume/parse`, so no AI key is ever
 * shipped to the client.
 *
 * Storage is deliberately simple: one write to Supabase (source of truth) plus
 * a localStorage cache for instant reads between rounds. Nothing else.
 */

import { logger } from '../lib/logger';
import { authedFetch } from '../lib/authedFetch';
import {
  IngestUnavailableError,
  ingestResumeFile,
  type IngestProgress,
} from './resumeIngestService';
import { supabaseInterviewService } from './supabaseInterviewService';

export type { IngestProgress };

export interface ResumeData {
  skills: string[];
  projects: string[];
  achievements: string[];
  experience: string[];
  education: string[];
}

/** What the parser returns: `ResumeData` plus optional identity fields. */
export interface ParsedResume extends ResumeData {
  name?: string;
  title?: string;
  summary?: string;
  rawText?: string;
}

export interface ParseResult {
  resume: ParsedResume;
  /** true when the parse fell back to heuristics or found nothing. */
  degraded: boolean;
  /** Human-readable explanation when degraded. */
  reason?: string;
  source?: 'model' | 'partial' | 'heuristic';
}

/** localStorage cache keys — read by `firebaseResumeService` as well. */
export const RESUME_CACHE_KEY = 'resumeData';
export const RESUME_TEXT_CACHE_KEY = 'resumeText';

const EMPTY: ResumeData = { skills: [], projects: [], achievements: [], experience: [], education: [] };

const asList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0) : [];

function normalize(raw: unknown, fallbackText?: string): ParsedResume {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    name: typeof r.name === 'string' && r.name ? r.name : undefined,
    title: typeof r.title === 'string' && r.title ? r.title : undefined,
    summary: typeof r.summary === 'string' && r.summary ? r.summary : undefined,
    skills: asList(r.skills),
    projects: asList(r.projects),
    achievements: asList(r.achievements),
    experience: asList(r.experience),
    education: asList(r.education),
    rawText: typeof r.rawText === 'string' ? r.rawText : fallbackText,
  };
}

const isEmpty = (r: ResumeData) =>
  r.skills.length === 0 &&
  r.projects.length === 0 &&
  r.achievements.length === 0 &&
  r.experience.length === 0 &&
  r.education.length === 0;

/**
 * Parse resume text on the server. Never throws — a failure returns an empty
 * resume flagged `degraded`, so the caller can tell the candidate that
 * questions will be generic rather than crashing the upload.
 */
export async function parseResumeText(text: string): Promise<ParseResult> {
  if (!text || text.trim().length < 20) {
    return { resume: { ...EMPTY, rawText: text }, degraded: true, reason: 'Not enough text to parse.' };
  }

  try {
    const res = await authedFetch('/api/resume/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      logger.warn('[resume] parse failed:', res.status, detail.slice(0, 200));
      return {
        resume: { ...EMPTY, rawText: text },
        degraded: true,
        reason: 'Resume parsing is unavailable right now. Questions will be general.',
      };
    }

    const data = (await res.json()) as {
      resume?: unknown;
      degraded?: boolean;
      reason?: string;
      source?: ParseResult['source'];
    };
    const resume = normalize(data.resume, text);

    return {
      resume,
      degraded: Boolean(data.degraded) || isEmpty(resume),
      reason: data.reason,
      source: data.source,
    };
  } catch (err) {
    logger.warn('[resume] parse request failed:', (err as Error)?.message);
    return {
      resume: { ...EMPTY, rawText: text },
      degraded: true,
      reason: 'Could not reach the parser. Questions will be general.',
    };
  }
}

/** Cache the parsed resume for instant reads on later pages. */
export function cacheResume(resume: ParsedResume, rawText?: string): void {
  try {
    const { rawText: _ignored, ...data } = resume;
    localStorage.setItem(RESUME_CACHE_KEY, JSON.stringify(data));
    // Only overwrite the text cache when we actually have text. The queue path
    // never sees the raw text — the worker extracts it server-side — and
    // clobbering a good cache with an empty string would be a regression.
    if (rawText && rawText.trim()) localStorage.setItem(RESUME_TEXT_CACHE_KEY, rawText);
  } catch (err) {
    logger.warn('[resume] could not cache resume:', (err as Error)?.message);
  }
}

export function clearCachedResume(): void {
  try {
    localStorage.removeItem(RESUME_CACHE_KEY);
    localStorage.removeItem(RESUME_TEXT_CACHE_KEY);
  } catch {
    // Nothing to do — a failed clear is not worth surfacing.
  }
}

export interface ExtractResult extends ParseResult {
  resumeId: string;
  /** Kept for the existing Dashboard call site. */
  resumeData: ParsedResume;
  /** true when the resume parsed but could not be persisted remotely. */
  saveFailed: boolean;
}

/** Empty strings from the queue payload become `undefined`, as elsewhere here. */
const orUndefined = (value: string): string | undefined => (value.trim() ? value : undefined);

/**
 * Full upload path.
 *
 * Preferred: hand the file to the ingestion queue, which uploads the bytes
 * directly to storage and does the extraction on a worker — the only way a
 * scanned or multi-column resume gets read properly, since that needs a vision
 * model and tens of seconds neither the browser nor a serverless function
 * should be holding open.
 *
 * Fallback: the original synchronous path (client-side pdf.js → server parse),
 * used verbatim when the queue is not deployed or configured. Behaviour with no
 * ingestion env vars is therefore exactly what it was before.
 */
export async function extractAndSaveResume(
  userId: string,
  file: File,
  onProgress?: (progress: IngestProgress) => void,
): Promise<ExtractResult> {
  try {
    const ingested = await ingestResumeFile(file, onProgress);
    const resume: ParsedResume = {
      name: orUndefined(ingested.resume.name),
      title: orUndefined(ingested.resume.title),
      summary: orUndefined(ingested.resume.summary),
      skills: ingested.resume.skills,
      projects: ingested.resume.projects,
      achievements: ingested.resume.achievements,
      experience: ingested.resume.experience,
      education: ingested.resume.education,
    };

    logger.info('[resume] ingested', {
      strategy: ingested.strategy,
      words: ingested.wordCount,
      pages: ingested.pageCount,
      skills: resume.skills.length,
      projects: resume.projects.length,
    });

    // The worker already wrote this to the database under a per-user lock;
    // saving again here would be a duplicate write and a second source of truth.
    cacheResume(resume);

    return {
      resume,
      resumeData: resume,
      resumeId: ingested.jobId,
      degraded: false,
      source: 'model',
      saveFailed: false,
    };
  } catch (err) {
    if (!(err instanceof IngestUnavailableError)) throw err;
    logger.info('[resume] ingestion queue unavailable; using the direct parser');
  }

  const { extractTextFromPDF } = await import('./pdfService');
  const rawText = await extractTextFromPDF(file);

  if (!rawText || rawText.trim().length < 50) {
    throw new Error(
      'Could not read text from that PDF. If it is a scan or an image export, please upload a text-based PDF.',
    );
  }

  const parsed = await parseResumeText(rawText);
  const resumeId = `resume_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

  logger.info('[resume] parsed', {
    source: parsed.source,
    skills: parsed.resume.skills.length,
    projects: parsed.resume.projects.length,
    experience: parsed.resume.experience.length,
  });

  let saveFailed = false;
  try {
    const { rawText: _ignored, ...data } = parsed.resume;
    await supabaseInterviewService.saveUserResume(userId, data, rawText);
  } catch (err) {
    saveFailed = true;
    logger.warn('[resume] Supabase save failed; keeping local cache only:', (err as Error)?.message);
  }

  cacheResume(parsed.resume, rawText);

  return { ...parsed, resumeId, resumeData: parsed.resume, saveFailed };
}
