import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

/** How many resume uploads to retain per user. */
const RESUME_HISTORY_LIMIT = 3;

export interface InterviewRecord {
  id?: string;
  user_id: string;
  created_at?: string;
  total_duration_minutes: number;
  overall_confidence: number;
  summary_markdown: string;
  questions_data: any;
  metrics: any;
}

export const supabaseInterviewService = {
  /**
   * Save an interview summary to Supabase
   */
  async saveInterviewSummary(interviewData: InterviewRecord): Promise<string> {
    try {
      const { data, error } = await supabase
        .from('interviews')
        .insert([
          {
            user_id: interviewData.user_id,
            total_duration_minutes: interviewData.total_duration_minutes,
            overall_confidence: interviewData.overall_confidence,
            summary_markdown: interviewData.summary_markdown,
            questions_data: interviewData.questions_data,
            metrics: interviewData.metrics,
          }
        ])
        .select('id')
        .single();

      if (error) throw error;
      return data.id;
    } catch (error) {
      logger.error('[supabase] interview save failed:', (error as Error)?.message);
      throw error;
    }
  },

  /**
   * Fetch a user's past interviews
   */
  async getUserInterviews(userId: string): Promise<InterviewRecord[]> {
    try {
      const { data, error } = await supabase
        .from('interviews')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      logger.error('[supabase] interview fetch failed:', (error as Error)?.message);
      throw error;
    }
  },

  /**
   * Delete one of a user's interviews. Scoped by `user_id` as well as `id` so a
   * stale id from another account can never remove someone else's row.
   */
  async deleteInterview(userId: string, interviewId: string): Promise<void> {
    const { error } = await supabase
      .from('interviews')
      .delete()
      .eq('id', interviewId)
      .eq('user_id', userId);

    if (error) throw error;
  },

  /**
   * Save a user's parsed resume. Inserts the new row, then prunes older ones so
   * a user who re-uploads repeatedly doesn't accumulate raw resume text
   * forever. Pruning is best-effort and never fails the save.
   */
  async saveUserResume(userId: string, resumeData: unknown, rawText?: string): Promise<void> {
    const { error } = await supabase
      .from('resumes')
      .insert([{ user_id: userId, resume_data: resumeData, raw_text: rawText || null }]);

    if (error) throw error;

    try {
      const { data: keep } = await supabase
        .from('resumes')
        .select('id')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(RESUME_HISTORY_LIMIT);

      const keepIds = (keep ?? []).map((r: { id: string }) => r.id);
      if (keepIds.length === RESUME_HISTORY_LIMIT) {
        await supabase
          .from('resumes')
          .delete()
          .eq('user_id', userId)
          .not('id', 'in', `(${keepIds.join(',')})`);
      }
    } catch {
      // Pruning is an optimisation, not a correctness requirement.
    }
  },

  /**
   * Fetch a user's latest parsed resume.
   */
  async getUserResume(userId: string): Promise<unknown | null> {
    const { data, error } = await supabase
      .from('resumes')
      .select('resume_data')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      logger.warn('[supabase] resume fetch failed:', error.message);
      return null;
    }
    return data ? (data as { resume_data: unknown }).resume_data : null;
  },
};
