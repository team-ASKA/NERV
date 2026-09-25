/**
 * The opening question for a round, fetched ahead of being needed.
 *
 * The worker writes one opener per round as soon as a resume is ingested, so the
 * first question of an interview can be spoken with no model call at all. This
 * hook pulls them while the candidate is reading the round intro; by the time
 * they press Start the answer is already in memory.
 *
 * A miss costs nothing. `opener` is simply undefined and the session streams
 * question one the way it always has — priming is an optimisation, never a
 * dependency.
 */

import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { fetchPrimedOpeners, type PrimedOpeners } from '../services/interviewService';
import type { Round } from '../types/interview';

export function usePrimedOpeners(round: Round): string | undefined {
  const { currentUser } = useAuth();
  const [openers, setOpeners] = useState<PrimedOpeners>({});

  useEffect(() => {
    if (!currentUser?.uid) return;
    const controller = new AbortController();
    let cancelled = false;

    void fetchPrimedOpeners(controller.signal).then((result) => {
      if (!cancelled) setOpeners(result);
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [currentUser?.uid]);

  return openers[round];
}

export default usePrimedOpeners;
