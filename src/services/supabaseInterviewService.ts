import { supabase } from '../lib/supabase';

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
      console.error('Error saving interview to Supabase:', error);
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
      console.error('Error fetching interivews from Supabase:', error);
      throw error;
    }
  },

  /**
   * Save a user's parsed resume to Supabase
   */
  async saveUserResume(userId: string, resumeData: any, rawText?: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('resumes')
        .insert([
          {
            user_id: userId,
            resume_data: resumeData,
            raw_text: rawText || null,
          }
        ]);

      if (error) throw error;
      console.log('[SupabaseService] ✅ Saved resume to Supabase successfully');
    } catch (error) {
      console.error('[SupabaseService] ❌ Error saving resume to Supabase:', error);
      throw error;
    }
  },

  /**
   * Fetch a user's latest parsed resume from Supabase
   */
  async getUserResume(userId: string): Promise<any | null> {
    try {
      const { data, error } = await supabase
        .from('resumes')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 is "Row not found"
        throw error;
      }

      return data ? data.resume_data : null;
    } catch (error) {
      console.error('[SupabaseService] ❌ Error fetching resume from Supabase:', error);
      return null;
    }
  }
};
