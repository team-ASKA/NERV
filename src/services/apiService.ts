/**
 * API Service for communicating with the backend interview API
 */
import { openAI } from './openAIService';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface TechnicalRoundRequest {
  emotion: string;
  last_answer?: string;
  round: string;
}

export interface ProjectRoundRequest {
  emotion: string;
  last_answer?: string;
  projects: string[];
  skills: string[];
  round: string;
}

export interface HRRoundRequest {
  emotion: string;
  last_answer?: string;
  experiences: string[];
  achievements: string[];
  round: string;
}

export interface APIResponse {
  question: string;
  round: string;
  conversation_id: string;
}

class APIService {
  private async makeRequest<T>(endpoint: string, data: any, conversationId?: string): Promise<T> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (conversationId) {
        headers['X-Conversation-Id'] = conversationId;
      }

      console.log(`[APIService] Making request to: ${API_BASE_URL}${endpoint}`);
      console.log(`[APIService] Request data:`, data);
      console.log(`[APIService] Headers:`, headers);
      console.log(`[APIService] Full URL:`, `${API_BASE_URL}${endpoint}`);

      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(data),
      });

      console.log(`[APIService] Response status: ${response.status}`);
      console.log(`[APIService] Response headers:`, Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[APIService] Error response:`, errorText);
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
      }

      const result = await response.json();
      console.log(`[APIService] Success response:`, result);
      return result;
    } catch (error) {
      console.error(`[APIService] Request failed for ${endpoint}:`, error);
      throw error;
    }
  }

  async getTechnicalQuestion(request: TechnicalRoundRequest, conversationId?: string): Promise<APIResponse> {
    return this.makeRequest<APIResponse>('/api/technical', request, conversationId);
  }

  async getProjectQuestion(request: ProjectRoundRequest, conversationId?: string): Promise<APIResponse> {
    return this.makeRequest<APIResponse>('/api/project', request, conversationId);
  }

  async getHRQuestion(request: HRRoundRequest, conversationId?: string): Promise<APIResponse> {
    return this.makeRequest<APIResponse>('/api/hr', request, conversationId);
  }

  // History fetching methods
  async getTechnicalHistory(conversationId: string, limit: number = 50): Promise<any> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/history/technical?conversation_id=${conversationId}&limit=${limit}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Conversation-Id': conversationId
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Failed to fetch technical history:', error);
      throw error;
    }
  }

  async getProjectHistory(conversationId: string, limit: number = 50): Promise<any> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/history/project?conversation_id=${conversationId}&limit=${limit}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Conversation-Id': conversationId
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Failed to fetch project history:', error);
      throw error;
    }
  }

  async getHRHistory(conversationId: string, limit: number = 50): Promise<any> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/history/hr?conversation_id=${conversationId}&limit=${limit}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Conversation-Id': conversationId
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Failed to fetch HR history:', error);
      throw error;
    }
  }

  // Generate comprehensive interview summary
  async generateInterviewSummary(
    technicalHistory: any,
    projectHistory: any,
    hrHistory: any,
    resumeData: any,
    questionExpressions: Map<string, any>
  ): Promise<string> {
    try {
      const expressionsArray = Array.from(questionExpressions.entries()).map(([qId, expr]) => ({
        questionId: qId,
        emotion: expr.dominantEmotion,
        confidence: expr.confidenceScore,
        isConfident: expr.isConfident,
        isStruggling: expr.isStruggling
      }));

      // Call the AI Service to generate the comprehensive summary using Groq
      const summaryMarkdown = await openAI.generateComprehensiveSummary(
        technicalHistory,
        projectHistory,
        hrHistory,
        resumeData,
        expressionsArray
      );

      return summaryMarkdown;
    } catch (error) {
      console.error('Failed to generate summary:', error);
      // Fallback to local summary generation
      return this.generateLocalSummary(technicalHistory, projectHistory, hrHistory, resumeData, questionExpressions);
    }
  }

  private generateLocalSummary(
    technicalHistory: any,
    projectHistory: any,
    hrHistory: any,
    resumeData: any,
    questionExpressions: Map<string, any>
  ): string {
    // Create a comprehensive local summary
    const emotions = Array.from(questionExpressions.values());
    const avgConfidence = emotions.length > 0 ? emotions.reduce((sum, expr) => sum + expr.confidenceScore, 0) / emotions.length : 0;

    return `
# Interview Summary Report

## Performance Overview
- **Overall Confidence**: ${(avgConfidence * 100).toFixed(1)}%
- **Technical Questions**: ${technicalHistory?.messages?.length || 0}
- **Project Questions**: ${projectHistory?.messages?.length || 0}
- **HR Questions**: ${hrHistory?.messages?.length || 0}

## Skills Analysis
- **Resume Skills**: ${resumeData?.skills?.join(', ') || 'Not available'}
- **Projects**: ${resumeData?.projects?.length || 0} projects listed
- **Experience**: ${resumeData?.experience?.length || 0} experiences

## Recommendations
1. Focus on improving technical problem-solving skills
2. Practice explaining complex concepts clearly
3. Work on confidence in technical discussions

## Resources
- LeetCode for DSA practice
- System Design Interview books
- Mock interview platforms
    `.trim();
  }
}

export const apiService = new APIService();