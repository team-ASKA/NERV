import express from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";

const router = express.Router();

router.post("/", async (req, res) => {
    const { technical, project, hr, resume, emotions } = req.body;

    if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ error: "GEMINI_API_KEY not configured on server" });
    }

    const prompt = `
      You are an expert interview analyst. Generate a comprehensive, well-formatted interview summary based on the following data.
      Use Markdown formatting with clear headings.

      CANDIDATE DATA:
      Resume: ${JSON.stringify(resume)}
      
      INTERVIEW TRANSCRIPTS:
      Technical Round: ${JSON.stringify(technical)}
      Project/Core Round: ${JSON.stringify(project)}
      HR Round: ${JSON.stringify(hr)}
      
      USER EMOTIONS & CONFIDENCE:
      ${JSON.stringify(emotions)}

      Please structure the report as follows:
      1. ## Executive Summary
      2. ## Technical Proficiency (DSA & Core Subjects)
      3. ## Project & Experience Analysis
      4. ## Behavioral & Communication Assessment
      5. ## Emotional Intelligence & Confidence Analysis
      6. ## Skill Gap Analysis & Recommendations
      7. ## Final Verdict

      Be professional, objective, and provide specific examples from the transcript if possible.
    `;

    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const models = [
            "models/gemini-3-flash-preview",
            "models/gemini-3-pro-preview",
            "models/gemini-2.5-flash-lite",
            "models/gemini-2.0-flash-exp",
            "models/gemini-1.5-flash"
        ];
        let text = "";
        let lastError = null;

        for (const modelName of models) {
            try {
                console.log(`Attempting summary with model: ${modelName}`);
                const model = genAI.getGenerativeModel({ model: modelName });
                const result = await model.generateContent(prompt);
                const response = await result.response;
                text = response.text();
                if (text) break;
            } catch (err: any) {
                console.error(`Failed with model ${modelName}: ${err.message}`);
                lastError = err;
            }
        }

        if (!text && lastError) {
            throw lastError;
        }

        res.json({ summary: text });
    } catch (error: any) {
        console.error("Error generating summary with Gemini:", error);
        res.status(500).json({ error: "Failed to generate summary", details: error.message });
    }
});

export default router;
