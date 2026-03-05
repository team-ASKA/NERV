/**
 * Performance Tracking Service for Interview Analytics
 * Stores and retrieves interview performance data from Firebase
 */

import { 
  collection, 
  addDoc, 
  getDocs, 
  query, 
  where, 
  orderBy, 
  limit,
  doc,
  updateDoc,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { db } from '../lib/firebase';

export interface InterviewPerformance {
  id?: string;
  userId: string;
  interviewDate: Date;
  sessionId: string;
  
  // Overall Performance Metrics
  totalQuestions: number;
  avgConfidence: number;
  confidentQuestions: number;
  nervousQuestions: number;
  strugglingQuestions: number;
  
  // Emotion Analysis
  emotionBreakdown: {
    [emotion: string]: number;
  };
  dominantEmotion: string;
  
  // ATS Score
  atsScore: number;
  atsBreakdown: {
    skills: number;
    experience: number;
    projects: number;
    education: number;
    achievements: number;
  };
  
  // Round-wise Performance
  technicalRound: {
    questionsAnswered: number;
    avgConfidence: number;
    dominantEmotion: string;
  };
  projectRound: {
    questionsAnswered: number;
    avgConfidence: number;
    dominantEmotion: string;
  };
  hrRound: {
    questionsAnswered: number;
    avgConfidence: number;
    dominantEmotion: string;
  };
  
  // AI Analysis
  aiSummary: string;
  skillGaps: string[];
  recommendations: string[];
  
  // Resume Data
  resumeSkills: string[];
  resumeProjects: string[];
  resumeExperience: string[];
  
  // Timestamps
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PerformanceTrend {
  interviewDate: string;
  atsScore: number;
  avgConfidence: number;
  totalQuestions: number;
  dominantEmotion: string;
}

class PerformanceService {
  private collectionName = 'interviewPerformance';

  /**
   * Save interview performance data to Firebase
   */
  async saveInterviewPerformance(
    userId: string,
    sessionId: string,
    performanceData: Omit<InterviewPerformance, 'id' | 'userId' | 'sessionId' | 'createdAt' | 'updatedAt'>
  ): Promise<string> {
    try {
      console.log('[PerformanceService] Saving interview performance for user:', userId);
      
      const performanceDoc = {
        userId,
        sessionId,
        interviewDate: performanceData.interviewDate,
        ...performanceData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      const docRef = await addDoc(collection(db, this.collectionName), performanceDoc);
      console.log('[PerformanceService] Performance data saved with ID:', docRef.id);
      
      return docRef.id;
    } catch (error) {
      console.error('[PerformanceService] Error saving performance data:', error);
      throw new Error('Failed to save interview performance');
    }
  }

  /**
   * Get all interview performances for a user
   */
  async getUserPerformances(userId: string, limitCount: number = 10): Promise<InterviewPerformance[]> {
    try {
      console.log('[PerformanceService] Fetching performances for user:', userId);
      
      const q = query(
        collection(db, this.collectionName),
        where('userId', '==', userId),
        orderBy('interviewDate', 'desc'),
        limit(limitCount)
      );

      const querySnapshot = await getDocs(q);
      const performances: InterviewPerformance[] = [];

      querySnapshot.forEach((doc) => {
        const data = doc.data();
        performances.push({
          id: doc.id,
          ...data,
          interviewDate: data.interviewDate?.toDate() || new Date(),
          createdAt: data.createdAt,
          updatedAt: data.updatedAt
        } as InterviewPerformance);
      });

      console.log('[PerformanceService] Retrieved', performances.length, 'performances');
      return performances;
    } catch (error) {
      console.error('[PerformanceService] Error fetching performances:', error);
      throw new Error('Failed to fetch interview performances');
    }
  }

  /**
   * Get performance trends for analytics
   */
  async getPerformanceTrends(userId: string, limitCount: number = 20): Promise<PerformanceTrend[]> {
    try {
      const performances = await this.getUserPerformances(userId, limitCount);
      
      return performances.map(perf => ({
        interviewDate: perf.interviewDate.toISOString().split('T')[0],
        atsScore: perf.atsScore,
        avgConfidence: perf.avgConfidence,
        totalQuestions: perf.totalQuestions,
        dominantEmotion: perf.dominantEmotion
      }));
    } catch (error) {
      console.error('[PerformanceService] Error fetching trends:', error);
      throw new Error('Failed to fetch performance trends');
    }
  }

  /**
   * Get latest performance for comparison
   */
  async getLatestPerformance(userId: string): Promise<InterviewPerformance | null> {
    try {
      const performances = await this.getUserPerformances(userId, 1);
      return performances.length > 0 ? performances[0] : null;
    } catch (error) {
      console.error('[PerformanceService] Error fetching latest performance:', error);
      return null;
    }
  }

  /**
   * Calculate performance improvement
   */
  calculateImprovement(current: InterviewPerformance, previous: InterviewPerformance): {
    atsScoreImprovement: number;
    confidenceImprovement: number;
    questionsImprovement: number;
    overallImprovement: number;
  } {
    const atsScoreImprovement = current.atsScore - previous.atsScore;
    const confidenceImprovement = current.avgConfidence - previous.avgConfidence;
    const questionsImprovement = current.totalQuestions - previous.totalQuestions;
    
    // Overall improvement score (weighted average)
    const overallImprovement = (
      atsScoreImprovement * 0.4 + 
      confidenceImprovement * 100 * 0.3 + 
      questionsImprovement * 0.3
    );

    return {
      atsScoreImprovement,
      confidenceImprovement,
      questionsImprovement,
      overallImprovement
    };
  }
}

export const performanceService = new PerformanceService();
export default performanceService;



