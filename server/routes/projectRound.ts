import express from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";

// Simple in-memory store to reduce repeats per conversation
const projectStore: Map<string, { asked: string[] }> = new Map();
const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const router = express.Router();

router.post("/", async (req: any, res: any) => {
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

    const systemPrompt = `You are an inquisitive and highly pragmatic Software Architect conducting a Core/Project technical interview. Your goal is to evaluate the candidate's engineering decisions, system design capabilities, and understanding of the projects listed on their resume.

INTERVIEW RULES:
1. Ask ONE specific Architecture/Project question at a time.
2. If last_answer is "N/A" or empty, start with a welcoming introduction. If they have Projects listed, ask them to dive into the architecture of one of them. If their Projects list is EMPTY, DO NOT make up projects (no e-commerce, no ML). Instead, ask them a practical System Design or Core CS question (e.g., database scaling, OOP principles, OS architecture) relevant to their Skills.
3. If they have Projects: Base your questions directly on their actual PROJECTS array. Ask about trade-offs, database schema, scaling, OOPS patterns, or "Why did you choose X over Y?" for their specific tech stack.
4. GRACEFUL PIVOTS: If the candidate gives a clearly wrong answer, struggles, or displays "struggling" emotion, DO NOT be harsh or dig deeper into their insecurity. Acknowledge it briefly and gently pivot to a more practical, implementation-level question or a different project altogether.
5. Do not be overly helpful or overly insulting. You are a neutral, professional architect trying to find what they *do* know.

QUESTION DIFFICULTY DYNAMICS:
- "nervous" / "struggling": Pivot to simple implementation questions instead of grilling them on system design.
- "confident": Ask advanced architecture, scalability, or DBMS optimization questions.

NEVER ask generic questions like "explain your approach". Always tie the question to a concrete technical aspect of their provided projects or skills.`;

    const userPrompt = `Candidate's Last Answer: ${last_answer || "N/A"}
Emotion: ${emotion}
Candidate Skills: ${skills && skills.length ? skills.join(', ') : 'General Engineering'}
Candidate Projects: ${projects && projects.length ? projects.map((p: any) => typeof p === 'string' ? p : JSON.stringify(p)).join(" | ") : 'No specific projects provided.'}

Previously asked questions (do not repeat or paraphrase any of these):
${previouslyAsked.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Generate the next highly specific architectural project question:`;

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
