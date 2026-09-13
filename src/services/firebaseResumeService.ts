/**
 * Resume reads for the interview flow.
 *
 * Supabase is the source of truth; localStorage is a cache that keeps the
 * round pages instant and lets the interview run offline after one successful
 * load. (Named `firebaseResumeService` for historical reasons — Firebase is
 * auth only.)
 */

import { logger } from '../lib/logger';
import { supabaseInterviewService } from './supabaseInterviewService';
import { RESUME_CACHE_KEY, RESUME_TEXT_CACHE_KEY, type ParsedResume } from './resumeService';

export type ResumeData = ParsedResume;

const asList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0) : [];

function normalize(raw: unknown): ResumeData | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const data: ResumeData = {
    name: typeof r.name === 'string' && r.name ? r.name : undefined,
    title: typeof r.title === 'string' && r.title ? r.title : undefined,
    summary: typeof r.summary === 'string' && r.summary ? r.summary : undefined,
    skills: asList(r.skills),
    projects: asList(r.projects),
    achievements: asList(r.achievements),
    experience: asList(r.experience),
    education: asList(r.education),
  };
  const empty =
    data.skills.length === 0 &&
    data.projects.length === 0 &&
    data.achievements.length === 0 &&
    data.experience.length === 0 &&
    data.education.length === 0;
  return empty ? null : data;
}

/** Read the cached resume written after a successful parse. */
export const fetchResumeDataFromLocalStorage = (): ResumeData | null => {
  try {
    const cached = localStorage.getItem(RESUME_CACHE_KEY);
    return cached ? normalize(JSON.parse(cached)) : null;
  } catch (err) {
    logger.warn('[resume] could not read cache:', (err as Error)?.message);
    return null;
  }
};

/** Raw resume text, when it was cached alongside the structured parse. */
export const fetchResumeTextFromLocalStorage = (): string | null => {
  try {
    return localStorage.getItem(RESUME_TEXT_CACHE_KEY);
  } catch {
    return null;
  }
};

/** Fetch the latest parsed resume for a user from Supabase. */
export const fetchResumeDataFromSupabase = async (userId: string): Promise<ResumeData | null> => {
  try {
    return normalize(await supabaseInterviewService.getUserResume(userId));
  } catch (err) {
    logger.warn('[resume] Supabase fetch failed:', (err as Error)?.message);
    return null;
  }
};

/**
 * Preferred read path: Supabase first, then the local cache. A successful
 * remote read refreshes the cache so later pages skip the round trip.
 */
export const getResumeData = async (userId: string): Promise<ResumeData | null> => {
  const remote = await fetchResumeDataFromSupabase(userId);
  if (remote) {
    try {
      localStorage.setItem(RESUME_CACHE_KEY, JSON.stringify(remote));
    } catch {
      // Cache refresh is best-effort.
    }
    return remote;
  }

  const cached = fetchResumeDataFromLocalStorage();
  if (cached) logger.info('[resume] using cached resume');
  return cached;
};
