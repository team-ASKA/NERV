import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenerativeAI } from "@google/generative-ai";

// In-memory conversation store to avoid repeating questions within a session
// Note: This is per server instance in serverless, so it's not perfectly persistent but works for single sessions.
const technicalStore: Map<string, { asked: string[] }> = new Map();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { emotion, last_answer, skills, round }: {
    emotion: string,
    last_answer: string,
    skills: string[],
    round: string
  } = req.body;

  const conversationId = (req.headers['x-conversation-id'] || 'default').toString();
  const store = technicalStore.get(conversationId) || { asked: [] };

  // Sanitize candidate answer to avoid undefined/null leaking into prompts
  let sanitizedAnswer = (typeof last_answer === 'string') ? last_answer.trim() : '';
  if (!sanitizedAnswer || sanitizedAnswer.toLowerCase() === 'undefined' || sanitizedAnswer.toLowerCase() === 'null') {
    sanitizedAnswer = 'N/A';
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('[TechnicalRound] GEMINI_API_KEY environment variable is not set.');
    return res.status(500).json({ error: 'Server configuration error: missing GEMINI API key' });
  }

  try {
    const previouslyAsked = store.asked.slice(-10);
    const genAI = new GoogleGenerativeAI(apiKey);

    const models = [
      "gemini-2.0-flash",
      "gemini-1.5-flash",
      "gemini-1.5-flash-8b",
    ];

    const systemPrompt = `You are a highly analytical and straightforward senior technical interviewer. Your goal is to assess the candidate's core Engineering and DSA skills based on their actual resume technology stack. 

INTERVIEW RULES:
1. Ask ONE specific technical question at a time.
2. If last_answer is "N/A" or empty (First Question): START by offering an EXTREMELY BRIEF welcoming introduction (MAX 1-2 short sentences) to avoid breaking the text-to-speech engine. Do NOT list all their skills. Then, IMMEDIATELY ask them a specific Data Structures and Algorithms (DSA) or coding logic question. DO NOT just ask abstract questions about their experience. You must ask them to solve a specific algorithmic problem or data structure question tied to their stack.
3. Base your questions around the candidate's actual SKILLS provided. Focus heavily on Data Structures, Algorithms, step-by-step logic, and time/space complexity.
4. GRACEFUL PIVOTS: If the candidate gives a clearly wrong answer, struggles, or displays "struggling" emotion, DO NOT be harsh or dig deeper into their insecurity. Acknowledge it briefly and gently pivot to an entirely different technical topic or an easier fundamental question.
5. Do not be overly helpful or overly insulting. You are a neutral, professional engineer trying to find what they *do* know.

QUESTION DIFFICULTY DYNAMICS:
- "nervous" / "struggling": Pivot to easier, fundamental concepts or change topics to help them regain confidence.
- "confident": Ask MEDIUM/HARD questions (optimization, advanced structures, edge cases).

NEVER ask generic questions like "outline your approach" or "explain your approach". Always ask a concrete problem or conceptual question.`;

    const userPrompt = `Candidate's Last Answer: ${sanitizedAnswer}
Emotion: ${emotion}
Candidate Skills: ${skills && skills.length ? skills.join(', ') : 'General Computer Science'}

Previously asked questions (do not repeat or paraphrase any of these):
${previouslyAsked.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Generate the next highly specific technical question:`;

    let question = "";
    let lastError = null;

    for (const modelName of models) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: systemPrompt
        });
        const result = await model.generateContent(userPrompt);
        const response = await result.response;
        question = response.text().trim();
        if (question) break;
      } catch (err: any) {
        lastError = err;
      }
    }

    if (!question && lastError) {
      throw lastError;
    }

    // Persist asked question
    store.asked.push(question);
    if (store.asked.length > 50) store.asked.splice(0, store.asked.length - 50);
    technicalStore.set(conversationId, store);

    return res.status(200).json({ 
      question,
      round: 'technical',
      conversation_id: conversationId 
    });
  } catch (error: any) {
    console.error('[TechnicalRound] Unexpected error:', error?.message);
    return res.status(500).json({ error: 'Failed to generate technical question', detail: error?.message });
  }
}
