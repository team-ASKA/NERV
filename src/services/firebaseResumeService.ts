/**
 * Supabase Resume Service (Formerly Firebase)
 * Fetches resume data from Supabase for interview rounds
 */

import { supabaseInterviewService } from './supabaseInterviewService';

export interface ResumeData {
  skills: string[];
  projects: string[];
  achievements: string[];
  experience: string[];
  education: string[];
}

/**
 * Fetch resume data from Supabase for a specific user
 */
export const fetchResumeDataFromSupabase = async (userId: string): Promise<ResumeData | null> => {
  try {
    console.log('Fetching resume data from Supabase for user:', userId);
    
    // Get resume data from user's record
    const data = await supabaseInterviewService.getUserResume(userId);
    
    if (data) {
      console.log('Found resume data in Supabase');
      return {
        skills: data.skills || [],
        projects: data.projects || [],
        achievements: data.achievements || [],
        experience: data.experience || [],
        education: data.education || []
      };
    } else {
      console.log('No resume data found in Supabase');
      return null;
    }
  } catch (error) {
    console.error('Error fetching resume data from Supabase:', error);
    return null;
  }
};

/**
 * Fetch resume data from localStorage as fallback
 */
export const fetchResumeDataFromLocalStorage = (): ResumeData | null => {
  try {
    const savedResumeData = localStorage.getItem('resumeData');
    if (savedResumeData) {
      const parsed = JSON.parse(savedResumeData);
      console.log('Found resume data in localStorage');
      return parsed;
    }
    return null;
  } catch (error) {
    console.error('Error parsing resume data from localStorage:', error);
    return null;
  }
};

/**
 * Get resume data from Supabase or localStorage fallback
 */
export const getResumeData = async (userId: string): Promise<ResumeData | null> => {
  // First try Supabase
  const supabaseData = await fetchResumeDataFromSupabase(userId);
  if (supabaseData) {
    return supabaseData;
  }
  
  // Fallback to localStorage
  const localData = fetchResumeDataFromLocalStorage();
  if (localData) {
    console.log('Using resume data from localStorage as fallback');
    return localData;
  }
  
  console.warn('No resume data found in Supabase or localStorage');
  return null;
};
