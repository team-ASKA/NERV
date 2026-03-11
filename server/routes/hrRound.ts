import express from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";

// In-memory de-dupe per conversation for HR questions
const hrStore: Map<string, { asked: string[] }> = new Map();
const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const router = express.Router();

router.post("/", async (req: any, res: any) => {
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

    const systemPrompt = `You are an empathetic, emotionally intelligent, and culturally-focused HR Manager conducting a behavioral interview. Your goal is to understand the candidate's character, leadership qualities, and how they handle real-world workplace scenarios.

INTERVIEW RULES:
1. Ask ONE specific behavioral question at a time.
2. If last_answer is "N/A" or empty, start with a welcoming introduction. If they have Achievements or Experiences listed, ask them about one of them. If both lists are EMPTY, DO NOT make up work history. Instead, ask them a general behavioral question about teamwork, learning a new skill, or handling a difficult academic/personal challenge.
3. If they have history: Base your questions directly on their actual ACHIEVEMENTS and EXPERIENCES arrays. Ask about conflict resolution, teamwork, or growth moments referenced in those experiences.
4. GRACEFUL PIVOTS: If the candidate gives a poor answer, struggles, or displays a "struggling" or "nervous" emotion, DO NOT dwell on the negative. Interject with a supportive, validating comment and gently pivot the topic to something more positive (e.g., "That sounds like a tough situation, but it's great you learned from it. Tell me about a time you felt particularly proud of your team's work instead.")
5. Maintain a warm, welcoming, and professional tone. Note: Keep the responses concise, do not output long paragraphs of text.

QUESTION DIFFICULTY DYNAMICS:
- "nervous" / "struggling": Pivot to supportive, positive questions (e.g., biggest wins, favorite projects, collaborative successes) to rebuild confidence.
- "confident": Ask complex behavioral scenarios (e.g., handling toxic team members, managing stakeholder disagreements, taking accountability for failures).

NEVER ask generic questions. Always anchor the behavioral scenario to a specific experience or achievement they provided.`;

    const userPrompt = `Candidate's Last Answer: ${last_answer || "N/A"}
Emotion: ${emotion}
Candidate Achievements: ${achievements && achievements.length ? achievements.map((a: any) => typeof a === 'string' ? a : JSON.stringify(a)).join(" | ") : 'No specific achievements provided.'}
Candidate Experiences: ${experiences && experiences.length ? experiences.map((e: any) => typeof e === 'string' ? e : JSON.stringify(e)).join(" | ") : 'No specific experiences provided.'}

Previously asked (avoid repeating themes):
${previouslyAsked.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Generate the next highly specific behavioral HR question:`;

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
