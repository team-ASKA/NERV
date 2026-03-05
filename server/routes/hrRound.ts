import express from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";

// In-memory de-dupe per conversation for HR questions
const hrStore: Map<string, { asked: string[] }> = new Map();
const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const router = express.Router();

router.post("/", async (req, res) => {
  const { emotion, last_answer, achievements, experiences, round }: {
    emotion: string,
    last_answer: string,
    achievements: any[],
    experiences: any[],
    round: string
  } = req.body;
  const conversationId = (req.header('x-conversation-id') || 'default').toString();
  const store = hrStore.get(conversationId) || { asked: [] };

  console.log('HR Round API called with Gemini');

  if (!emotion || !achievements || !experiences) {
    return res.status(400).json({ error: "emotion, achievements, and experiences required" });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "GEMINI_API_KEY not configured on server" });
  }

  try {
    const previouslyAsked = store.asked.slice(-10);
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    const models = [
      "models/gemini-2.0-flash",
      "models/gemini-1.5-flash",
      "models/gemini-1.5-flash-8b",
      "models/gemini-2.0-flash-exp"
    ];

    const systemPrompt = `You are an HR interviewer conducting a professional behavioral interview.

INTERVIEW RULES:
1. Ask ONE specific HR question at a time
2. If last_answer is "N/A" or empty, ask a starting HR question
3. If last_answer contains content, ask a NEW question (different behavioral topic)
4. Vary question types: leadership, teamwork, problem-solving, conflict resolution, growth
5. Reference their specific achievements and experiences

DIFFICULTY BY EMOTION:
- If emotion contains "nervous": Ask basic background questions
- If emotion contains "confident": Ask complex leadership scenarios
- If emotion contains "struggling": Ask supportive growth questions

NEVER ask generic questions - ask specific behavioral questions with clear scenarios.`;

    const userPrompt = `Emotion: ${emotion}.
Round: ${round}.
Achievements: ${achievements.map((a: any) => typeof a === 'string' ? a : JSON.stringify(a)).join(" | ")}.
Experiences: ${experiences.map((e: any) => typeof e === 'string' ? e : JSON.stringify(e)).join(" | ")}.
Last Answer: ${last_answer || "N/A"}.

Previously asked (avoid repeating themes):
${previouslyAsked.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Generate the next HR question:`;

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
        console.error(`[HRRound] Failed with model ${modelName}: ${err.message}`);
        lastError = err;
      }
    }

    if (!question && lastError) {
      throw lastError;
    }

    store.asked.push(question);
    if (store.asked.length > 50) store.asked.splice(0, store.asked.length - 50);
    hrStore.set(conversationId, store);
    res.json({ question });
  } catch (err: any) {
    console.error('[HRRound] Error:', err);
    res.status(500).json({ error: err.message || "Failed to generate question" });
  }
});

export default router;
