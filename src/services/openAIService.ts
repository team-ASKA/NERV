/**
 * Question Generation Service (powered by Groq Llama 3.1 8B)
 * Drop-in replacement for the old Azure OpenAI/Gemini service.
 * Keeps the same exported interface so all callers work unchanged.
 */

import Groq from 'groq-sdk';

export interface QuestionContext {
  round: 'technical' | 'core' | 'hr';
  userExpression?: {
    isConfident: boolean;
    isNervous: boolean;
    isStruggling: boolean;
    dominantEmotion: string;
    confidenceScore: number;
  } | null;
  resumeData?: {
    skills: string[];
    projects: (string | { name?: string; description?: string })[];
    achievements: (string | { name?: string; description?: string })[];
    experience: (string | { title?: string; company?: string })[];
    education: string[];
  } | null;
  previousQuestions: string[];
  lastAnswer?: string;
}

const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY;

// Ensure we pass dynamically the API key and allow browser instantiation since this is Vite
const groq = new Groq({ apiKey: GROQ_API_KEY, dangerouslyAllowBrowser: true });

async function callGroq(systemPrompt: string, userPrompt: string): Promise<string> {
  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 600,
    });
    
    return completion.choices[0]?.message?.content || '';
  } catch (err: any) {
    throw new Error(`Groq API error: ${err.message || 'Unknown error'}`);
  }
}

export class OpenAIService {
  /**
   * Generate interview question based on context
   */
  async generateQuestion(context: QuestionContext): Promise<string> {
    try {
      const systemPrompt = this.getSystemPrompt(context.round);
      const userPrompt = this.buildUserPrompt(context);
      const result = await callGroq(systemPrompt, userPrompt);
      return result || this.getFallbackQuestion(context.round);
    } catch (error) {
      console.error('Error generating question:', error);
      return this.getFallbackQuestion(context.round);
    }
  }

  /**
   * Generate follow-up question based on user response
   */
  async generateFollowUpQuestion(context: QuestionContext, userResponse: string): Promise<string> {
    try {
      const systemPrompt = this.getSystemPrompt(context.round);
      const followUpPrompt = this.buildFollowUpPrompt(context, userResponse);
      const result = await callGroq(systemPrompt, followUpPrompt);
      return result || this.getFallbackQuestion(context.round);
    } catch (error) {
      console.error('Error generating follow-up question:', error);
      return this.getFallbackQuestion(context.round);
    }
  }

  /**
   * Get system prompt based on round
   */
  private getSystemPrompt(round: 'technical' | 'core' | 'hr'): string {
    const prompts = {
      technical: `You are an analytical and straightforward senior technical interviewer conducting a DSA/Engineering interview.

CRITICAL RULES:
1. Ask ONE specific technical question at a time.
2. Base your questions directly on the candidate's provided SKILLS. Don't ask generic arrays/strings questions unless they have no specific software skills.
3. Be professional but conversational. Give a brief, welcoming introduction on the very first question.
4. GRACEFUL PIVOTS: If they struggle or are nervous, acknowledge it kindly and pivot to an easier fundamental concept to build confidence.
5. If they are confident, ask more complex optimization or edge-case questions.
6. Format: Keep responses under 50 words. Ask ONE clear question.`,

      core: `You are an inquisitive and pragmatic Software Architect conducting a Core/Project technical interview.

CRITICAL RULES:
1. Ask ONE specific Architecture/Project question at a time.
2. Base your questions directly on the candidate's actual PROJECTS and SKILLS.
3. Be professional but conversational. Brief introductions are fine for the first question.
4. GRACEFUL PIVOTS: If they struggle, pivot from deep system design to practical implementation-level questions.
5. Focus on trade-offs, database schemas, scaling, and OOP patterns relevant to their resume.
6. Format: Keep responses under 40 words.`,

      hr: `You are an empathetic, emotionally intelligent HR Manager conducting a behavioral interview.

CRITICAL RULES:
1. Ask ONE specific behavioral question at a time.
2. Base your scenarios on their actual ACHIEVEMENTS and EXPERIENCES.
3. Be warm and welcoming. Give an introduction.
4. GRACEFUL PIVOTS: If they give a poor answer or are nervous, offer a supportive, validating comment and pivot to a positive topic (e.g., a time they felt proud).
5. If confident, ask about complex leadership or conflict scenarios.
6. Format: Keep responses concise (under 40 words).`
    };

    return prompts[round];
  }

  /**
   * Build user prompt with context
   */
  private buildUserPrompt(context: QuestionContext): string {
    let prompt = '';

    if (context.previousQuestions.length === 0) {
      if (context.round === 'technical') {
        prompt = `This is the first question of the technical round. Provide a brief, welcoming introduction, acknowledge their Top Skills from their resume (${context.resumeData?.skills?.slice(0, 3).join(', ') || 'General SWE'}), and then ask ONE highly specific technical question related directly to their tech stack. Do not dump a generic Two-Sum question.`;
      } else if (context.round === 'core') {
        const hasProjects = context.resumeData?.projects && context.resumeData.projects.length > 0;
        prompt = hasProjects 
          ? `This is the first question of the core round. Provide a brief introduction acknowledging their projects from their resume (${context.resumeData?.projects?.map(p => typeof p === 'string' ? p : (p as any).name || 'Project').join(', ')}), and ask them to dive into the architecture of one specific project.`
          : `This is the first question of the core round. The candidate has no specific projects listed. Provide a brief introduction acknowledging their skills (${context.resumeData?.skills?.slice(0, 3).join(', ') || 'General SWE'}) and ask them a practical System Design or Core CS question (e.g., database scaling, OOP principles, OS architecture). DO NOT make up or ask about projects.`;
      } else if (context.round === 'hr') {
        const hasExperience = context.resumeData?.experience && context.resumeData.experience.length > 0;
        prompt = hasExperience
          ? `This is the first question of the HR round. Provide a warm introduction, acknowledge their experience (${context.resumeData?.experience?.map(e => typeof e === 'string' ? e : (e as any).company || 'Tech').join(', ')}), and ask them an initial behavioral question about a time they achieved something notable or overcame a challenge there.`
          : `This is the first question of the HR round. The candidate has no specific work experience listed. Provide a warm introduction and ask them an initial behavioral question about how they handle teamwork, learn new skills, or manage conflict in an academic or general setting.`;
      }
    } else {
      prompt = `Generate an interview question for round ${context.round}. `;

      if (context.userExpression) {
        prompt += `\nEMOTION DATA (CRITICAL): The candidate's dominant emotion is ${context.userExpression.dominantEmotion.toUpperCase()} (Confidence score: ${(context.userExpression.confidenceScore * 100).toFixed(1)}%).\n`;

        if (context.userExpression.isConfident) {
          prompt += `Because the candidate is confident, aggressively increase the difficulty and ask for edge-case proofs. `;
        } else if (context.userExpression.isStruggling) {
          prompt += `Because the candidate is struggling, bluntly point out their failure and demand they clarify their thought process. Do NOT be supportive. `;
        } else if (context.userExpression.isNervous) {
          prompt += `Because the candidate is nervous, remain completely stoic and professional. Push them to stay focused and answer the question without fluff. `;
        }
      }

      if (context.round === 'core' && context.resumeData) {
        prompt += `\nRESUME CONTEXT: Focus specifically on asking about their skills: [${context.resumeData.skills.join(', ')}] and their projects: [${context.resumeData.projects.join(', ')}]. `;
      } else if (context.round === 'hr' && context.resumeData) {
        prompt += `\nRESUME CONTEXT: Focus specifically on asking about their achievements: [${context.resumeData.achievements.join(', ')}]. `;
      }

      if (context.previousQuestions.length > 0) {
        prompt += `\nPREVIOUS QUESTIONS ASKED (DO NOT REPEAT): ${context.previousQuestions.slice(-3).join(' | ')}. `;
      }

      prompt += `\nThis is question ${context.previousQuestions.length + 1}. You MUST ask ONE question only. Do not provide the answer.`;
    }

    return prompt;
  }

  /**
   * Build follow-up prompt
   */
  private buildFollowUpPrompt(context: QuestionContext, userResponse: string): string {
    const cleaned = (typeof userResponse === 'string' && userResponse.trim().length > 0)
      ? userResponse.replace(/\bundefined\b|\bnull\b/gi, '[unavailable]')
      : '[no answer]';
    let prompt = `The candidate just answered: "${cleaned}". `;

    if (context.round === 'technical') {
      prompt += `IMPORTANT: Respond directly to their answer. If it's flawed, point out the flaw instantly. DO NOT say "Good try". Tell them why it's wrong in 1 sentence, then ask how to fix it. `;
    }

    if (context.userExpression) {
      prompt += `\n\nEMOTION DATA (CRITICAL): The candidate's dominant emotion is ${context.userExpression.dominantEmotion.toUpperCase()} (Confidence score: ${(context.userExpression.confidenceScore * 100).toFixed(1)}%).\n`;

      if (context.userExpression.isConfident) {
        prompt += `Since they are confident, ask an advanced, extremely complex follow-up. `;
      } else if (context.userExpression.isStruggling) {
        prompt += `Since they are struggling, do not pity them. Demand they explain the root cause of their error. `;
      } else if (context.userExpression.isNervous) {
        prompt += `Since they are nervous, remain stoic. Ignore their nerves and demand the technical facts clearly. `;
      }
    }

    prompt += `\n\nINSTRUCTION: Provide exactly ONE follow-up question/response for the ${context.round} round. KEEP IT UNDER 3 SENTENCES TOTAL. Never say "undefined" or "null". Eliminate all conversational fluff.`;

    return prompt;
  }

  /**
   * Get fallback question if API fails
   */
  private getFallbackQuestion(round: 'technical' | 'core' | 'hr'): string {
    const fallbacks = {
      technical: "Can you explain the difference between a stack and a queue?",
      core: "What is the difference between SQL and NoSQL databases?",
      hr: "Tell me about a time when you had to work under pressure."
    };
    return fallbacks[round];
  }

  /**
   * Generate comprehensive interview summary
   */
  async generateComprehensiveSummary(
    technicalHistory: any,
    projectHistory: any,
    hrHistory: any,
    resumeData: any,
    questionExpressions: any[]
  ): Promise<string> {
    try {
      const systemPrompt = `You are an expert technical recruiter and senior software engineer. Your task is to analyze the following interview transcript and candidate data to generate a comprehensive, highly actionable Markdown report.

The report MUST be structured nicely with relevant headings, bullet points, and actionable feedback. Do NOT be overly friendly; be professional, direct, and analytical. Focus on factual evidence from the transcript. 

Include the following sections:
# 🎯 Interview Performance Report

## 📊 Executive Summary
(Overall performance, key strengths, main areas for improvement)

## 🧠 Technical Assessment (DSA & Problem Solving)
(Evaluate their coding logic, efficiency, and problem-solving approach)

## 💻 Core/Project Discussion (System Design, DBMS, OOPS, etc.)
(Evaluate their core CS knowledge and project experience)

## 🤝 HR/Behavioral Assessment (Communication, Leadership)
(Evaluate their communication skills, confidence, and behavioral traits)

## 📈 Actionable Recommendations
(3-5 specific, actionable steps the candidate should take to improve)

Provide ONLY the Markdown report as your response. Do not include any other text.`;

      // Clean the transcript to reduce token size and focus on actual Q&A
      const cleanHistory = (history: any) => {
        if (!history || !history.messages) return [];
        return history.messages.map((m: any) => ({
          role: m.sender === 'ai' ? 'Interviewer' : 'Candidate',
          text: m.text
        }));
      };

      const inputData = {
        technicalRound: cleanHistory(technicalHistory),
        projectRound: cleanHistory(projectHistory),
        hrRound: cleanHistory(hrHistory),
        resumeContext: resumeData,
        emotionAndConfidenceData: questionExpressions.map((e: any) => ({
          question: e.questionId,
          dominantEmotion: e.emotion,
          confidence: e.confidence,
          isStruggling: e.isStruggling
        }))
      };

      const userPrompt = `Here is the interview data (in JSON format) to summarize:\n\n${JSON.stringify(inputData, null, 2)}`;

      const result = await callGroq(systemPrompt, userPrompt);
      return result || "Failed to generate comprehensive summary.";
    } catch (error) {
      console.error('Error generating comprehensive summary via Groq:', error);
      throw error;
    }
  }
}

export const openAI = new OpenAIService();
