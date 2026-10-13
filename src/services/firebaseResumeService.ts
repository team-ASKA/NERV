/**
 * Resume reads for the interview flow.
 *
 * API is the source of truth; UID-scoped localStorage is a cache that keeps
 * the round pages instant. The old global keys were a cross-account leak
 * (user B could read user A's cache on lookup failure) — all reads/writes
 * are namespaced and late writes are guarded by the current account.
 */

import { logger } from '../lib/logger';
import { scopedKey, makeAccountGuard } from '../lib/accountCache';
import { supabaseInterviewService } from './supabaseInterviewService';
import { type ParsedResume } from './resumeService';

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

/** Read the UID-scoped cached resume. Never falls back to another account. */
export const fetchResumeDataFromLocalStorage = (uid?: string): ResumeData | null => {
  try {
    if (!uid) {
      // No identity: refuse the legacy global key outright.
      return null;
    }
    const cached = localStorage.getItem(scopedKey(uid, 'resumeData'));
    return cached ? normalize(JSON.parse(cached)) : null;
  } catch (err) {
    logger.warn('[resume] could not read cache:', (err as Error)?.message);
    return null;
  }
};

/** Raw resume text, when it was cached alongside the structured parse. */
export const fetchResumeTextFromLocalStorage = (uid?: string): string | null => {
  try {
    if (!uid) return null;
    return localStorage.getItem(scopedKey(uid, 'resumeText'));
  } catch {
    return null;
  }
};

/** Fetch the latest parsed resume for the CALLER via the API (UID from token). */
export const fetchResumeDataFromSupabase = async (userId: string): Promise<ResumeData | null> => {
  try {
    const guard = makeAccountGuard(() => userId);
    const resume = normalize(await supabaseInterviewService.getUserResume(userId));
    if (resume && guard.alive()) {
      guard.setLocal('resumeData', JSON.stringify(resume));
    }
    return resume;
  } catch (err) {
    logger.warn('[resume] API resume fetch failed:', (err as Error)?.message);
    return null;
  }
};

/**
 * Preferred read path: API first, then the CALLER's scoped cache only.
 * A failed remote read never substitutes another account's data.
 */
export const getResumeData = async (userId: string): Promise<ResumeData | null> => {
  const remote = await fetchResumeDataFromSupabase(userId);
  if (remote) return remote;
  const cached = fetchResumeDataFromLocalStorage(userId);
  if (cached) logger.info('[resume] using cached resume');
  return cached;
};
