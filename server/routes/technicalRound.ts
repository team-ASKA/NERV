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

router.post("/", async (req, res) => {
  const { emotion, last_answer, round }: {
    emotion: string,
    last_answer: string,
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
      sanitizedAnswer
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

    const systemPrompt = `You are a senior technical interviewer specializing in Data Structures and Algorithms (DSA).

INTERVIEW RULES:
1. Ask ONE specific DSA question at a time
2. If last_answer is "N/A" or empty, ask a starting DSA question
3. If last_answer contains content, ask a NEW DSA question (not follow-up on same problem)
4. Adapt difficulty based on emotion and previous answers
5. Vary question types: arrays, strings, trees, graphs, dynamic programming, etc.

QUESTION DIFFICULTY BY EMOTION:
- If emotion contains "nervous" or "low confidence": Ask EASY questions (arrays, basic sorting, simple string problems)
- If emotion contains "confident" or "high confidence": Ask MEDIUM/HARD questions (dynamic programming, complex data structures, optimization)
- If emotion contains "struggling": Ask EASY questions and provide hints

NEVER ask generic questions like "outline your approach", "explain your approach", or "time/space complexity" prompts – always ask a new, concrete problem statement.`;

    const userPrompt = `Candidate's Last Answer: ${sanitizedAnswer}
Emotion: ${emotion}

Difficulty progression: Easy → Medium → Hard (based on confidence)

Previously asked questions (do not repeat or paraphrase any of these):
${previouslyAsked.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Generate the next DSA question:`;

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
