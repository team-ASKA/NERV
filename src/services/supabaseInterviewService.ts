import { apiFetch } from '../lib/apiClient';
import { logger } from '../lib/logger';

/** How many resume uploads to retain per user. */
export const RESUME_HISTORY_LIMIT = 3;

export interface InterviewRecord {
  id?: string;
  user_id: string;
  created_at?: string;
  total_duration_minutes: number;
  overall_confidence: number;
  summary_markdown: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  questions_data: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metrics: any;
}

interface HistoryPage {
  items: InterviewRecord[];
  nextCursor: string | null;
}

/**
 * Browser data service — now API-backed (D2). No direct Supabase table
 * access remains in the browser; every call carries the Firebase ID token
 * and the server derives ownership from it. A caller-supplied userId is
 * never trusted for identity.
 */
export const supabaseInterviewService = {
  async saveInterviewSummary(): Promise<string> {
    // Legacy client-only save path: superseded by POST /sessions/:id/finalize
    // + report jobs (F01/F02). Kept as a typed stub so old callers fail
    // loudly instead of silently double-saving.
    logger.warn('[interviewService] direct saveInterviewSummary is retired; use session finalize.');
    throw new Error('Direct report save is retired. Finish the session to generate its report.');
  },

  async getUserInterviews(): Promise<InterviewRecord[]> {
    const page = await apiFetch<HistoryPage>('/api/history?limit=50');
    return page.items;
  },

  async getHistoryPage(cursor?: string | null, limit = 20): Promise<HistoryPage> {
    const q = new URLSearchParams({ limit: String(limit) });
    if (cursor) q.set('cursor', cursor);
    return apiFetch<HistoryPage>(`/api/history?${q.toString()}`);
  },

  async deleteInterview(id: string): Promise<void> {
    await apiFetch(`/api/reports/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  /**
   * Compat readers for the legacy direct-parse flow (resumeService), now
   * API-backed and UID-scoped. New code should use GET /api/resume/current
   * and the signed-upload ingest pipeline directly.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getUserResume(_userId: string): Promise<any | null> {
    try {
      const { resume } = await apiFetch<{ resume: unknown | null }>('/api/resume/current');
      return resume;
    } catch (e) {
      logger.warn('[interviewService] current resume fetch failed:', (e as Error)?.message);
      return null;
    }
  },

  async saveUserResume(
    _userId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any,
    _rawText?: string,
  ): Promise<string> {
    // Legacy local-parse persistence: revalidate through the reviewed-facts
    // endpoint against the current resume so edits become audited revisions
    // instead of silent overwrites.
    const { resume } = await apiFetch<{ resume: { id: string; version?: number } | null }>('/api/resume/current');
    if (!resume) throw new Error('No resume to update. Upload a PDF first.');
    const updated = await apiFetch<{ id: string; version: number }>(`/api/resume/${resume.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: data?.name,
        skills: data?.skills,
        projects: data?.projects,
        experience: data?.experience,
        expectedVersion: resume.version ?? 1,
      }),
    });
    return updated.id;
  },
};
