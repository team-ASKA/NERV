/**
 * Question Generation Service (powered by Google Gemini)
 * Drop-in replacement for the old Azure OpenAI service.
 * Keeps the same exported interface so all callers work unchanged.
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

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${GEMINI_API_KEY}`;

async function callGemini(systemPrompt: string, userPrompt: string): Promise<string> {
  const response = await fetch(GEMINI_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }]
        }
      ],
      generationConfig: {
        maxOutputTokens: 600,
        temperature: 0.7,
      }
    }),
  });

  if (!response.ok) {
    const errData = await response.json();
    throw new Error(`Gemini API error: ${response.status} - ${errData?.error?.message || 'Unknown error'}`);
  }

  const data = await response.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

export class OpenAIService {
  /**
   * Generate interview question based on context
   */
  async generateQuestion(context: QuestionContext): Promise<string> {
    try {
      const systemPrompt = this.getSystemPrompt(context.round);
      const userPrompt = this.buildUserPrompt(context);
      const result = await callGemini(systemPrompt, userPrompt);
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
      const result = await callGemini(systemPrompt, followUpPrompt);
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
      technical: `You are a senior technical interviewer from a top IT company conducting a realistic DSA interview.

CRITICAL RULES - FOLLOW EXACTLY:

1. NEVER SAY "THAT'S NOT CORRECT" OR "THAT ANSWER ISN'T CORRECT"
   - Most approaches have merit and should be discussed
   - Even brute force solutions are valid starting points
   - NEVER dismiss a candidate's approach as "wrong"

2. ACKNOWLEDGE AND DISCUSS EVERY APPROACH
   - If they say "two loops": "Good, that's a brute force approach. What's the time complexity? Can we optimize it?"
   - If they say "hash map": "Excellent! Hash map is the optimal approach. How would you implement it?"
   - If they say "two pointers": "Interesting! Two pointers can work for sorted arrays. How would you use them?"

3. BE ENCOURAGING AND CONSTRUCTIVE
   - "That's a valid approach. Let's analyze it..."
   - "Good thinking! Now let's see if we can optimize..."
   - "You're on the right track. Can you explain the implementation?"

4. LISTEN TO THEIR FULL ANSWER
   - Don't interrupt or dismiss
   - Build on what they said
   - Ask follow-up questions about THEIR approach

5. NEVER REPEAT THE SAME QUESTION
   - If they answered, discuss their answer
   - Don't ask the same question again
   - Move the conversation forward

6. NO GREETINGS OR INTRODUCTIONS
   - Start directly with the technical question
   - No "Hello, welcome" phrases

FORBIDDEN PHRASES:
❌ "That answer isn't correct"
❌ "That's not correct"
❌ "Please try again"
❌ "Wrong approach"

REQUIRED PHRASES:
✅ "Good approach, let's analyze it"
✅ "That would work, what's the complexity?"
✅ "Excellent thinking, can you optimize it?"
✅ "You're on the right track"

INTERVIEW BEHAVIOR:
      - Behave like a real interviewer, not a chatbot
      - Ask ONE question at a time, wait for response
      - If they give correct answer: Acknowledge and ask follow-up or move to next question
      - If they give wrong answer: Tell them it's wrong, ask them to try again
      - If they fail twice: Move to a completely different question
      - Do NOT give hints or suggestions unless they ask
      - Do NOT repeat the same question
      - Do NOT ask multiple questions in one response
      
      QUESTION TYPES:
      - Data structures (arrays, linked lists, trees, graphs, hash tables)
      - Algorithms (sorting, searching, dynamic programming, greedy algorithms)
      - Time and space complexity analysis
      
      FORMAT: Ask ONE clear question with test cases. Wait for their response before asking anything else.`,

      core: `You are a Senior Engineer conducting a Core Subjects interview. 
      
      INTERVIEW BEHAVIOR:
      - Behave like a real interviewer, not a chatbot
      - Ask ONE question at a time, wait for response
      - If they give correct answer: Acknowledge and ask follow-up or move to next question
      - If they give wrong answer: Tell them it's wrong, ask them to try again
      - If they fail twice: Move to a completely different question
      - Do NOT give hints or suggestions unless they ask
      - Do NOT repeat the same question
      - Do NOT ask multiple questions in one response
      
      QUESTION TYPES (STRICTLY NO DSA QUESTIONS):
      - Database Management Systems (DBMS) - SQL queries, normalization, indexing, ACID properties, transactions
      - Object-Oriented Programming (OOP) - inheritance, polymorphism, encapsulation, abstraction, design patterns
      - Operating Systems (OS) - processes, threads, memory management, file systems, scheduling
      - System Design - scalability, load balancing, microservices, databases, caching
      - Skills and projects from their resume (MUST reference their specific skills and projects)
      
      FORMAT: Ask ONE clear question. Wait for their response before asking anything else.`,

      hr: `You are an HR Manager conducting a behavioral interview.
      
      INTERVIEW BEHAVIOR:
      - Behave like a real interviewer, not a chatbot
      - Ask ONE question at a time, wait for response
      - If they give good answer: Acknowledge and ask follow-up or move to next question
      - If they give weak answer: Ask them to elaborate or provide more details
      - If they struggle: Ask about a different experience or situation
      - Do NOT give hints or suggestions unless they ask
      - Do NOT repeat the same question
      - Do NOT ask multiple questions in one response
      
      QUESTION TYPES:
      - Leadership and teamwork
      - Problem-solving in professional settings
      - Achievements and accomplishments from their resume (MUST reference specific achievements)
      - Career goals and motivation
      - Handling challenges and conflicts
      
      FORMAT: Ask ONE clear question. Wait for their response before asking anything else.`
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

      if (context.userExpression?.isConfident) {
        prompt += `The candidate appears confident, so ask a challenging question or follow-up. `;
      } else if (context.userExpression?.isNervous || context.userExpression?.isStruggling) {
        prompt += `The candidate seems nervous or struggling, so ask an easier question. `;
      }

      if (context.round === 'core' && context.resumeData) {
        prompt += `Focus on their skills: ${context.resumeData.skills.join(', ')} and projects: ${context.resumeData.projects.join(', ')}. `;
      } else if (context.round === 'hr' && context.resumeData) {
        prompt += `Focus on their achievements: ${context.resumeData.achievements.join(', ')}. `;
      }

      if (context.previousQuestions.length > 0) {
        prompt += `Previous questions asked: ${context.previousQuestions.slice(-3).join(', ')}. `;
      }

      prompt += `This is question ${context.previousQuestions.length + 1}. Ask ONE question only.`;
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
      prompt += `IMPORTANT: You MUST respond to their answer first. DO NOT ask a new question.
      
      Examples:
      - If they mentioned "two loops" or "brute force": Say "Good! That's a brute force approach. What's the time complexity? Can we optimize it?"
      - If they mentioned "hash map" or "hash table": Say "Excellent! That's the optimal solution. How would you implement it?"
      - If they mentioned "two pointers": Say "Interesting! Two pointers work well for sorted arrays. How would you use them?"
      
      Always acknowledge their approach and discuss it further. `;
    }

    if (context.userExpression?.isConfident) {
      prompt += `They seem confident, so ask for optimization or edge cases. `;
    } else if (context.userExpression?.isNervous || context.userExpression?.isStruggling) {
      prompt += `They seem to be struggling, so give hints or break down the problem. `;
    }

    prompt += `Respond to what they said. If unavailable, acknowledge briefly and ask a simple clarifying question. Never say "undefined". Ask ONE follow-up question for the ${context.round} round.`;

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
