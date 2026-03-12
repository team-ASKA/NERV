/**
 * Vercel Serverless Function: /api/groq-proxy
 * 
 * Proxies AI question-generation calls to Groq, keeping the API key
 * out of the browser bundle. The frontend openAIService.ts sends
 * requests here instead of calling Groq directly.
 * 
 * Environment variable: GROQ_API_KEY (NOT VITE_GROQ_API_KEY)
 * Set this in Vercel Dashboard > Project Settings > Environment Variables
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface GroqRequestBody {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error('[groq-proxy] GROQ_API_KEY environment variable is not set.');
    return res.status(500).json({ error: 'Server configuration error: missing API key' });
  }

  const { model = 'llama-3.1-8b-instant', messages, temperature = 0.7, max_tokens = 600 }: GroqRequestBody = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Invalid request: messages array is required' });
  }

  try {
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens,
      }),
    });

    if (!groqResponse.ok) {
      const errorText = await groqResponse.text();
      console.error('[groq-proxy] Groq API error:', groqResponse.status, errorText);
      return res.status(groqResponse.status).json({ error: `Groq API error: ${groqResponse.status}` });
    }

    const data = await groqResponse.json();
    const content = data.choices?.[0]?.message?.content ?? '';

    return res.status(200).json({ content });
  } catch (error: any) {
    console.error('[groq-proxy] Unexpected error:', error?.message);
    return res.status(500).json({ error: 'Proxy request failed', detail: error?.message });
  }
}
