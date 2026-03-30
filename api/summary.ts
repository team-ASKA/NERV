import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { technical, project, hr, resume, emotions } = req.body;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
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
    const genAI = new GoogleGenerativeAI(apiKey);
    const models = [
      "gemini-2.0-flash",
      "gemini-1.5-flash",
    ];

    let text = "";
    let lastError = null;

    for (const modelName of models) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        text = response.text();
        if (text) break;
      } catch (err: any) {
        lastError = err;
      }
    }

    if (!text && lastError) {
      throw lastError;
    }

    return res.status(200).json({ summary: text });
  } catch (error: any) {
    console.error("Error generating summary with Gemini:", error);
    return res.status(500).json({ error: "Failed to generate summary", details: error.message });
  }
}
