import express from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";

// In-memory conversation store to avoid repeating questions within a session
const technicalStore: Map<string, { asked: string[] }> = new Map();

const normalize = (q: string) =>
  (q || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const isTooGeneric = (q: string) => /time\s+complexity|space\s+complexity|outline|approach/i.test(q || "");

const router = express.Router();

router.post("/", async (req: any, res: any) => {
  const { emotion, last_answer, skills, round }: {
    emotion: string,
    last_answer: string,
    skills: string[],
    round: string
  } = req.body;
  const conversationId = (req.header('x-conversation-id') || 'default').toString();
  const store = technicalStore.get(conversationId) || { asked: [] };

  // Sanitize candidate answer to avoid undefined/null leaking into prompts
  let sanitizedAnswer = (typeof last_answer === 'string') ? last_answer.trim() : '';
  if (!sanitizedAnswer || sanitizedAnswer.toLowerCase() === 'undefined' || sanitizedAnswer.toLowerCase() === 'null') {
    sanitizedAnswer = 'N/A';
  }

  try {
    console.log('[TechnicalRound] Incoming payload:', {
      emotion,
      round,
      sanitizedAnswer,
      skillsCount: skills?.length
    });
  } catch { }

  if (!emotion) {
    return res.status(400).json({ error: "emotion required" });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "GEMINI_API_KEY not configured on server" });
  }

  try {
    const previouslyAsked = store.asked.slice(-10); // last 10 for prompt brevity
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    // Model list for fallback
    const models = [
      "models/gemini-2.0-flash",
      "models/gemini-1.5-flash",
      "models/gemini-1.5-flash-8b",
      "models/gemini-2.0-flash-exp"
    ];

    const systemPrompt = `You are a highly analytical and straightforward senior technical interviewer. Your goal is to assess the candidate's core Engineering and DSA skills based on their actual resume technology stack. 

INTERVIEW RULES:
1. Ask ONE specific technical question at a time.
2. If last_answer is "N/A" or empty (First Question): START by offering a brief, welcoming introduction (e.g., "Welcome to the technical round. I see you have experience with [Skill]."). Then, ask them a highly specific, unique coding or architecture question directly related to one of their skills. DO NOT start with a generic "Two Sum" or generic array question unless that is their only skill.
3. Base your questions around the candidate's actual SKILLS provided. Ask Data Structures, Algorithms, or language-specific deep dive questions (e.g., event loop in JS, memory management in C++, etc.)
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
        console.error(`[TechnicalRound] Failed with model ${modelName}: ${err.message}`);
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

    res.json({ question });
  } catch (err: any) {
    console.error('[TechnicalRound] Error:', err);
    res.status(500).json({ error: err.message || "Failed to generate question" });
  }
});

export default router;
