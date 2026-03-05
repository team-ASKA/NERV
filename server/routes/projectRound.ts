import express from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";

// Simple in-memory store to reduce repeats per conversation
const projectStore: Map<string, { asked: string[] }> = new Map();
const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const router = express.Router();

router.post("/", async (req, res) => {
  const { emotion, last_answer, skills, projects, round }: {
    emotion: string,
    last_answer: string,
    skills: string[],
    projects: any[],
    round: string
  } = req.body;
  const conversationId = (req.header('x-conversation-id') || 'default').toString();
  const store = projectStore.get(conversationId) || { asked: [] };

  console.log('Project Round API called with Gemini');

  if (!emotion || !skills || !projects) {
    return res.status(400).json({ error: "emotion, skills, and projects required" });
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

    const systemPrompt = `You are a senior engineer conducting a project-based technical interview. 

INTERVIEW RULES:
1. Ask ONE specific question at a time
2. If last_answer is "N/A" or empty, ask a starting project question
3. If last_answer contains content, ask a NEW question (different topic)
4. Vary question types: DBMS, OOPS, OS, System Design, Project Architecture
5. Reference their actual projects and ask about implementation details

DIFFICULTY BY EMOTION:
- If emotion contains "nervous": Ask basic project questions
- If emotion contains "confident": Ask advanced architecture questions
- If emotion contains "struggling": Ask simple implementation questions

NEVER ask generic questions like "explain your approach" - ask specific technical questions.`;

    const userPrompt = `Emotion: ${emotion}.
Round: ${round}.
Skills: ${skills.join(", ")}.
Projects: ${projects.map((p: any) => typeof p === 'string' ? p : JSON.stringify(p)).join(" | ")}.
Last Answer: ${last_answer || "N/A"}.

Previously asked (do not repeat topics):
${previouslyAsked.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Generate the next core/project question:`;

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
        console.error(`[ProjectRound] Failed with model ${modelName}: ${err.message}`);
        lastError = err;
      }
    }

    if (!question && lastError) {
      throw lastError;
    }

    store.asked.push(question);
    if (store.asked.length > 50) store.asked.splice(0, store.asked.length - 50);
    projectStore.set(conversationId, store);
    res.json({ question });
  } catch (err: any) {
    console.error('[ProjectRound] Error:', err);
    res.status(500).json({ error: err.message || "Failed to generate question" });
  }
});

export default router;
