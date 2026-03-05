/**
 * Firebase Resume Service
 * Fetches resume data from Firebase for interview rounds
 */

import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';

export interface ResumeData {
  skills: string[];
  projects: string[];
  achievements: string[];
  experience: string[];
  education: string[];
}

/**
 * Fetch resume data from Firebase for a specific user
 */
export const fetchResumeDataFromFirebase = async (userId: string): Promise<ResumeData | null> => {
  try {
    console.log('Fetching resume data from Firebase for user:', userId);
    
    // Try to get resume data from user's resume collection
    const resumeDocRef = doc(db, 'users', userId, 'resumes', 'latest');
    const resumeDoc = await getDoc(resumeDocRef);
    
    if (resumeDoc.exists()) {
      const data = resumeDoc.data();
      console.log('Found resume data in Firebase:', data);
      
      return {
        skills: data.skills || [],
        projects: data.projects || [],
        achievements: data.achievements || [],
        experience: data.experience || [],
        education: data.education || []
      };
    } else {
      console.log('No resume data found in Firebase');
      return null;
    }
  } catch (error) {
    console.error('Error fetching resume data from Firebase:', error);
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
      console.log('Found resume data in localStorage:', parsed);
      return parsed;
    }
    return null;
  } catch (error) {
    console.error('Error parsing resume data from localStorage:', error);
    return null;
  }
};

/**
 * Get resume data from Firebase or localStorage fallback
 */
export const getResumeData = async (userId: string): Promise<ResumeData | null> => {
  // First try Firebase
  const firebaseData = await fetchResumeDataFromFirebase(userId);
  if (firebaseData) {
    return firebaseData;
  }
  
  // Fallback to localStorage
  const localData = fetchResumeDataFromLocalStorage();
  if (localData) {
    console.log('Using resume data from localStorage as fallback');
    return localData;
  }
  
  console.warn('No resume data found in Firebase or localStorage');
  return null;
};



