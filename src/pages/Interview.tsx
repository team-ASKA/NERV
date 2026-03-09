import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Loader2, ArrowLeft
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { FaVideo } from 'react-icons/fa';
import { db } from '../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import ReactMarkdown from 'react-markdown';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'ai';
  timestamp: Date;
  responseTime?: number;
}

// Declare global variable for audio playing state
declare global {
  interface Window {
    audioPlaying: boolean;
  }
}

// Initialize global variable
if (typeof window !== 'undefined') {
  window.audioPlaying = false;
}

import { sarvamTTS } from '../services/sarvamTTSService';

// Function to convert text to speech using Sarvam TTS
const speakResponse = async (text: string): Promise<void> => {
  if (!text || text.trim() === '') return;
  try {
    await sarvamTTS.speak(text, 'technical');
  } catch (error) {
    console.error('TTS error, falling back to browser TTS:', error);
    return fallbackSpeak(text);
  }
};



// Fallback to browser's built-in speech synthesis (remains the same)
function fallbackSpeak(text: string): Promise<void> {
  // ... (this function has no secrets and remains unchanged)
}

const Interview = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  // ... (other state variables remain the same) ...
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isInterviewStarted, setIsInterviewStarted] = useState(false);
  const [isInterviewComplete, setIsInterviewComplete] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [userInput, setUserInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<string>('');
  const [isThinking, setIsThinking] = useState(false);
  const [questionExpressions] = useState<Map<string, any>>(new Map());
  const [resumeData, setResumeData] = useState<any>(null);
  const [conversationHistory, setConversationHistory] = useState<Array<{ role: string; content: string }>>([]);

  // ... (useEffect hooks and other functions remain the same) ...

  // Process user answer using Groq Llama 3.1 8B
  const processUserAnswer = async (answer: string): Promise<string> => {
    try {
      const isFirstResponse = messages.length === 1;

      const prompt = isFirstResponse
        ? `The candidate has provided their introduction: "${answer}". Based on their background, ask a technical question that's appropriate for their experience level. The question should be challenging but fair, and should test their problem-solving skills. Keep the question concise and clear.`
        : `The candidate answered: "${answer}" to the question: "${currentQuestion}".

          Based on their response, provide feedback and ask a follow-up question. The follow-up should be:
          - More challenging if they answered well
          - A different approach to the same problem if they struggled
          - A new technical concept if they showed good understanding

          Your tone should be that of a senior engineer who doesn't waste time with niceties.
          Be critical when the candidate's answer lacks technical depth.`;

      const systemContent = `You are a technical interviewer with high standards and a direct personality. You never use phrases like 'thank you', 'that's great', or similar polite but empty phrases.`;
      const recentHistory = conversationHistory.slice(-4).map(m => m.content).join('\n');
      const fullPrompt = `${systemContent}\n\n${recentHistory}\n\nUser: ${prompt}`;

      const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY;
      const Groq = (await import('groq-sdk')).default;
      const groq = new Groq({ apiKey: GROQ_API_KEY, dangerouslyAllowBrowser: true });

      const completion = await groq.chat.completions.create({
        model: "llama-3.1-8b-instant",
        messages: [{ role: 'user', content: fullPrompt }],
        max_tokens: 500,
        temperature: 0.7
      });

      const aiResponse = completion.choices[0]?.message?.content || 'Let me ask you another question. Can you explain a data structure you are most comfortable with?';

      setConversationHistory(prev => [
        ...prev,
        { role: 'user', content: answer },
        { role: 'assistant', content: aiResponse }
      ]);

      return aiResponse;
    } catch (error) {
      console.error('Error processing answer:', error);
      throw error;
    }
  };

  // ... (The rest of the component's functions and JSX remain the same) ...

  // Handle sending message
  const handleSendMessage = async () => {
    // ...
  };

  // Complete interview and navigate
  const completeInterview = () => {
    setIsInterviewComplete(true);
    const results = generateInterviewResults();

    // NOTE: This navigation is still broken as it doesn't pass state.
    // See previous analysis for the fix.
    navigate('/nerv-summary', {
      state: {
        summary: results.summary,
        messages: results.messages,
        questionExpressions: Array.from(questionExpressions.entries()),
        resumeData: resumeData
      }
    });
  };

  // ... (The entire JSX for rendering the component remains the same) ...

};

export default Interview;