/** Composed dashboard data from GET /api/dashboard with section-level errors. */
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiClient';
import { useAuth } from '../contexts/AuthContext';

export interface DashboardData {
  profile: { displayName: string; preferences: Record<string, unknown> } | null;
  currentResume: {
    id: string;
    name: string;
    title?: string;
    skills: string[];
    reviewState: string;
    warnings: string[];
  } | null;
  activeSession: { id: string; status: string; currentRound: string } | null;
  latestReport: { sessionId: string; status: string } | null;
  recentSessions: Array<{ id: string; status: string; currentRound: string; updatedAt: string }>;
  practiceSuggestion: { topicId: string; label: string; reason: string } | null;
  errors: Record<string, string>;
}

const EMPTY: DashboardData = {
  profile: null,
  currentResume: null,
  activeSession: null,
  latestReport: null,
  recentSessions: [],
  practiceSuggestion: null,
  errors: {},
};

export function useDashboardData() {
  const { currentUser } = useAuth();
  const [data, setData] = useState<DashboardData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!currentUser) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const d = await apiFetch<DashboardData>('/api/dashboard');
      setData({ ...EMPTY, ...d, errors: d.errors ?? {} });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}
