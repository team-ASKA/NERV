/**
 * Loads the candidate's parsed resume for an interview round.
 *
 * Order of preference: state handed over from the previous route (no refetch
 * between rounds) → Supabase for the signed-in user → the localStorage cache.
 * A missing resume is not fatal: the interviewer falls back to general
 * questions, and the caller can surface that.
 */

import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { EMPTY_RESUME, type ResumeContext } from '../types/interview';
import { fetchResumeDataFromLocalStorage, getResumeData } from '../services/firebaseResumeService';
import { logger } from '../lib/logger';

export interface ResumeContextState {
  resume: ResumeContext | null;
  loading: boolean;
  /** True when no resume could be found anywhere. */
  missing: boolean;
}

function toContext(raw: Partial<ResumeContext> | null | undefined): ResumeContext | null {
  if (!raw) return null;
  const context: ResumeContext = {
    ...EMPTY_RESUME,
    ...raw,
    skills: raw.skills ?? [],
    projects: raw.projects ?? [],
    achievements: raw.achievements ?? [],
    experience: raw.experience ?? [],
    education: raw.education ?? [],
  };
  const hasContent =
    context.skills.length +
      context.projects.length +
      context.achievements.length +
      context.experience.length +
      context.education.length >
    0;
  return hasContent ? context : null;
}

export function useResumeContext(seed?: Partial<ResumeContext> | null): ResumeContextState {
  const { currentUser } = useAuth();
  const seeded = toContext(seed);

  const [resume, setResume] = useState<ResumeContext | null>(seeded);
  const [loading, setLoading] = useState(!seeded);

  useEffect(() => {
    if (seeded) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const uid = currentUser?.uid;
        const data = uid ? await getResumeData(uid) : fetchResumeDataFromLocalStorage();
        if (!cancelled) setResume(toContext(data));
      } catch (err) {
        logger.warn('[resume] load failed', (err as Error)?.message);
        if (!cancelled) setResume(toContext(fetchResumeDataFromLocalStorage()));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // `seeded` is derived from props and stable per navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid, Boolean(seeded)]);

  return { resume, loading, missing: !loading && !resume };
}

export default useResumeContext;
