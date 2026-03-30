/**
 * Question Generation Service (Groq Llama 3.1 8B via secure server-side proxy)
 *
 * API calls are routed through /api/groq-proxy (a Vercel serverless function)
 * so the Groq API key is NEVER exposed in the browser bundle.
 *
 * Set GROQ_API_KEY (not VITE_GROQ_API_KEY) in Vercel Dashboard > Project Settings.
 */


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

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

/**
 * Call Groq via secure server-side proxy with exponential-backoff retry.
 * Falls back gracefully so callers always get a string (possibly empty).
 */
async function callGroq(
  systemPrompt: string,
  userPrompt: string,
  maxRetries = 3
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch('/api/groq-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      });

      if (!response.ok) {
        // Fallback for local development: if proxy returns 404/not handled, try direct call
        if ((response.status === 404 || response.status === 405) && import.meta.env.VITE_GROQ_API_KEY) {
          console.info('[openAIService] Proxy not found/handled. Falling back to direct Groq call for local dev.');
          return callGroqDirectly(messages);
        }

        const errorData = await response.json().catch(() => ({}));
        console.error(`[openAIService] Proxy Failure - Status: ${response.status}. Please check Vercel Environment Variables (GROQ_API_KEY).`, errorData);
        throw new Error(`Proxy ${response.status}: ${errorData.error || 'Unknown'}`);
      }

      const data = await response.json();
      return data.content ?? '';
    } catch (err: any) {
      // If the fetch itself failed (e.g. network error) and we have a local key, try direct
      if (import.meta.env.VITE_GROQ_API_KEY && (err.message.includes('fetch') || err.name === 'TypeError')) {
        return callGroqDirectly(messages);
      }
      
      lastError = err;
      console.warn(`[openAIService] attempt ${attempt}/${maxRetries} failed:`, err.message);
      if (attempt < maxRetries) {
        // Exponential backoff: 500ms, 1000ms, 2000ms
        await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt - 1)));
      }
    }
  }

  throw lastError ?? new Error('All proxy retry attempts failed.');
}

/**
 * Direct call to Groq API (fallback for local development only)
 */
async function callGroqDirectly(messages: ChatMessage[]): Promise<string> {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY;
  if (!apiKey) throw new Error('No Groq API key available for direct call');

  const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages,
      temperature: 0.7,
      max_tokens: 600,
    }),
  });

  if (!groqResponse.ok) {
    const errorText = await groqResponse.text();
    throw new Error(`Direct Groq API error: ${groqResponse.status} - ${errorText}`);
  }

  const data = await groqResponse.json();
  return data.choices?.[0]?.message?.content ?? '';
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
        prompt = `This is the first question of the technical round. Provide an EXTREMELY BRIEF introduction (max 1-2 short sentences to avoid TTS rate limits), acknowledge their Top Skills from their resume (${context.resumeData?.skills?.slice(0, 3).join(', ') || 'General SWE'}), and then IMMEDIATELY ask them a specific Data Structures and Algorithms (DSA) or coding logic question tied to their stack. Do not ask abstract questions.`;
      } else if (context.round === 'core') {
        const hasProjects = context.resumeData?.projects && context.resumeData.projects.length > 0;
        prompt = hasProjects 
          ? `This is the first question of the core round. Provide an EXTREMELY BRIEF introduction (max 1-2 short sentences to avoid TTS rate limits) acknowledging their projects (${context.resumeData?.projects?.map(p => typeof p === 'string' ? p : (p as any).name || 'Project').join(', ')}), and ask them to dive into the architecture of one specific project.`
          : `This is the first question of the core round. The candidate has no specific projects listed. Provide an EXTREMELY BRIEF introduction (max 1-2 short sentences) acknowledging their skills (${context.resumeData?.skills?.slice(0, 3).join(', ') || 'General SWE'}) and ask them a practical System Design or Core CS question (e.g., database scaling, OOP principles, OS architecture). DO NOT make up projects.`;
      } else if (context.round === 'hr') {
        const hasExperience = context.resumeData?.experience && context.resumeData.experience.length > 0;
        prompt = hasExperience
          ? `This is the first question of the HR round. Provide an EXTREMELY BRIEF warm introduction (max 1-2 short sentences to avoid TTS rate limits), acknowledge their experience (${context.resumeData?.experience?.map(e => typeof e === 'string' ? e : (e as any).company || 'Tech').join(', ')}), and ask an initial behavioral question about a time they achieved something notable or overcame a challenge there.`
          : `This is the first question of the HR round. The candidate has no specific work experience listed. Provide an EXTREMELY BRIEF warm introduction (max 1-2 short sentences) and ask an initial behavioral question about how they handle teamwork, learn new skills, or manage conflict.`;
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
      technical: "I'm having a brief connection issue. Regardless, let's keep going. Can you explain the time and space complexity trade-offs between Hash Maps and Arrays effectively?",
      core: "My connection is a bit unstable. However, tell me about a time you had to make a tough architectural decision between data consistency and high availability.",
      hr: "My network seems slightly unstable. Nevertheless, tell me about a time when you had to work under extreme pressure or tight deadlines to deliver a project on time."
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
