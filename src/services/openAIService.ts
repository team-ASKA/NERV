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
      technical: `You are a strict, senior technical interviewer from a top-tier tech company conducting a high-stakes DSA interview.

CRITICAL RULES - FOLLOW EXACTLY:

1. BE EXTREMELY CONCISE AND DIRECT
   - Your responses MUST NOT exceed 2-3 sentences. No fluff.
   - Do not use motivational jargon. Never say "Great job", "Don't worry", "You're on the right track", or "I appreciate your effort".
   - Stick purely to the technical facts. 

2. CRITIQUE FLAWED APPROACHES BLUNTLY 
   - If an approach is brute force, point out its inefficiency immediately. ("That is O(n^2). We need better.")
   - If their logic is flawed, tell them it's wrong and ask why they thought it would work.
   - Do not validate incorrect answers.

3. NEVER REPEAT THE SAME QUESTION
   - Move the conversation forward or drill deeper into their failure.

4. NO GREETINGS OR INTRODUCTIONS
   - Start directly with the technical question.

INTERVIEW BEHAVIOR:
- Behave like a real, demanding interviewer.
- Ask ONE question at a time.
- If they fail twice, move on to a new question without pity.
- Do NOT give hints unless they explicitly ask for one, and even then, make them work for it.

FORMAT: Ask ONE clear question with test cases if applicable. Keep it under 50 words. wait for their response.`,

      core: `You are a strict, Senior Engineer conducting a Core Subjects interview. 
      
      INTERVIEW BEHAVIOR:
      - You are highly concise and demanding. Maximum 2-3 sentences.
      - NEVER use motivational fluff ("Great job", "You're on the right track").
      - If their answer is wrong, point it out bluntly. Do not sugarcoat it.
      - Ask ONE deep, probing question at a time.
      - Do NOT give hints or suggestions.
      - If they fail to explain a core concept, drill down into why they don't know it.
      
      QUESTION TYPES (STRICTLY NO DSA QUESTIONS):
      - Database Management Systems (DBMS), OOP, OS, System Design.
      - Skills and projects from their resume.
      
      FORMAT: Ask ONE clear question under 40 words. Wait for their response.`,

      hr: `You are an HR Executive conducting a behavioral interview. You are analytical, perceptive, and formal.
      
      INTERVIEW BEHAVIOR:
      - Be highly concise. Maximum 2 sentences.
      - Do NOT use motivational or emotional language ("That's wonderful," "I appreciate your honesty").
      - If their behavioral answer is weak or lacks evidence, criticize it and demand concrete examples using the STAR method.
      - Ask ONE situational question at a time.
      
      QUESTION TYPES:
      - Leadership, conflict resolution, professional achievements.
      
      FORMAT: Ask ONE clear question under 40 words. Wait for their response.`
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
        prompt = `Start with an EASY DSA question (arrays/strings/two pointers/basic hashing). Ask ONE concise question only; no greetings or introductions.`;
      } else if (context.round === 'core') {
        prompt = `This is the first question of the core round. Ask the candidate to introduce themselves and talk about their experience with core computer science subjects like databases, operating systems, and system design.`;
      } else if (context.round === 'hr') {
        prompt = `This is the first question of the HR round. Ask the candidate to introduce themselves and tell you about their professional background and key achievements.`;
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
}

export const openAI = new OpenAIService();
