/**
 * Tutor Service — powers the AI Training Session using the same Groq proxy as interviews.
 * The AI acts as a patient, explanatory tutor based on the user's interview summary.
 */

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ResumeGraphData {
  skills?: string[];
  projects?: string[];
  experience?: string[];
  education?: string[];
  achievements?: string[];
}

interface TutorContext {
  resumeSkills: string[];
  interviewSummary: string;
  skillMentions: Record<string, number>; // skill -> how many times asked in interview
  weakSkills: string[]; // skills mentioned < 2 times
  currentTopic: string | null;
  resumeData?: ResumeGraphData;
}

async function callGroq(messages: ChatMessage[], maxRetries = 3): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch('/api/groq-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      });

      if (!response.ok) {
        if ((response.status === 404 || response.status === 405) && import.meta.env.VITE_GROQ_API_KEY) {
          return callGroqDirectly(messages);
        }
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Proxy ${response.status}: ${errorData.error || 'Unknown'}`);
      }

      const data = await response.json();
      return data.content ?? '';
    } catch (err: any) {
      if (import.meta.env.VITE_GROQ_API_KEY && (err.message.includes('fetch') || err.name === 'TypeError')) {
        return callGroqDirectly(messages);
      }
      lastError = err;
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt - 1)));
      }
    }
  }
  throw lastError ?? new Error('All retry attempts failed.');
}

async function callGroqDirectly(messages: ChatMessage[]): Promise<string> {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY;
  if (!apiKey) throw new Error('No Groq API key available');

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
      max_tokens: 500,
    }),
  });

  if (!groqResponse.ok) {
    const errorText = await groqResponse.text();
    throw new Error(`Direct Groq API error: ${groqResponse.status} - ${errorText}`);
  }

  const data = await groqResponse.json();
  return data.choices?.[0]?.message?.content ?? '';
}

function buildTutorSystemPrompt(ctx: TutorContext): string {
  const weak = ctx.weakSkills.length > 0
    ? `Skills needing most attention (barely covered in interview): ${ctx.weakSkills.join(', ')}.`
    : 'All resume skills were well covered in the interview.';

  const currentTopicLine = ctx.currentTopic
    ? `The user is currently focusing on: **${ctx.currentTopic}**.`
    : '';

  const rd = ctx.resumeData || {};
  const projectsLine = rd.projects && rd.projects.length > 0
    ? `Projects on their resume: ${rd.projects.slice(0, 6).join(' | ')}.`
    : '';
  const experienceLine = rd.experience && rd.experience.length > 0
    ? `Work experience: ${rd.experience.slice(0, 4).join(' | ')}.`
    : '';
  const educationLine = rd.education && rd.education.length > 0
    ? `Education: ${rd.education.slice(0, 3).join(' | ')}.`
    : '';
  const achievementsLine = rd.achievements && rd.achievements.length > 0
    ? `Key achievements: ${rd.achievements.slice(0, 4).join(' | ')}.`
    : '';

  return `You are NERV Tutor — an encouraging, world-class AI tutor helping a software engineering candidate improve after a real interview.

CANDIDATE RESUME PROFILE:
- Technical skills: ${ctx.resumeSkills.join(', ')}.
- ${weak}
${projectsLine ? `- ${projectsLine}` : ''}
${experienceLine ? `- ${experienceLine}` : ''}
${educationLine ? `- ${educationLine}` : ''}
${achievementsLine ? `- ${achievementsLine}` : ''}
- Interview summary: ${ctx.interviewSummary.substring(0, 500)}...
${currentTopicLine}

YOUR ROLE:
1. Be warm, patient, and encouraging — reference their actual projects/experience when relevant.
2. When the user selects a skill or project node, explain clearly with real-world examples referencing their background.
3. Ask interactive questions to test understanding (don't just lecture).
4. Give quizzes ONLY when explicitly requested: pose 3-4 multiple choice questions, strictly numbered (1. 2. 3. 4.) with A. B. C. D. options, one Answer: line, and one Explanation: line per question.
5. When explaining concepts, use concrete analogies and brief code snippets where helpful.
6. EXTREMELY CRITICAL: Keep conversational responses STRICTLY UNDER 30-40 WORDS (1-2 sentences maximum). Verbose responses break TTS/STT rate limits.
7. After explaining a concept, ALWAYS end with a short follow-up question.
8. Never say "Great question!" or use empty filler phrases. Be direct.

FORMAT:
- Explanations: 1-2 SHORT sentences + optional code snippet + 1 follow-up question.
- Quizzes (ONLY when asked): strict numbered MCQ format — no intro or outro text.
- Keep TTS-friendly: no markdown symbols in conversational parts.
- DO NOT use any emojis in your response.`;
}

export class TutorService {
  private conversationHistory: ChatMessage[] = [];
  private context: TutorContext | null = null;

  initSession(ctx: TutorContext) {
    this.context = ctx;
    this.conversationHistory = [];
  }

  async sendMessage(userMessage: string): Promise<string> {
    if (!this.context) throw new Error('Tutor session not initialized');

    const systemPrompt = buildTutorSystemPrompt(this.context);
    
    this.conversationHistory.push({ role: 'user', content: userMessage });

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...this.conversationHistory.slice(-10), // keep last 10 turns for context
    ];

    const response = await callGroq(messages);
    const reply = response || 'Let me think about that... Could you rephrase your question?';

    this.conversationHistory.push({ role: 'assistant', content: reply });
    return reply;
  }

  async focusOnTopic(topic: string): Promise<string> {
    if (!this.context) throw new Error('Tutor session not initialized');
    this.context.currentTopic = topic;
    
    const topicPrompt = `The user clicked on the "${topic}" node in the knowledge graph. They want to learn about ${topic}. Start a focused explanation session: briefly introduce the concept, give a real-world analogy, then ask them what they already know about it.`;
    
    return this.sendMessage(topicPrompt);
  }

  async generateQuizForTopic(topic: string): Promise<string> {
    const quizPrompt = `Generate a 4-question multiple choice quiz about "${topic}" at an intermediate software engineering level.

STRICT FORMAT for each question:
1. [Question text here]
A. [Option A]
B. [Option B]
C. [Option C]
D. [Option D]
Answer: [A/B/C/D]
Explanation: [One sentence explaining why the answer is correct]

2. [Next question...]
A. ...

Do NOT add any intro text or conclusion. Output ONLY the 4 questions in the exact format above.`;
    return this.sendMessage(quizPrompt);
  }

  getSessionStats() {
    return {
      messageCount: this.conversationHistory.length,
      currentTopic: this.context?.currentTopic || null,
    };
  }

  resetSession() {
    this.conversationHistory = [];
    if (this.context) this.context.currentTopic = null;
  }
}

export const tutorService = new TutorService();
