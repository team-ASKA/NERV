import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Mic, MicOff, Camera, CameraOff, Volume2, VolumeX,
  Loader2, Send, User, Bot, MessageSquare, Brain,
  Menu, Edit, LogOut, Linkedin, Globe, X, FileText, ArrowLeft, Download, ChevronLeft, ChevronRight, ArrowRight
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { FaVideo } from 'react-icons/fa';
import { HumeClient } from "hume";
import { auth, db, storage } from '../lib/firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import { extractTextFromPDF } from '../services/pdfService';
import ReactMarkdown from 'react-markdown';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'ai';
  timestamp: Date;
  responseTime?: number;
}

interface Question {
  id: number;
  text: string;
  isAsked: boolean;
}

// Add these interfaces at the top of your file
interface EmotionData {
  name: string;
  score: number;
}

interface EmotionItem {
  question: string;
  answer: string;
  emotions: EmotionData[];
  timestamp: string;
  responseTime?: number;
  isFollowUp?: boolean;
}

// Add interview results interface to match the structure in Results.tsx
interface InterviewResults {
  id: string;
  summary?: string;
  emotionsData: EmotionItem[];
  transcriptions: string[];
  timestamp: string;
}

const pulseStyle = `
  @keyframes pulsate {
    0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
    70% { box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); }
    100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
  }
  
  .pulsate-recording {
    animation: pulsate 1.5s infinite;
  }
`;

// Constants for Azure OpenAI
const AZURE_OPENAI_ENDPOINT = "https://kushal43.openai.azure.com";
const AZURE_OPENAI_DEPLOYMENT = "gpt-4";
const AZURE_OPENAI_API_VERSION = "2025-01-01-preview";

// Mock questions for fallback
const mockQuestions: Question[] = [
  {
    id: 1,
    text: "Can you tell me about your experience and skills?",
    isAsked: true
  },
  {
    id: 2,
    text: "What are your greatest strengths and weaknesses?",
    isAsked: false
  },
  {
    id: 3,
    text: "Where do you see yourself in 5 years?",
    isAsked: false
  },
  {
    id: 4,
    text: "Why should we hire you?",
    isAsked: false
  },
  {
    id: 5,
    text: "Tell me about a challenging project you worked on.",
    isAsked: false
  },
  {
    id: 6,
    text: "Explain a complex technical concept you understand well.",
    isAsked: false
  },
  {
    id: 7,
    text: "How do you approach debugging a complex issue?",
    isAsked: false
  }
];

// Declare global window property for audio playing state
declare global {
  interface Window {
    audioPlaying: boolean;
  }
}

// Initialize the global audio playing state
if (typeof window !== 'undefined') {
  window.audioPlaying = false;
}

// Update the speakResponse function to handle sequential TTS and prevent duplicate speech
const speakResponse = async (text: string) => {
  // Add debug logging to track speech request
  // Global variable to track if audio is currently playing
  if (window.audioPlaying) {
    return;
  }

  try {
    // Set global flag to prevent concurrent speech
    window.audioPlaying = true;

    // Get the Azure TTS API key from environment variables
    const ttsApiKey = import.meta.env.VITE_APP_AZURE_TTS_API_KEY || '';
    const endpoint = "https://kusha-m8t3pks8-swedencentral.cognitiveservices.azure.com";
    const deploymentName = "tts";

    // Ensure we have text to convert
    if (!text || text.trim() === '') {
      window.audioPlaying = false;
      return;
    }

    // Prepare the request payload
    const payload = {
      model: "tts-1",
      input: text,
      voice: "nova"
    };

    // Make the API request
    const response = await fetch(
      `${endpoint}/openai/deployments/${deploymentName}/audio/speech?api-version=2024-05-01-preview`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': ttsApiKey,
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Azure TTS API error:", errorText);
      window.audioPlaying = false;
      throw new Error(`Failed to convert text to speech: ${response.status}`);
    }

    // Get the audio data
    const audioBlob = await response.blob();

    // Create an audio element and play it
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);

    // Return a promise that resolves when the audio finishes playing
    return new Promise<void>((resolve) => {
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        window.audioPlaying = false;
        resolve();
      };
      audio.play().catch(error => {
        console.error("Error playing audio:", error);
        window.audioPlaying = false;
        resolve();
      });
    });
  } catch (error) {
    console.error("Error in speakResponse:", error);
    window.audioPlaying = false;
    return Promise.resolve();
  }
};

const Interview = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState<string | null>(null);
  const [userInput, setUserInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([
    {
      id: 1,
      text: "Can you tell me about your experience and skills?",
      isAsked: true
    }
  ]);
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasVideoPermission, setHasVideoPermission] = useState(false);
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [viewMode, setViewMode] = useState<'chat' | 'camera'>('chat');
  const [transcription, setTranscription] = useState('');
  const [isUserTurn, setIsUserTurn] = useState(false);
  const [interviewState, setInterviewState] = useState<'idle' | 'ai-speaking' | 'ai-thinking' | 'user-speaking'>('idle');
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [audioChunks, setAudioChunks] = useState<Blob[]>([]);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [humeApiKey, setHumeApiKey] = useState<string>(
    import.meta.env.VITE_HUME_API_KEY || ''
  );
  const [humeSecretKey, setHumeSecretKey] = useState<string>(
    import.meta.env.VITE_HUME_SECRET_KEY || ''
  );
  const [facialExpressions, setFacialExpressions] = useState<any>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [captureInterval, setCaptureInterval] = useState<NodeJS.Timeout | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [ttsApiKey, setTtsApiKey] = useState<string>(
    import.meta.env.VITE_APP_AZURE_TTS_API_KEY || ''
  );
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [userDetails, setUserDetails] = useState<{
    name: string;
    email: string;
    resumeURL: string | null;
    resumeName: string | null;
    linkedinURL: string | null;
    portfolioURL: string | null;
  }>({
    name: '',
    email: '',
    resumeURL: null,
    resumeName: null,
    linkedinURL: null,
    portfolioURL: null
  });
  const [isInitialized, setIsInitialized] = useState(false);
  const [currentEmotions, setCurrentEmotions] = useState<EmotionData[]>([]);
  const [interviewIntroduction, setInterviewIntroduction] = useState<string>(
    "Hello! I'm your NERV interviewer today. Let's begin our technical interview."
  );
  const [conversationHistory, setConversationHistory] = useState<{ role: string; content: string }[]>([
    { role: "system", content: "You are NERV, an AI technical interviewer conducting a job interview." }
  ]);
  const [followUpCount, setFollowUpCount] = useState<number>(0);
  const [userHasAnswered, setUserHasAnswered] = useState<boolean>(false);
  const [introductionSpoken, setIntroductionSpoken] = useState<boolean>(false);
  // We're using window.audioPlaying instead of this state to prevent race conditions
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState<number>(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [isTimeUp, setIsTimeUp] = useState<boolean>(false);
  const [startTime, setStartTime] = useState<number>(0);
  const [questionStartTimes, setQuestionStartTimes] = useState<number[]>([]);
  const [questionDurations, setQuestionDurations] = useState<number[]>([]);
  const [progress, setProgress] = useState<number>(0);
  const [responseStartTime, setResponseStartTime] = useState<number | null>(null);
  const [transcriptions, setTranscriptions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Add interview duration constant based on localStorage or default
  const INTERVIEW_DURATION = (() => {
    const config = JSON.parse(localStorage.getItem('interviewConfig') || '{}');
    return (config.interviewDuration || 15) * 60 * 1000; // Convert minutes to milliseconds
  })();

  const QUESTION_TIME_LIMIT = 5 * 60; // 5 minutes per question in seconds

  // Create a Hume client instance
  const humeClient = useMemo(() =>
    new HumeClient({
      apiKey: humeApiKey,
    }),
    [humeApiKey]
  );

  // Create a ref for scrolling to the last message
  const lastMessageRef = useRef<HTMLDivElement>(null);

  // Effect to scroll to the last message when messages change
  useEffect(() => {
    if (lastMessageRef.current) {
      lastMessageRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Move handleEndInterview and handleNextQuestion above the timer effect
  // to ensure they're defined before they're used
  
  const handleEndInterview = async () => {
    setIsThinking(true);

    try {
      // Get all stored interview data from localStorage
      const interviewDataString = localStorage.getItem('interviewData') || '[]';
      let interviewData: EmotionItem[] = [];

      try {
        interviewData = JSON.parse(interviewDataString);
      } catch (e) {
        console.error("Error parsing interview data:", e);
      }

      // Get all user messages for transcriptions
      const userMessages = messages
        .filter(msg => msg.sender === 'user')
        .map(msg => msg.text);
        
      // Create a map of question-answer pairs from messages
      const questionAnswerPairs: EmotionItem[] = [];
      let currentQuestion = "";

      messages.forEach((msg, index) => {
        if (msg.sender === 'ai') {
          currentQuestion = msg.text;
        } else if (msg.sender === 'user' && currentQuestion && index > 0) {
          // If we have a question and this is a user answer
          questionAnswerPairs.push({
            question: currentQuestion,
            answer: msg.text,
            emotions: currentEmotions.length > 0 ? [...currentEmotions] : [],
            timestamp: new Date(msg.timestamp).toISOString(),
            responseTime: msg.responseTime || 0,
            isFollowUp: index > 2 // Mark as follow-up if not the first interaction
          });
          
          // Don't reset currentQuestion to allow for multiple answers to same question
        }
      });

      // Merge data from localStorage with message-based pairs, preferring localStorage data for duplicates
      const uniqueQuestions = new Set<string>();
      
      // First add interviewData items (they have emotions already)
      interviewData.forEach(item => {
        uniqueQuestions.add(item.question);
      });
      
      // Then add questionAnswerPairs if question is not already included
      questionAnswerPairs.forEach(item => {
        if (!uniqueQuestions.has(item.question)) {
          interviewData.push(item);
          uniqueQuestions.add(item.question);
        }
      });

      // Get unique transcriptions from the interview data and user messages
      const allTranscriptions = [
        ...interviewData.map(item => item.answer),
        ...userMessages
      ];
      
      // Remove duplicates while preserving order
      const transcriptionsSet = new Set<string>();
      const transcriptions = allTranscriptions.filter(text => {
        if (transcriptionsSet.has(text)) {
          return false;
        }
        transcriptionsSet.add(text);
        return true;
      });

      // Create interview result object with unique ID
      const interviewId = Date.now().toString();
      const interviewResults: InterviewResults = {
        id: interviewId,
        emotionsData: interviewData,
        transcriptions,
        timestamp: new Date().toISOString()
      };

      // Try to generate a summary if possible
      try {
        const summary = await generateInterviewSummary();
        interviewResults.summary = summary;
      } catch (summaryError) {
        console.error("Error generating summary:", summaryError);
        interviewResults.summary = "A summary could not be generated due to an error.";
      }

      // Store current interview results
      localStorage.setItem('interviewResults', JSON.stringify(interviewResults));

      // Also store current messages for backup
      localStorage.setItem('interviewMessages', JSON.stringify(messages));

      // Store in interview history
      const interviewHistory = JSON.parse(localStorage.getItem('interviewHistory') || '[]');
      interviewHistory.push(interviewResults);
      localStorage.setItem('interviewHistory', JSON.stringify(interviewHistory));

      // Clear the interview data for next session
      localStorage.removeItem('interviewData');

      // Update interview count in Firebase if user is logged in
      if (currentUser) {
        try {
          const userDocRef = doc(db, 'users', currentUser.uid);

          // Get current user data
          const userDoc = await getDoc(userDocRef);
          const userData = userDoc.exists() ? userDoc.data() : {};

          // Increment interviews completed count
          const currentCount = userData.interviewsCompleted || 0;

          await updateDoc(userDocRef, {
            interviewsCompleted: currentCount + 1,
            lastInterviewDate: new Date().toISOString()
          });
        } catch (dbError) {
          console.error("Error updating interview count:", dbError);
          // Continue even if database update fails
        }
      }

      // Navigate to results
      navigate('/results');
    } catch (error) {
      console.error("Error ending interview:", error);
      alert("There was an error generating your interview results. Please try again.");
    } finally {
      setIsThinking(false);
    }
  };

  const handleNextQuestion = () => {
    if (currentQuestionIndex < questions.length - 1) {
      const now = Date.now();
      setCurrentQuestionIndex(prevIndex => prevIndex + 1);
      setQuestionStartTimes(prevTimes => [...prevTimes, now]);
      setQuestionDurations(prevDurations => [...prevDurations, 0]);
    } else {
      handleEndInterview();
    }
  };

  // Add question timer effect
  useEffect(() => {
    // Don't run timer if we're still loading
    if (isLoading) return;
    
    // Make sure we have a valid start time
    if (!startTime) return;
    // Initialize progress tracking
    const initialProgress = 0;
    setProgress(initialProgress);
    
    const timer = setInterval(() => {
      const now = Date.now();
      
      // Update overall interview time remaining
      const elapsed = now - startTime;
      const remaining = Math.max(0, INTERVIEW_DURATION - elapsed);
      setTimeRemaining(remaining);
      
      // Calculate time-based progress (0-100%)
      const timeProgress = Math.min(100, (elapsed / INTERVIEW_DURATION) * 100);
      
      // Calculate question-based progress
      const questionProgress = ((currentQuestionIndex + 1) / questions.length) * 100;
      
      // Use a weighted average of time progress and question progress to make the bar smoother
      // 70% weight to time progress, 30% to question progress
      const combinedProgress = (timeProgress * 0.7) + (questionProgress * 0.3);
      setProgress(combinedProgress);
      
      // Log time tracking information occasionally
      if (elapsed % 10000 < 1000) { // Log every ~10 seconds
        console.log(`Interview progress: ${timeProgress.toFixed(1)}%, Time remaining: ${(remaining/1000/60).toFixed(1)} minutes`);
      }
      
      if (remaining === 0 && !isTimeUp) {
        setIsTimeUp(true);
        handleEndInterview();
        return;
      }
      
      // Update current question duration
      if (questionStartTimes[currentQuestionIndex]) {
        const questionElapsed = now - questionStartTimes[currentQuestionIndex];
        
        // Update duration in state
        setQuestionDurations(prevDurations => {
          const newDurations = [...prevDurations];
          newDurations[currentQuestionIndex] = questionElapsed;
          return newDurations;
        });
        
        // Log question time occasionally
        if (questionElapsed % 10000 < 1000) { // Log every ~10 seconds
          const timeLeftInQuestion = (QUESTION_TIME_LIMIT * 1000) - questionElapsed;
          console.log(`Question ${currentQuestionIndex + 1} time remaining: ${(timeLeftInQuestion/1000).toFixed(1)} seconds`);
        }
        
        // Check if current question time limit is reached
        if (questionElapsed >= QUESTION_TIME_LIMIT * 1000 && !isTimeUp) {
          console.log(`Question ${currentQuestionIndex + 1} time limit reached, moving to next question`);
          
          // Don't move automatically for the introduction question
          if (currentQuestionIndex === 0 && questions[0]?.text.includes("introduce yourself")) {
            console.log("Introduction question time expired, but allowing more time for response");
          } else {
            handleNextQuestion();
          }
        }
      }
    }, 1000);
    
    return () => clearInterval(timer);
  }, [
    startTime, 
    currentQuestionIndex, 
    questionStartTimes, 
    isTimeUp, 
    isLoading, 
    questions.length, 
    INTERVIEW_DURATION, 
    QUESTION_TIME_LIMIT
  ]);

  const fetchUserDetailsAndStartInterview = async () => {
    try {
      // Set loading state to prevent premature navigation
      setIsLoading(true);
      
      // Get resume text from localStorage (if available)
      const resumeText = localStorage.getItem('resumeText');
      
      // Initialize questions based on resume or use mock questions
      let interviewQuestions: string[];
      if (resumeText) {
        try {
          interviewQuestions = await initializeInterview(resumeText);
        } catch (error) {
          console.error('Error initializing interview with resume:', error);
          interviewQuestions = getMockQuestions();
        }
      } else {
        interviewQuestions = getMockQuestions();
      }
      
      // Format questions into Question objects - make the first question explicitly ask for an introduction
      const introductionQuestion = "Could you please introduce yourself and tell me about your background?";
      
      const formattedQuestions = [
        { id: 1, text: introductionQuestion, isAsked: true },
        ...interviewQuestions.map((text, index) => ({
          id: index + 2,  // Start at 2 since introduction is 1
          text,
          isAsked: false
        }))
      ];
      
      // Set questions in state
      setQuestions(formattedQuestions);
      
      // Initialize interview state
      const now = Date.now();
      setStartTime(now);
      setTimeRemaining(INTERVIEW_DURATION);
      setIsTimeUp(false);
      setCurrentQuestionIndex(0);
      setCurrentQuestion(0); // Make sure both indices are synced
      setQuestionStartTimes([now]);
      setQuestionDurations([0]);
      
      // Reset interview data
      localStorage.removeItem('interviewData');
      
      // Add introduction message
      const introMessage: Message = {
        id: Date.now().toString(),
        text: interviewIntroduction,
        sender: 'ai',
        timestamp: new Date()
      };
      
      // Add the first question (introduction request)
      const questionMsg: Message = {
        id: Date.now().toString() + '-intro-question',
        text: introductionQuestion,
        sender: 'ai',
        timestamp: new Date()
      };
      
      // Set both messages at once
      setMessages([introMessage, questionMsg]);
      
      // Set initial states first (loading false)
      setIsLoading(false);
      
      // Sequence for speaking and recording
      try {
        // First speak the introduction
        setIsSpeaking(true);
        await speakResponse(interviewIntroduction);
        setIsSpeaking(false);
        
        // Small pause between messages
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Then speak the first question
        setIsSpeaking(true);
        await speakResponse(introductionQuestion);
        setIsSpeaking(false);
        
        // Set user's turn after speaking is done
        setIsUserTurn(true);
        setInterviewState('idle');
        
        // DO NOT automatically start recording - let user click the mic button
        // This restores the original click-to-speak functionality
      } catch (error) {
        console.error('Error in interview sequence:', error);
        setIsLoading(false);
        setIsSpeaking(false);
        setIsUserTurn(true);
        setInterviewState('idle');
      }
    } catch (error) {
      console.error('Error initializing interview:', error);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchUserDetailsAndStartInterview();
  }, []); // Remove fetchUserDetailsAndStartInterview from dependencies

  // Scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Add this function to check if text contains keywords indicating moving to next question
  const shouldMoveToNextQuestion = (text: string): boolean => {
    const nextQuestionKeywords = [
      'next question', 'next topic', 'move on', 'let\'s continue',
      'proceed to', 'go to the next', 'following question'
    ];

    const lowerText = text.toLowerCase();
    return nextQuestionKeywords.some(keyword => lowerText.includes(keyword));
  };

  const startRecording = async () => {
    try {
      setIsRecording(true);
      setInterviewState('user-speaking');
      setTranscriptionError(null);

      // Clear any previous transcription display
      setTranscription('');

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const audioChunks: BlobPart[] = [];

      recorder.ondataavailable = (e) => {
        audioChunks.push(e.data);
      };

      // Capture emotions once at the start of recording if camera is on
      if (isCameraOn && videoRef.current) {
        captureAndAnalyzeFrame();
      }

      recorder.onstop = async () => {
        // Capture emotions once more after recording is complete
        if (isCameraOn && videoRef.current) {
          await captureAndAnalyzeFrame();
        }

        try {
          setIsTranscribing(true);
          setIsRecording(false);

          const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
          const formData = new FormData();
          formData.append('file', audioBlob, 'recording.webm');

          // Get the Azure API key from environment variables
          const azureApiKey = import.meta.env.VITE_APP_AZURE_API_KEY;
          const endpoint = "https://kusha-m8fgqe1k-eastus2.cognitiveservices.azure.com";
          const deploymentName = "whisper";

          // Send to Azure for transcription
          const response = await fetch(
            `${endpoint}/openai/deployments/${deploymentName}/audio/transcriptions?api-version=2023-09-01-preview`,
            {
              method: 'POST',
              headers: {
                'api-key': azureApiKey,
              },
              body: formData
            }
          );

          if (!response.ok) {
            const errorText = await response.text();
            console.error("Azure API error response:", errorText);
            throw new Error(`Transcription failed: ${response.status} ${response.statusText}`);
          }

          const result = await response.json();


          // Azure Whisper returns text in the 'text' field
          if (result.text) {
            const transcribedText = result.text;
            setTranscription(transcribedText);

            // Add user message to chat
            const userMessage: Message = {
              id: Date.now().toString(),
              text: transcribedText,
              sender: 'user',
              timestamp: new Date()
            };

            // Update messages state with the new user message
            setMessages(prev => [...prev, userMessage]);

            // Update conversation history with user's message
            setConversationHistory(prev => [
              ...prev,
              { role: "user", content: transcribedText }
            ]);

            // Mark that the user has answered the current question
            setUserHasAnswered(true);

            // Get current question text and store answer with emotions
            const currentQuestionText = questions[currentQuestion]?.text || "Unknown question";
            storeAnswerWithEmotions(currentQuestionText, transcribedText, currentEmotions);

            // Check if user wants to move to next question
            const userWantsNextQuestion = shouldMoveToNextQuestion(transcribedText);

            setIsThinking(true);
            setInterviewState('ai-thinking');

            try {
              // If user wants to move to next question and we're not at the last question
              if (userWantsNextQuestion && currentQuestion < questions.length - 1) {
                const nextQuestionIndex = currentQuestion + 1;
                setCurrentQuestion(nextQuestionIndex);
                setFollowUpCount(0);
                setUserHasAnswered(false); // Reset user answer flag for new question

                // Mark the next question as asked
                setQuestions(prevQuestions =>
                  prevQuestions.map((q, idx) =>
                    idx === nextQuestionIndex ? { ...q, isAsked: true } : q
                  )
                );

                setIsThinking(false);
                setIsSpeaking(true);
                setInterviewState('ai-speaking');

                const transitionMessage = "Let's move on to the next question.";
                const nextQuestionText = questions[nextQuestionIndex].text;

                // Add transition and question messages
                const transitionMsg: Message = {
                  id: Date.now().toString() + '-transition',
                  text: transitionMessage,
                  sender: 'ai',
                  timestamp: new Date()
                };

                const questionMsg: Message = {
                  id: Date.now().toString() + '-question',
                  text: nextQuestionText,
                  sender: 'ai',
                  timestamp: new Date(Date.now() + 100)
                };

                setMessages(prev => [...prev, transitionMsg, questionMsg]);

                // Update conversation history
                setConversationHistory(prev => [
                  ...prev,
                  { role: "assistant", content: transitionMessage },
                  { role: "assistant", content: nextQuestionText }
                ]);

                // Speak the transition and question
                await speakResponse(transitionMessage);
                await speakResponse(nextQuestionText);

                setIsSpeaking(false);
                setInterviewState('idle');
                setIsUserTurn(true);

                return;
              }

              // Process the user's answer with GPT to get a contextual response
              const feedback = await processUserAnswer(transcribedText);

              // AI stops thinking and starts speaking
              setIsThinking(false);
              setIsSpeaking(true);
              setInterviewState('ai-speaking');

              // Add AI response
              const feedbackMessage: Message = {
                id: Date.now().toString() + '-feedback',
                text: feedback,
                sender: 'ai',
                timestamp: new Date()
              };

              setMessages(prev => [...prev, feedbackMessage]);

              // Update conversation history with AI's response
              setConversationHistory(prev => [
                ...prev,
                { role: "assistant", content: feedback }
              ]);

              // Check if AI wants to move to next question
              const aiWantsNextQuestion = shouldMoveToNextQuestion(feedback);

              // Speak the feedback
              await speakResponse(feedback);

              // If AI wants to move to next question and we're not at the last question
              if (aiWantsNextQuestion && currentQuestion < questions.length - 1) {
                const nextQuestionIndex = currentQuestion + 1;
                setCurrentQuestion(nextQuestionIndex);
                setFollowUpCount(0);
                setUserHasAnswered(false); // Reset user answer flag for new question

                // Mark the next question as asked
                setQuestions(prevQuestions =>
                  prevQuestions.map((q, idx) =>
                    idx === nextQuestionIndex ? { ...q, isAsked: true } : q
                  )
                );

                const nextQuestionText = questions[nextQuestionIndex].text;

                // Add next question message
                const questionMsg: Message = {
                  id: Date.now().toString() + '-question',
                  text: nextQuestionText,
                  sender: 'ai',
                  timestamp: new Date()
                };

                setMessages(prev => [...prev, questionMsg]);

                // Update conversation history
                setConversationHistory(prev => [
                  ...prev,
                  { role: "assistant", content: nextQuestionText }
                ]);

                // Speak the next question
                await speakResponse(nextQuestionText);

                setIsSpeaking(false);
                setInterviewState('idle');
                setIsUserTurn(true);

                return;
              }

              // After speaking feedback, set the interview state back to idle to allow user to respond
              setIsSpeaking(false);
              setInterviewState('idle');
              setIsUserTurn(true);

              // Get interview configuration from localStorage or use defaults
              const interviewConfig = JSON.parse(localStorage.getItem('interviewConfig') || '{ "questionCount": 7, "difficultyLevel": "medium" }');
              const configuredQuestionCount = interviewConfig.questionCount || 7;

              // Check if we've reached the last question based on configured question count
              if (currentQuestion >= configuredQuestionCount - 1) {
                // Interview complete
                const completionMessage = "That concludes our interview. Thank you for your responses! I've gathered comprehensive insights from our discussion and will now generate your detailed feedback report.";

                // Add completion message
                setMessages(prev => [
                  ...prev,
                  {
                    id: Date.now().toString() + '-complete',
                    text: completionMessage,
                    sender: 'ai',
                    timestamp: new Date(Date.now() + 100)
                  }
                ]);

                // Update conversation history
                setConversationHistory(prev => [
                  ...prev,
                  { role: "assistant", content: completionMessage }
                ]);

                // Speak the completion message
                setIsSpeaking(true);
                setInterviewState('ai-speaking');
                await speakResponse(completionMessage);

                // Navigate to results after a delay
                setTimeout(() => {
                  handleEndInterview();
                }, 1000);
              }
            } catch (error) {
              console.error('Error processing transcribed text:', error);

              // Fallback to a simple response if processing fails
              setIsThinking(false);
              setIsSpeaking(true);
              setInterviewState('ai-speaking');

              const fallbackResponse = "I understand. Let's move on to the next question.";
              const nextQuestion = questions[currentQuestion + 1]?.text || "Can you tell me more about your technical skills?";

              setMessages(prev => [
                ...prev,
                {
                  id: Date.now().toString() + '-fallback',
                  text: fallbackResponse,
                  sender: 'ai',
                  timestamp: new Date()
                },
                {
                  id: Date.now().toString() + '-next',
                  text: nextQuestion,
                  sender: 'ai',
                  timestamp: new Date(Date.now() + 100)
                }
              ]);

              // Speak the fallback response and next question
              speakResponse(fallbackResponse).then(() => {
                return speakResponse(nextQuestion);
              }).then(() => {
                setIsSpeaking(false);
                setInterviewState('idle');
                setIsUserTurn(true);

                if (currentQuestion < questions.length - 1) {
                  setCurrentQuestion(prev => prev + 1);

                  // Mark the next question as asked
                  setQuestions(prevQuestions =>
                    prevQuestions.map((q, idx) =>
                      idx === currentQuestion + 1 ? { ...q, isAsked: true } : q
                    )
                  );
                }
              });
            }
          } else {
            setTranscriptionError('No transcription returned');
            setInterviewState('idle');
            setIsUserTurn(true);
          }
        } catch (error) {
          console.error('Transcription error:', error);
          setTranscriptionError(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
          setInterviewState('idle');
          setIsUserTurn(true);
        } finally {
          setIsTranscribing(false);
        }
      };

      recorder.start();
      setMediaRecorder(recorder);

    } catch (error) {
      console.error('Error starting recording:', error);
      setIsRecording(false);
      setTranscriptionError(`Microphone error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && isRecording) {
      // Capture emotions before stopping recording
      captureAndAnalyzeFrame();

      // Store current question for reference
      const currentQuestionText = questions[currentQuestion]?.text || "Unknown question";
      localStorage.setItem('currentQuestion', currentQuestionText);

      mediaRecorder.stop();
      // Note: We don't set isRecording to false here because that's handled in the onstop handler
    }
  };

  const toggleRecording = () => {
    if (interviewState === 'ai-speaking' || interviewState === 'ai-thinking') {
      // Can't record while AI is speaking or thinking
   
      return;
    }
    
    if (!isRecording) {
      // Start recording
      startRecording();
    } else {
      // Stop recording
      stopRecording();
    }
  };

  const toggleSpeech = () => {
    if (interviewState === 'ai-speaking') {
      // Stop AI from speaking
      setIsSpeaking(false);
      setInterviewState('idle');
      setIsUserTurn(true);
    } else if (isSpeaking === false && !isRecording && !isThinking) {
      // Restart AI speaking if it's not already speaking and user is not recording
      setIsSpeaking(true);
      setInterviewState('ai-speaking');

      // Simulate AI finishing speaking after 3 seconds
      setTimeout(() => {
        setIsSpeaking(false);
        setInterviewState('idle');
        setIsUserTurn(true);
      }, 3000);
    }
  };

  const captureAndAnalyzeFrame = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || !isCameraOn || !videoStream) return;

    try {
      setIsAnalyzing(true);
      // Capture frame from video
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');

      if (!context) return;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Convert to blob
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.8);
      });

      if (!blob) return;
      // Create a File object from the blob
      const file = new File([blob], "frame.jpg", { type: "image/jpeg" });

      // Start inference job for facial analyis
      const formData = new FormData();
      formData.append('file', file);
      formData.append('json', JSON.stringify({
        models: { face: {} }
      }));

      const jobResponse = await fetch('https://api.hume.ai/v0/batch/jobs', {
        method: 'POST',
        headers: { 'X-Hume-Api-Key': humeApiKey },
        body: formData,
      });

      if (!jobResponse.ok) {
        const errorText = await jobResponse.text();
        console.error("Job creation error:", errorText);
        throw new Error(`API error: ${jobResponse.status}`);
      }

      const jobData = await jobResponse.json();
      const jobId = jobData.job_id;
      console.log("Job created with ID:", jobId);

      // Poll for job completion
      let jobStatus = 'RUNNING';
      let attempts = 0;
      const maxAttempts = 30; // Maximum polling attempts

      console.log("Polling for job completion...");
      while (jobStatus === 'RUNNING' && attempts < maxAttempts) {
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 1000));

        const statusResponse = await fetch(`https://api.hume.ai/v0/batch/jobs/${jobId}`, {
          method: 'GET',
          headers: { 'X-Hume-Api-Key': humeApiKey },
        });

        if (!statusResponse.ok) {
          console.error("Status check failed:", await statusResponse.text());
          break;
        }

        const statusData = await statusResponse.json();
        jobStatus = statusData.state?.status || statusData.status;
        console.log(`Job status (attempt ${attempts}): ${jobStatus}`);

        if (jobStatus === 'COMPLETED') {
          // Add a small delay to ensure predictions are ready
          await new Promise(resolve => setTimeout(resolve, 1000));

          // Try up to 3 times to get predictions
          let predictionsFound = false;
          for (let predAttempt = 1; predAttempt <= 3; predAttempt++) {
            console.log(`Fetching predictions (attempt ${predAttempt})...`);

            const predictionsResponse = await fetch(`https://api.hume.ai/v0/batch/jobs/${jobId}/predictions`, {
              method: 'GET',
              headers: {
                'X-Hume-Api-Key': humeApiKey,
                'accept': 'application/json; charset=utf-8'
              },
            });

            if (!predictionsResponse.ok) {
              console.error(`Predictions fetch failed (attempt ${predAttempt}):`, await predictionsResponse.text());
              if (predAttempt < 3) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                continue;
              }
              break;
            }

            const predictions = await predictionsResponse.json();
            console.log(`Predictions response (attempt ${predAttempt}):`, predictions);

            if (predictions && Array.isArray(predictions) && predictions.length > 0) {
              // Check if we have predictions array in the results
              if (predictions[0].results?.predictions &&
                Array.isArray(predictions[0].results.predictions) &&
                predictions[0].results.predictions.length > 0) {

                // Get the first prediction which contains the file data
                const filePrediction = predictions[0].results.predictions[0];
                console.log("File prediction:", filePrediction);

                // Check if we have face model results with grouped_predictions
                if (filePrediction.models?.face?.grouped_predictions &&
                  filePrediction.models.face.grouped_predictions.length > 0 &&
                  filePrediction.models.face.grouped_predictions[0].predictions &&
                  filePrediction.models.face.grouped_predictions[0].predictions.length > 0) {

                  // Extract the emotions array from the first prediction
                  const emotions = filePrediction.models.face.grouped_predictions[0].predictions[0].emotions;

                  if (emotions && emotions.length > 0) {
                    console.log("Emotions found:", emotions.length, "emotions");
                    setFacialExpressions({ emotions });
                    // Store the current emotions in state and localStorage
                    setCurrentEmotions(emotions);
                    localStorage.setItem('currentEmotions', JSON.stringify(emotions));
                    console.log("Stored emotions in localStorage:", emotions.length, "emotions");

                    predictionsFound = true;
                  } else {
                    console.log("No emotions array in the prediction");
                  }

                  break;
                } else {
                  console.log("No grouped_predictions in face model results");
                }
              }
            }

            if (predAttempt < 3 && !predictionsFound) {
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
          }

          if (!predictionsFound) {
            console.log("Failed to get valid predictions after multiple attempts");
          }

          break;
        } else if (jobStatus === 'FAILED') {
          console.error("Job failed");
          break;
        }
      }

      if (attempts >= maxAttempts) {
        console.log("Max polling attempts reached");
      }

    } catch (error) {
      console.error('Error analyzing facial expressions:', error);
    } finally {
      setIsAnalyzing(false);
    }
  }, [videoRef, canvasRef, isCameraOn, videoStream, humeApiKey]);

  const toggleCamera = async () => {
    if (isCameraOn) {
      // Turn off camera
      if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        setVideoStream(null);
      }
      setIsCameraOn(false);

      // Stop the analysis interval
      if (captureInterval) {
        clearInterval(captureInterval);
        setCaptureInterval(null);
      }
    } else {
      // Turn on camera
      try {
        setCameraError(null);

        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false
        });

        setVideoStream(stream);

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        setIsCameraOn(true);
        setHasVideoPermission(true);

        // Initial emotion capture when camera starts
        captureAndAnalyzeFrame();

        // We're removing the interval-based approach as requested
        // and will only capture emotions when needed
      } catch (err) {
        setHasVideoPermission(false);
        setCameraError('Could not access camera. Please check permissions.');
      }
    }
  };

  useEffect(() => {
    if (videoRef.current && videoStream) {
      videoRef.current.srcObject = videoStream;
    }

    return () => {
      if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
      }

      if (captureInterval) {
        clearInterval(captureInterval);
      }
    };
  }, [videoStream, captureInterval]);

  // Handle sending message
  const handleSendMessage = async () => {
    if (!userInput.trim()) return;

    const currentTime = Date.now();
    const responseTime = responseStartTime ? (currentTime - responseStartTime) / 1000 : 0;

    const newMessage: Message = {
      id: Date.now().toString(),
      text: userInput,
      sender: 'user',
      timestamp: new Date(),
      responseTime
    };

    setMessages(prev => [...prev, newMessage]);
    setUserInput('');
    setIsThinking(true);

    try {
      // Store the answer with emotions
      const isFollowUp = messages.length > 2; // If there are already 2+ messages, this is a follow-up
      
      // Store the answer with emotions data, response time, and follow-up status
      storeAnswerWithEmotions(
        currentQuestion || messages[messages.length - 1]?.text || '',
        userInput,
        currentEmotions,
        responseTime,
        isFollowUp
      );
      
      setTranscriptions(prev => [...prev, userInput]);

      // Process the answer
      const response = await processAnswer(
        currentQuestion || '',
        userInput,
        currentEmotions
      );

      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: response,
        sender: 'ai',
        timestamp: new Date()
      };

      setMessages(prev => [...prev, aiMessage]);
      setResponseStartTime(Date.now()); // Start timing for next response
      setCurrentQuestion(response); // Update current question to the AI's response
    } catch (error) {
      console.error('Error processing answer:', error);
      setError('Failed to process your answer. Please try again.');
    } finally {
      setIsThinking(false);
    }
  };

  // Generate random feedback (in a real app, this would be AI-generated)
  const generateFeedback = () => {
    const feedbacks = [
      "That's a great point. I appreciate your thoughtful response.",
      "Interesting perspective. Let me ask you something else.",
      "Thank you for sharing that. Your approach makes a lot of sense.",
      "I see what you mean. That's a solid explanation.",
      "That's helpful context. Let's move on to the next question."
    ];

    const randomFeedback = feedbacks[Math.floor(Math.random() * feedbacks.length)];

    return randomFeedback;
  };

  // Use the progress value from state
  // const progress = ((currentQuestion + 1) / questions.length) * 100;

  // Determine if recording button should be disabled
  const isRecordingDisabled = interviewState === 'ai-speaking' || interviewState === 'ai-thinking';

  // Determine if send button should be disabled
  const isSendDisabled = !userInput.trim() || isThinking || isSpeaking;

  // Update the processUserAnswer function to include emotions in the prompt
  const processUserAnswer = async (answer: string): Promise<string> => {
    try {
      // Get the Azure OpenAI API key from environment variables
      const azureOpenAIKey = import.meta.env.VITE_APP_AZURE_OPENAI_API_KEY;

      // Check if this is the first response (introduction)
      const isIntroduction = messages.length <= 1;

      // Get current question text
      const currentQuestionText = questions[currentQuestion]?.text || "No question available";

      // Store answer with emotions for results page
      storeAnswerWithEmotions(currentQuestionText, answer, currentEmotions);

      // Format emotions data for the prompt
      let emotionsText = "";
      if (currentEmotions && currentEmotions.length > 0) {
        // Sort emotions by score in descending order and take top 3
        const topEmotions = [...currentEmotions]
          .sort((a, b) => b.score - a.score)
          .slice(0, 3);

        emotionsText = topEmotions
          .map(e => `${e.name}: ${(e.score * 100).toFixed(0)}%`)
          .join(", ");
      } else {
        emotionsText = "No emotional data available";
      }

      // If this is the introduction, use a special prompt
      const prompt = isIntroduction
        ? `
          The candidate has just introduced themselves: "${answer}"
          
          Detected emotions: ${emotionsText}
          
          You are a technical interviewer with a no-nonsense, direct personality.
          
          Acknowledge their introduction with 1 brief sentence only. Do not say "thank you" or use overly polite language.
          Then immediately ask the first technical question. Be direct, professional, and slightly intimidating.
          `
        : `
          You are a technical interviewer with high standards and a critical eye for detail.
          
          Candidate's answer: "${answer}"
          
          Detected emotions: ${emotionsText}
          
          Provide a response that:
          1. Is direct and blunt - don't be afraid to be judgmental if warranted
          2. Points out technical inaccuracies without sugarcoating
          3. Never says "thank you" or uses phrases like "that's interesting"
          4. Has a distinct personality that's challenging but fair
          
          IMPORTANTLY, briefly address their emotional state if relevant:
          - If they show confusion (score > 40%), add a brief clarification before moving on
          - If they show concentration (score > 60%), acknowledge their focus
          - If they show uncertainty (score > 40%), be more critical
          - If they show confidence (score > 60%), challenge them further
          
          Keep your response concise (2 sentences maximum). End with a question if not moving to the next topic.
          Your tone should be that of a senior engineer who doesn't waste time with niceties.
          Be critical when the candidate's answer lacks technical depth.
          `

      // Create messages array that includes recent conversation history for context
      const recentMessages = conversationHistory.slice(-4); // Last 4 messages for context
      const messagesForAPI = [
        {
          role: "system",
          content: `You are a technical interviewer with high standards and a direct personality. You never use phrases like 'thank you', 'that's great', or similar polite but empty phrases. You can respond to the candidate's emotional state based on the data provided.`
        },
        ...recentMessages,
        { role: "user", content: prompt }
      ];

      const response = await fetch(
        `${AZURE_OPENAI_ENDPOINT}/openai/deployments/${AZURE_OPENAI_DEPLOYMENT}/chat/completions?api-version=${AZURE_OPENAI_API_VERSION}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': azureOpenAIKey,
          },
          body: JSON.stringify({
            messages: messagesForAPI,
            temperature: 0.8, // Slightly higher temperature for more personality
            max_tokens: isIntroduction ? 150 : 80 // Increased max tokens to allow for emotion response
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Azure OpenAI API error:", errorText);
        throw new Error(`Failed to process answer: ${response.status}`);
      }

      const result = await response.json();
      const aiResponse = result.choices[0].message.content.trim();

      // If this was the introduction, we'll ask the first question after acknowledging
      if (isIntroduction) {
        // After the introduction, mark that we're ready to start asking technical questions
        setFollowUpCount(0);

        // The AI response already includes the first question
        return aiResponse;
      }

      return aiResponse;
    } catch (error) {
      console.error("Error processing answer:", error);
      return "Moving on.";
    }
  };

  // Update the initializeInterview function to generate better algorithm questions
  const initializeInterview = async (resumeText: string): Promise<string[]> => {
    try {
      // Get the Azure OpenAI API key from environment variables
      const azureOpenAIKey = import.meta.env.VITE_APP_AZURE_OPENAI_API_KEY;

      if (!azureOpenAIKey) {
        throw new Error("Azure OpenAI API key is missing");
      }

      // Get interview configuration from localStorage or use defaults
      const interviewConfig = JSON.parse(localStorage.getItem('interviewConfig') || '{ "questionCount": 7, "difficultyLevel": "medium" }');
      const questionCount = interviewConfig.questionCount || 7;
      const difficultyLevel = interviewConfig.difficultyLevel || 'medium';

      // Create a system prompt that focuses on serious technical questions with configured options
      const systemPrompt = `
        You are a technical interviewer with high standards and a critical, direct personality.
        
        IMPORTANT: The interview will start with you asking the candidate to introduce themselves.
        
        Based on the candidate's resume below, generate ${questionCount} specific interview questions:
        
        1. 60% of questions should directly reference the candidate's experience, skills, and past projects mentioned in their resume:
           - Reference specific projects, technologies, or skills mentioned in the resume
           - Focus on challenging technical aspects and implementation details
           - Ask about design decisions, optimizations, or technical tradeoffs they made
           - Be specific and critical - dig into the real technical depth
        
        2. 40% of questions should be algorithm and data structure questions:
           - Present clear problem statements in algorithm/pseudocode format (NOT actual code)
           - Include questions about time/space complexity analysis
           - Cover a range of topics: arrays, linked lists, trees, graphs, dynamic programming, etc.
           - For each algorithm question, focus on the approach and complexity analysis, not implementation details
           - Tailor difficulty to the setting: ${difficultyLevel.toUpperCase()}
        
        IMPORTANT: Do NOT ask generic questions. Make all questions targeted and specific.
        
        Resume:
        ${resumeText}
        
        Return ONLY a JSON array of strings, each containing one question. Do not include any explanations.
      `;

      const response = await fetch(
        `${AZURE_OPENAI_ENDPOINT}/openai/deployments/${AZURE_OPENAI_DEPLOYMENT}/chat/completions?api-version=${AZURE_OPENAI_API_VERSION}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': azureOpenAIKey,
          },
          body: JSON.stringify({
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: "Generate challenging technical interview questions based on this resume with algorithm and data structure questions included." }
            ],
            temperature: 0.7,
            max_tokens: 1500
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Azure OpenAI API error:", errorText);
        throw new Error(`Failed to generate questions: ${response.status}`);
      }

      const result = await response.json();
      const content = result.choices[0].message.content.trim();

      // Try to parse the JSON response
      try {
        // Extract JSON array if it's wrapped in code blocks or other text
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        const jsonString = jsonMatch ? jsonMatch[0] : content;
        const questions = JSON.parse(jsonString);

        if (Array.isArray(questions) && questions.length > 0) {
          return questions;
        } else {
          throw new Error("Invalid questions format");
        }
      } catch (parseError) {
        console.error("Error parsing questions JSON:", parseError);
        throw new Error("Failed to parse questions");
      }
    } catch (error) {
      console.error("Error generating interview questions:", error);

      // Fallback algorithm and technical questions
      const fallbackQuestions = [
        "Tell me about your most challenging technical project.",
        "Describe an algorithm to find the kth largest element in an unsorted array and analyze its time complexity.",
        "How would you implement a balanced binary search tree and what are the time complexity guarantees?",
        "Explain how you would design a system to handle high throughput data processing.",
        "Describe an approach to detect a cycle in a linked list. What's the space and time complexity?",
        "How would you implement a least recently used (LRU) cache? Explain the data structures involved.",
        "What's the most efficient algorithm to find the shortest path in a weighted graph and why?"
      ];

      // Get interview configuration from localStorage or use defaults
      const interviewConfig = JSON.parse(localStorage.getItem('interviewConfig') || '{ "questionCount": 7, "difficultyLevel": "medium" }');
      const configQuestionCount = interviewConfig.questionCount || 7;
      return fallbackQuestions.slice(0, configQuestionCount);
    }
  };

  // Helper function to get default questions if API fails
  const getMockQuestions = (): string[] => {
    // Get interview configuration from localStorage or use defaults
    const interviewConfig = JSON.parse(localStorage.getItem('interviewConfig') || '{ "questionCount": 7, "difficultyLevel": "medium" }');
    const configuredQuestionCount = interviewConfig.questionCount || 7;
    return mockQuestions.map(q => q.text).slice(0, configuredQuestionCount); // Return configured number of mock questions
  };

  // Modify the processAnswer function to generate shorter responses
  const processAnswer = async (question: string, answer: string, emotions: any[] = []): Promise<string> => {
    try {
      // Get the Azure OpenAI API key from environment variables
      const azureOpenAIKey = import.meta.env.VITE_APP_AZURE_OPENAI_API_KEY;

      // Store the answer and emotions for results page
      storeAnswerWithEmotions(question, answer, emotions);

      // Use the full conversation context to generate a response
      const prompt = `
        You are an AI technical interviewer having a conversation with a candidate.
        
        Previous question: "${question}"
        
        Candidate's answer: "${answer}"
        
        Provide a very brief response (1 sentence maximum) that:
        1. Acknowledges their answer without detailed feedback
        2. Sounds natural and conversational
        3. Only corrects them if they're completely wrong
        
        Your response should mimic a busy interviewer who wants to keep the interview moving.
        Avoid generic phrases like "Thank you for sharing" or "That's interesting."
      `;

      // Create messages array that includes recent conversation history for context
      const recentMessages = conversationHistory.slice(-4); // Last 4 messages for context
      const messagesForAPI = [
        {
          role: "system",
          content: "You are an AI technical interviewer. Keep responses extremely brief (1 sentence)."
        },
        ...recentMessages,
        { role: "user", content: prompt }
      ];

      const response = await fetch(
        `${AZURE_OPENAI_ENDPOINT}/openai/deployments/${AZURE_OPENAI_DEPLOYMENT}/chat/completions?api-version=${AZURE_OPENAI_API_VERSION}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': azureOpenAIKey,
          },
          body: JSON.stringify({
            messages: messagesForAPI,
            temperature: 0.7,
            max_tokens: 60
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Azure OpenAI API error:", errorText);
        throw new Error(`Failed to process answer: ${response.status}`);
      }

      const result = await response.json();
      const acknowledgment = result.choices[0].message.content.trim();

      // Update conversation history with user's answer and AI's acknowledgment
      setConversationHistory(prev => [
        ...prev,
        { role: "user", content: answer },
        { role: "assistant", content: acknowledgment }
      ]);

      return acknowledgment;
    } catch (error) {
      console.error("Error processing answer:", error);
      return "I see. Let's continue.";
    }
  };

  // Function to store answer with emotions for results page
  const storeAnswerWithEmotions = (question: string, answer: string, emotions: any[] = [], responseTime: number = 0, isFollowUp: boolean = false) => {
    // Get existing data or initialize new array
    const existingData = localStorage.getItem('interviewData') || '[]';
    let interviewData = [];

    try {
      interviewData = JSON.parse(existingData);
    } catch (e) {
      console.error("Error parsing interview data:", e);
      interviewData = [];
    }

    // Use currentEmotions from state if available, otherwise use provided emotions
    const emotionsToStore = currentEmotions.length > 0 ? currentEmotions : emotions;

    // Add new entry
    interviewData.push({
      question,
      answer,
      emotions: emotionsToStore,
      timestamp: new Date().toISOString(),
      responseTime,
      isFollowUp
    });

    // Store updated data
    localStorage.setItem('interviewData', JSON.stringify(interviewData));
  };

  // Update the generateNextQuestion function to include emotions
  const generateNextQuestion = async (): Promise<string> => {
    try {
      // Get the Azure OpenAI API key from environment variables
      const azureOpenAIKey = import.meta.env.VITE_APP_AZURE_OPENAI_API_KEY;

      // Increment follow-up counter
      const newFollowUpCount = followUpCount + 1;
      setFollowUpCount(newFollowUpCount);

      // Strict limit to follow-up questions - maximum of 2
      const shouldMoveToNextMainQuestion = userHasAnswered && newFollowUpCount >= 2;

      if (shouldMoveToNextMainQuestion && currentQuestion < questions.length - 1) {
        // We want to move to the next main question
        return "Let's move on.";
      } else {
        // Format emotions data for the prompt
        let emotionsText = "";
        if (currentEmotions && currentEmotions.length > 0) {
          // Sort emotions by score in descending order and take top 3
          const topEmotions = [...currentEmotions]
            .sort((a, b) => b.score - a.score)
            .slice(0, 3);

          emotionsText = topEmotions
            .map(e => `${e.name}: ${(e.score * 100).toFixed(0)}%`)
            .join(", ");
        } else {
          emotionsText = "No emotional data available";
        }

        // Generate a more direct, critical follow-up with emotion awareness
        const prompt = `
          You are a technical interviewer with high standards and a critical eye.
          
          Based on the conversation so far, generate a follow-up question that:
          1. Is specific, technical, and challenging
          2. Probes deeper into the technical aspects of their answer
          3. Is concise (1 sentence maximum)
          4. Has a direct, slightly confrontational tone
          5. Questions their assumptions or implementation details
          
          The candidate's current emotional state: ${emotionsText}
          
          Adapt your question based on their emotions:
          - If they show confusion (score > 40%), simplify the question but remain challenging
          - If they show concentration (score > 60%), increase the technical difficulty
          - If they show uncertainty (score > 40%), focus on fundamentals
          - If they show confidence (score > 60%), ask for more implementation details
          
          Your goal is to test if they really understand the topic or are just repeating buzzwords.
          Don't waste time with pleasantries - get straight to the technical question.
        `;

        // Create messages array that includes recent conversation history for context
        const recentMessages = conversationHistory.slice(-6);
        const messagesForAPI = [
          {
            role: "system",
            content: "You are a technical interviewer with high standards. Keep responses concise, challenging, and direct."
          },
          ...recentMessages,
          { role: "user", content: prompt }
        ];

        const response = await fetch(
          `${AZURE_OPENAI_ENDPOINT}/openai/deployments/${AZURE_OPENAI_DEPLOYMENT}/chat/completions?api-version=${AZURE_OPENAI_API_VERSION}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'api-key': azureOpenAIKey,
            },
            body: JSON.stringify({
              messages: messagesForAPI,
              temperature: 0.8,
              max_tokens: 100
            }),
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          console.error("Azure OpenAI API error:", errorText);
          throw new Error(`Failed to generate next question: ${response.status}`);
        }

        const result = await response.json();
        const nextQuestion = result.choices[0].message.content.trim();

        return nextQuestion;
      }
    } catch (error) {
      console.error("Error generating next question:", error);
      return "Explain that in more technical detail.";
    }
  };

  // Update the generateInterviewSummary function to store emotions with questions
  const generateInterviewSummary = async (): Promise<string> => {
    try {
      // Get the Azure OpenAI API key from environment variables
      const azureOpenAIKey = import.meta.env.VITE_APP_AZURE_OPENAI_API_KEY;

      // Get stored interview data with emotions
      const interviewData = JSON.parse(localStorage.getItem('interviewData') || '[]');

      // Create a detailed prompt including emotional data
      let emotionSummary = "";
      if (interviewData && interviewData.length > 0) {
        emotionSummary = interviewData.map((item: any) => {
          let emotionsText = "No emotions detected";
          if (item.emotions && item.emotions.length > 0) {
            emotionsText = item.emotions
              .slice(0, 3)
              .map((e: any) => `${e.name} (${(e.score * 100).toFixed(0)}%)`)
              .join(", ");
          }
          return `Question: "${item.question}"\nAnswer: "${item.answer}"\nEmotions: ${emotionsText}`;
        }).join("\n\n");
      }

      // Store the full interview results for the results page
      const interviewResults: InterviewResults = {
        id: Date.now().toString(),
        summary: "", // Will be filled in below
        emotionsData: interviewData,
        transcriptions: interviewData.map((item: any) => item.answer),
        timestamp: new Date().toISOString()
      };

      // Create a prompt for generating the summary with more details
      const prompt = `
        You are an AI technical interviewer who has just completed an interview with a candidate.
        
        I need you to generate a comprehensive interview summary with critical analysis based on the following conversation data and emotional cues:
        
        CONVERSATION AND EMOTIONAL DATA:
        ${emotionSummary}
        
        Your summary should include:
        
        1. OVERVIEW: A brief overall assessment of the candidate's interview performance
        
        2. TECHNICAL ASSESSMENT:
          - Depth of technical knowledge demonstrated
          - Problem-solving approach and methodology
          - Technical strengths clearly demonstrated
          - Technical weaknesses or knowledge gaps identified
        
        3. COMMUNICATION ASSESSMENT:
          - Clarity of explanations and thought process
          - Ability to discuss complex technical concepts
          - Professional communication style
        
        4. EMOTIONAL INTELLIGENCE INSIGHTS:
          - Analysis of emotional patterns during responses
          - Confidence levels when addressing different topics
          - Areas where emotional responses may have impacted technical delivery
        
        5. RECOMMENDATIONS:
          - Specific areas for improvement
          - Suggestions for skill development
          - Next steps for the candidate
        
        Format the summary in markdown with clear sections and bullet points.
        Be honest, specific, and constructive in your feedback.
        Provide a critical analysis that would be valuable for both the interviewer and the candidate.
      `;

      // Create messages array from conversation history
      const messagesForAPI = [
        {
          role: "system",
          content: "You are an AI technical interviewer generating a comprehensive interview summary with critical analysis."
        },
        ...conversationHistory, // Use the full conversation history
        { role: "user", content: prompt }
      ];

      const response = await fetch(
        `${AZURE_OPENAI_ENDPOINT}/openai/deployments/${AZURE_OPENAI_DEPLOYMENT}/chat/completions?api-version=${AZURE_OPENAI_API_VERSION}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': azureOpenAIKey,
          },
          body: JSON.stringify({
            messages: messagesForAPI,
            temperature: 0.7,
            max_tokens: 1500
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Azure OpenAI API error:", errorText);
        throw new Error(`Failed to generate summary: ${response.status}`);
      }

      const result = await response.json();
      const summary = result.choices[0].message.content.trim();

      // Store the summary in the interview results
      interviewResults.summary = summary;

      // Save the complete results to localStorage for the results page
      localStorage.setItem('interviewResults', JSON.stringify(interviewResults));

      return summary;
    } catch (error) {
      console.error("Error generating interview summary:", error);
      return "We were unable to generate a detailed summary at this time. Please check your results page for more information.";
    }
  };

  // Add loading screen to the UI
  // In the return statement, wrap the main content with a loading check
  return (
    <div className="flex flex-col h-screen bg-gray-100">
      {/* Loading screen */}
      {isLoading && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-90 flex items-center justify-center z-50">
          <div className="text-center">
            <Loader2 className="h-12 w-12 animate-spin text-blue-500 mx-auto" />
            <h2 className="text-xl font-semibold text-white mt-4">Preparing Your Interview</h2>
            <p className="text-gray-300 mt-2">Analyzing your resume and generating personalized questions...</p>
          </div>
        </div>
      )}

      <div className="min-h-screen bg-black flex flex-col h-screen overflow-hidden">
        <style>{pulseStyle}</style>

        {/* Progress bar - fixed at top */}
        <div className="fixed top-0 left-0 w-full h-1 bg-black z-10">
          <motion.div
            className="h-full bg-white"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>

        {/* Interview header - adjusted height and theme-matched */}
        <div className="bg-black/80 py-3 px-6 border-b border-white/20 sticky top-0 z-10 backdrop-blur-sm shadow-md">
          <div className="max-w-6xl mx-auto">
            <div className="flex justify-between items-center">
              {/* Left side with title and progress */}
              <div className="flex items-center gap-3">
                {/* Logo/badge */}
                <div className="hidden md:flex h-9 w-9 rounded-full bg-white/5 border border-white/10 items-center justify-center">
                  <Bot className="h-5 w-5 text-white/70" />
                </div>

                {/* Title and progress */}
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="text-xl font-semibold text-white">Technical Interview</h1>
                    <span className="hidden md:flex px-1.5 py-0.5 text-xs bg-white/10 text-white/70 rounded-full border border-white/10">
                      LIVE
                    </span>
                  </div>

                  <div className="flex items-center gap-3 mt-0.5">
                    <div className="flex items-center">
                      <div className="w-1 h-1 rounded-full bg-green-400 mr-1.5 animate-pulse"></div>
                      <span className="text-xs text-white/70">
                        {timeRemaining > 0 && (
                          <span className="text-xs">
                            Time remaining: {Math.floor(timeRemaining / 60000)}:{String(Math.floor((timeRemaining % 60000) / 1000)).padStart(2, '0')}
                          </span>
                        )}
                      </span>
                    </div>
                    
                    {/* Progress bar container with improved styling */}
                    <div className="hidden md:block w-32 bg-white/10 h-1.5 rounded-full overflow-hidden mt-1">
                      {/* This is the time-based progress */}
                      <div 
                        className="h-full bg-white rounded-full"
                        style={{ width: `${progress}%` }}>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right side with action buttons */}
              <div className="flex items-center gap-2">
                {/* Interview status indicator */}
                <div className="hidden md:block">
                  {isThinking ? (
                    <span className="flex items-center px-2 py-0.5 text-xs bg-white/5 text-gray-300 rounded border border-white/10">
                      <Brain className="h-3 w-3 mr-1 animate-pulse" />
                      Thinking
                    </span>
                  ) : isSpeaking ? (
                    <span className="flex items-center px-2 py-0.5 text-xs bg-white/5 text-gray-300 rounded border border-white/10">
                      <Volume2 className="h-3 w-3 mr-1 animate-pulse" />
                      Speaking
                    </span>
                  ) : isRecording ? (
                    <span className="flex items-center px-2 py-0.5 text-xs bg-red-500/20 text-red-300 rounded border border-red-500/20">
                      <Mic className="h-3 w-3 mr-1 animate-pulse" />
                      Recording
                    </span>
                  ) : null}
                </div>

                <button
                  onClick={toggleSpeech}
                  className={`p-2 rounded-full flex items-center justify-center ${isSpeaking
                      ? 'bg-white text-black'
                      : 'bg-black/50 text-gray-400 border border-white/30 hover:bg-black/70'
                    }`}
                  disabled={isRecording || isThinking}
                >
                  {isSpeaking ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                </button>

                <div className="md:hidden">
                  <button
                    onClick={() => setViewMode(viewMode === 'camera' ? 'chat' : 'camera')}
                    className="p-2 rounded-full bg-white text-black"
                  >
                    {viewMode === 'camera' ? <MessageSquare className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
                  </button>
                </div>

                {/* Hamburger Menu Button */}
                <button
                  onClick={() => setIsMenuOpen(!isMenuOpen)}
                  className="p-2 rounded-full hover:bg-white/10 transition-colors"
                  aria-label="Open menu"
                >
                  <Menu className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* User Menu */}
        <AnimatePresence>
          {isMenuOpen && (
            <>
              {/* Backdrop with localized blur effect */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-40"
                onClick={() => setIsMenuOpen(false)}
              >
                {/* This creates a gradient that only blurs the right side of the screen */}
                <div className="h-full w-full bg-gradient-to-r from-black/30 to-black/70 backdrop-blur-[2px]">
                  {/* Additional stronger blur for the area directly behind the menu */}
                  <div className="absolute top-0 right-0 h-full w-[320px] bg-black/40 backdrop-blur-md" />
                </div>
              </motion.div>

              {/* Menu Panel */}
              <motion.div
                initial={{ opacity: 0, x: 300 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 300 }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                className="fixed right-0 top-0 h-full w-80 bg-black border-l border-white/10 z-50 overflow-y-auto"
              >
                <div className="p-6">
                  <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-bold">Menu</h2>
                    <button
                      onClick={() => setIsMenuOpen(false)}
                      className="p-1 rounded-full hover:bg-white/10 transition-colors"
                      aria-label="Close menu"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  {userDetails && (
                    <div className="mb-6">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center">
                          <User className="h-6 w-6" />
                        </div>
                        <div>
                          <h3 className="font-medium">{userDetails.name}</h3>
                          <p className="text-sm text-gray-400">{userDetails.email}</p>
                        </div>
                      </div>

                      <div className="space-y-2">
                        {userDetails.resumeURL && (
                          <a
                            href={userDetails.resumeURL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-sm text-gray-300 hover:text-white transition-colors"
                          >
                            <FileText className="h-4 w-4" />
                            View Resume
                          </a>
                        )}

                        {userDetails.linkedinURL && (
                          <a
                            href={userDetails.linkedinURL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-sm text-gray-300 hover:text-white transition-colors"
                          >
                            <Linkedin className="h-4 w-4" />
                            LinkedIn Profile
                          </a>
                        )}

                        {userDetails.portfolioURL && (
                          <a
                            href={userDetails.portfolioURL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-sm text-gray-300 hover:text-white transition-colors"
                          >
                            <Globe className="h-4 w-4" />
                            Portfolio Website
                          </a>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="space-y-2 border-t border-white/10 pt-4">
                    <button
                      onClick={() => navigate('/dashboard')}
                      className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-white/5 transition-colors text-left"
                    >
                      <ArrowLeft className="h-4 w-4" />
                      <span>Back to Dashboard</span>
                    </button>

                    <button
                      onClick={() => navigate('/profile')}
                      className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-white/5 transition-colors text-left"
                    >
                      <Edit className="h-4 w-4" />
                      <span>Edit Profile</span>
                    </button>

                    <button
                      onClick={() => navigate('/login')}
                      className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-white/5 transition-colors text-left"
                    >
                      <LogOut className="h-4 w-4" />
                      <span>Sign Out</span>
                    </button>
                  </div>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Main content area - flex-1 to take remaining height */}
        <div className="flex-1 overflow-hidden">
          <div className="h-full max-w-6xl mx-auto p-4">
            {/* Mobile view mode selector - new addition */}
            <div className="flex md:hidden mb-4 gap-2">
              <button
                onClick={() => setViewMode('chat')}
                className={`flex-1 py-2 px-4 rounded-lg flex items-center justify-center gap-2 ${viewMode === 'chat' ? 'bg-blue-600/70 text-white' : 'bg-black/40 text-white/70 border border-white/10'
                  }`}
              >
                <MessageSquare className="h-4 w-4" />
                <span>Chat</span>
              </button>
              <button
                onClick={() => setViewMode('camera')}
                className={`flex-1 py-2 px-4 rounded-lg flex items-center justify-center gap-2 ${viewMode === 'camera' ? 'bg-blue-600/70 text-white' : 'bg-black/40 text-white/70 border border-white/10'
                  }`}
              >
                <Camera className="h-4 w-4" />
                <span>Camera</span>
              </button>
            </div>

            <div className="flex flex-col md:flex-row h-full gap-4">
              {/* AI Avatar Section */}
              <div className="md:w-1/4 md:h-full hidden md:block">
                <div className="bg-white/5 border border-white/20 rounded-xl h-full flex flex-col shadow-lg overflow-hidden">
                  <div className="p-4 border-b border-white/20 bg-black/40 rounded-t-xl">
                    <div className="flex items-center justify-between">
                      <h2 className="font-medium text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400 font-bold">NERV OS v2.4</h2>
                      <div className="flex gap-1">
                        <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></div>
                        <div className="w-2 h-2 rounded-full bg-blue-400"></div>
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 flex flex-col items-center justify-start p-6 relative">
                    {/* Background decorative elements */}
                    <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
                      <div className="absolute top-10 left-4 w-32 h-32 border border-white/20 rounded-full"></div>
                      <div className="absolute bottom-20 right-4 w-24 h-24 border border-white/20 rounded-full"></div>
                      <div className="absolute top-40 right-6 w-16 h-16 border border-blue-500/30 rounded-full"></div>
                      <div className="absolute top-1/2 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"></div>
                    </div>

                    <div className="w-32 h-32 bg-gradient-to-br from-blue-900/50 to-purple-900/50 rounded-full flex items-center justify-center mb-6 border border-white/20 relative shadow-lg">
                      <div className="absolute inset-0 rounded-full bg-black/50 backdrop-blur-sm"></div>
                      <Bot className="h-16 w-16 text-white/80 relative z-10" />
                      <div className="absolute inset-0 rounded-full border-2 border-white/5"></div>
                      <div className="absolute -top-1 -right-1 w-6 h-6 bg-green-500/80 rounded-full flex items-center justify-center">
                        <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                      </div>
                    </div>

                    <div className="text-center mb-4 relative">
                      <h3 className="text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-300 to-purple-300">
                        Technical Interviewer
                      </h3>
                      <p className="text-xs text-white/60">Advanced AI Evaluation System</p>
                    </div>

                    {isThinking ? (
                      <div className="text-center bg-black/20 px-4 py-3 rounded-lg w-full border border-white/10 backdrop-blur-sm">
                        <div className="flex items-center justify-center gap-2 mb-2">
                          <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                          <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                          <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                        </div>
                        <p className="text-blue-300/80 text-sm font-medium">Processing Response...</p>
                      </div>
                    ) : isSpeaking ? (
                      <div className="text-center bg-black/20 px-4 py-3 rounded-lg w-full border border-white/10 backdrop-blur-sm">
                        <div className="relative mb-2 flex justify-center">
                          <div className="absolute inset-0 bg-blue-500/20 rounded-full animate-ping opacity-75"></div>
                          <div className="relative bg-blue-500/30 p-3 rounded-full">
                            <Volume2 className="h-6 w-6 text-blue-300" />
                          </div>
                        </div>
                        <p className="text-blue-300/80 text-sm font-medium">Voice Output Active</p>
                      </div>
                    ) : (
                      <div className="text-center bg-black/20 px-4 py-3 rounded-lg w-full border border-white/10 backdrop-blur-sm">
                        <div className="mb-2 flex justify-center">
                          <div className="bg-white/10 p-3 rounded-full">
                            <User className="h-6 w-6 text-white/60" />
                          </div>
                        </div>
                        <p className="text-blue-300/80 text-sm font-medium">
                          {isUserTurn ? "Awaiting Your Input..." : "Input Processing..."}
                        </p>
                      </div>
                    )}

                    <div className="mt-6 space-y-4 w-full">
                      <div className="bg-black/30 p-4 rounded-lg border border-white/10 backdrop-blur-sm">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-medium text-blue-300/90 uppercase tracking-wider">Current Topic</p>
                          <div className="h-4 w-4 rounded-full bg-blue-500/30 flex items-center justify-center">
                            <div className="h-1.5 w-1.5 rounded-full bg-blue-400"></div>
                          </div>
                        </div>
                        <div className="relative">
                          <p className="text-sm text-white/90">{questions && questions[currentQuestion] ? questions[currentQuestion].text.length > 60 ?
                            questions[currentQuestion].text.substring(0, 60) + '...' :
                            questions[currentQuestion].text : "Loading question..."}
                          </p>
                        </div>
                      </div>

                      <div className="bg-black/30 p-4 rounded-lg border border-white/10 backdrop-blur-sm">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-medium text-blue-300/90 uppercase tracking-wider">Progress</p>
                          <p className="text-xs text-white/60 font-mono">
                            {currentQuestion + 1}/{questions.length}
                          </p>
                        </div>
                        <div className="w-full bg-black/50 rounded-full h-2 overflow-hidden p-0.5">
                          <div className="bg-gradient-to-r from-blue-500 to-purple-500 h-1 rounded-full" style={{ width: `${progress}%` }}></div>
                        </div>
                        <p className="text-xs text-right mt-2 text-white/50 font-mono">
                          {progress.toFixed(0)}% complete
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* AI chat section - scrollable content */}
              <div className={`md:w-2/4 h-full md:block ${viewMode === 'camera' ? 'hidden' : 'block'}`}>
                <div className="bg-white/5 border border-white/20 rounded-xl h-full flex flex-col shadow-lg overflow-hidden">
                  <div className="p-4 border-b border-white/20 flex-shrink-0 bg-black/40 rounded-t-xl">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <div className="w-9 h-9 rounded-full bg-black/50 border border-white/20 flex items-center justify-center mr-3">
                          <Bot className="h-5 w-5 text-white/80" />
                        </div>
                        <div>
                          <h2 className="font-medium text-white">
                            NERV Interviewer
                          </h2>
                          <p className="text-xs text-white/50">Interview session active</p>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <div className="w-2 h-2 rounded-full bg-green-500/80"></div>
                      </div>
                    </div>
                  </div>

                  {/* This div is scrollable */}
                  <div className="flex-1 overflow-y-auto p-4 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent relative">
                    {/* Background decorative elements */}
                    <div className="absolute top-0 left-0 w-full h-full opacity-5 pointer-events-none">
                      <div className="absolute top-20 right-10 w-40 h-40 border border-white/20 rounded-full"></div>
                      <div className="absolute bottom-40 left-10 w-32 h-32 border border-white/20 rounded-full"></div>
                      <div className="absolute top-1/3 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"></div>
                      <div className="absolute bottom-1/3 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"></div>
                    </div>

                    <div className="space-y-6 relative z-10">
                      {messages.map((message, index) => (
                        <div
                          key={message.id}
                          className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'} mb-4`}
                          ref={index === messages.length - 1 ? lastMessageRef : null}
                        >
                          <div
                            className={`max-w-[80%] rounded-lg p-3 backdrop-blur-sm ${message.sender === 'user'
                                ? 'bg-blue-600/90 text-white rounded-br-none border border-blue-500/50'
                                : 'bg-black/40 text-white rounded-bl-none border border-white/10'
                              }`}
                          >
                            <div className="flex items-start">
                              <div className="flex-shrink-0 mr-2">
                                {message.sender === 'user' ? (
                                  <div className="w-5 h-5 rounded-full bg-blue-500/30 flex items-center justify-center">
                                    <User className="h-3 w-3 text-white/90" />
                                  </div>
                                ) : (
                                  <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center">
                                    <Bot className="h-3 w-3 text-white/90" />
                                  </div>
                                )}
                              </div>
                              <div>
                                <p className="text-sm whitespace-pre-wrap">{message.text}</p>
                                <p className="text-xs text-white/50 mt-1 font-mono">
                                  {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}

                      {isThinking && (
                        <div className="flex justify-start">
                          <div className="bg-black/30 text-white rounded-xl rounded-tl-none p-4 max-w-[80%] border border-white/10 backdrop-blur-sm">
                            <div className="flex items-center mb-2">
                              <div className="w-6 h-6 rounded-full bg-black/50 flex items-center justify-center mr-2 border border-white/10">
                                <Bot className="h-3 w-3 text-white/80" />
                              </div>
                              <span className="text-sm font-medium text-blue-300/90">NERV System</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                              <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                              <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                            </div>
                          </div>
                        </div>
                      )}

                      {isRecording && (
                        <div className="flex justify-end">
                          <div className="bg-black/30 text-white rounded-xl rounded-tr-none p-4 max-w-[80%] border border-white/10 backdrop-blur-sm">
                            <div className="flex items-center mb-2">
                              <div className="w-6 h-6 rounded-full bg-black/50 flex items-center justify-center mr-2 border border-white/10">
                                <User className="h-3 w-3 text-white/80" />
                              </div>
                              <span className="text-sm font-medium text-white/90">You</span>
                              <div className="ml-2 flex items-center">
                                <div className="w-2 h-2 rounded-full bg-red-500 mr-1 animate-pulse"></div>
                                <span className="text-xs text-red-400">Recording</span>
                              </div>
                            </div>
                            <p className="whitespace-pre-wrap text-sm">
                              {transcription || "Listening..."}
                            </p>
                          </div>
                        </div>
                      )}

                      {isTranscribing && !isThinking && !isSpeaking && (
                        <div className="flex items-center justify-center gap-2 text-sm text-blue-300/80 mt-2 bg-black/20 py-1 px-3 rounded-full border border-white/5 w-fit mx-auto backdrop-blur-sm">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          <span className="text-xs">Transcribing</span>
                        </div>
                      )}

                      {isThinking && !isTranscribing && !isSpeaking && (
                        <div className="flex items-center justify-center gap-2 text-sm text-blue-300/80 mt-2 bg-black/20 py-1 px-3 rounded-full border border-white/5 w-fit mx-auto backdrop-blur-sm">
                          <Brain className="h-3 w-3 animate-pulse" />
                          <span className="text-xs">Processing</span>
                        </div>
                      )}

                      {isSpeaking && !isTranscribing && !isThinking && (
                        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-blue-500/70 text-white px-4 py-2 rounded-full text-sm z-50 flex items-center gap-2 border border-blue-400/30 backdrop-blur-sm">
                          <Volume2 className="h-4 w-4 animate-pulse" />
                          <span>Voice Output</span>
                        </div>
                      )}

                      <div ref={messagesEndRef} />
                    </div>
                  </div>

                  {/* Input area - fixed at bottom */}
                  <div className="p-4 border-t border-white/10 flex-shrink-0 bg-black/40 backdrop-blur-sm">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={toggleRecording}
                        disabled={isRecordingDisabled || isTranscribing}
                        className={`p-4 rounded-full flex items-center justify-center transition-all border ${isRecording
                            ? 'bg-red-500/80 text-white border-red-400/50 pulsate-recording'
                            : isTranscribing
                              ? 'bg-blue-500/40 text-white border-blue-400/30'
                              : isRecordingDisabled
                                ? 'bg-black/60 text-gray-400 border-white/5 cursor-not-allowed'
                                : 'bg-black/60 text-white/90 border-white/10 hover:bg-black/80'
                          }`}
                        style={{ minWidth: '48px', minHeight: '48px' }}
                      >
                        {isRecording ? <MicOff className="h-5 w-5" /> :
                          isTranscribing ? <Loader2 className="h-5 w-5 animate-spin" /> :
                            <Mic className="h-5 w-5" />}
                      </button>

                      <div className="flex-1 relative">
                        <input
                          type="text"
                          value={userInput}
                          onChange={(e) => setUserInput(e.target.value)}
                          onKeyPress={(e) => e.key === 'Enter' && !isSendDisabled && handleSendMessage()}
                          placeholder={
                            isRecording ? "Listening..." :
                              isTranscribing ? "Transcribing..." :
                                isSpeaking ? "AI is speaking..." :
                                  isThinking ? "AI is thinking..." :
                                    "Type your response..."
                          }
                          disabled={isRecording || isSpeaking || isThinking || isTranscribing}
                          className="w-full py-3 px-4 bg-black/40 border border-white/10 rounded-lg focus:ring-1 focus:ring-blue-400/50 focus:outline-none pr-12 text-white/90 placeholder:text-white/30"
                        />
                        <button
                          onClick={() => handleSendMessage()}
                          disabled={isSendDisabled}
                          className={`absolute right-2 top-1/2 transform -translate-y-1/2 p-2 ${isSendDisabled ? 'text-gray-600 cursor-not-allowed' : 'text-blue-400 hover:text-blue-300'
                            }`}
                        >
                          <Send className="h-5 w-5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* User video section */}
              <div className={`md:w-1/4 md:h-full md:block ${viewMode === 'chat' ? 'hidden md:block' : 'block'}`}>
                <div className="bg-white/5 border border-white/20 rounded-xl h-full flex flex-col shadow-lg overflow-hidden">
                  <div className="p-4 border-b border-white/20 flex justify-between items-center bg-black/40 rounded-t-xl">
                    <div className="flex items-center">
                      <h2 className="font-medium text-transparent bg-clip-text bg-gradient-to-r from-blue-300 to-green-300 font-bold">Feed Monitor</h2>
                    </div>
                    <div className="flex gap-2">
                      <div className="h-4 w-4 rounded-full flex items-center justify-center bg-black/50 border border-white/20">
                        <div className={`h-2 w-2 rounded-full ${isCameraOn ? 'bg-green-500' : 'bg-red-500'}`}></div>
                      </div>
                      <button
                        onClick={toggleCamera}
                        className={`p-2 rounded-full ${isCameraOn ? 'bg-black/40 text-white border border-white/20' : 'bg-black/40 text-gray-400 border border-white/10'
                          }`}
                      >
                        {isCameraOn ? <Camera className="h-4 w-4" /> : <CameraOff className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="relative flex-1 flex items-center justify-center bg-black/50 rounded-b-xl overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
                      <div className="absolute top-10 right-4 w-24 h-24 border border-white/20 rounded-full"></div>
                      <div className="absolute bottom-10 left-4 w-16 h-16 border border-white/20 rounded-full"></div>
                      <div className="absolute top-1/3 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"></div>
                      <div className="absolute bottom-1/3 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"></div>
                    </div>

                    <div className="relative w-full h-full">
                      {isCameraOn ? (
                        <>
                          <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            muted
                            className="w-full h-full object-cover transform scale-x-[-1]"
                          />
                          <canvas ref={canvasRef} className="hidden" />

                          {/* Brain button for manual analysis */}
                          <button
                            onClick={captureAndAnalyzeFrame}
                            disabled={isAnalyzing}
                            className="absolute top-2 right-2 p-2 bg-white/20 hover:bg-white/30 rounded-full transition-colors"
                            title="Analyze facial expressions"
                          >
                            <Brain className={`h-5 w-5 ${isAnalyzing ? 'text-blue-400 animate-pulse' : 'text-white'}`} />
                          </button>
                        </>
                      ) : (
                        <div className="flex items-center justify-center h-full">
                          <FaVideo className="text-gray-400 text-4xl" />
                        </div>
                      )}
                      {cameraError && (
                        <div className="absolute bottom-0 left-0 right-0 bg-red-500 text-white p-1 text-xs text-center">
                          {cameraError}
                        </div>
                      )}

                      {/* Facial expression display */}
                      {facialExpressions && facialExpressions.emotions && (
                        <div className="absolute top-2 left-2 bg-black/70 p-2 rounded text-xs max-w-[180px] overflow-auto">
                          <p className="text-white font-bold mb-1">Emotions:</p>
                          {facialExpressions.emotions.length > 0 ? (
                            // Sort emotions by score and display top 5
                            [...facialExpressions.emotions]
                              .sort((a, b) => b.score - a.score)
                              .slice(0, 5)
                              .map((emotion) => (
                                <div key={emotion.name} className="flex justify-between items-center mb-1">
                                  <span className="text-gray-300 capitalize">{emotion.name}:</span>
                                  <div className="flex items-center">
                                    <div
                                      className="bg-white h-1.5 rounded-full"
                                      style={{ width: `${emotion.score * 50}px` }}
                                    ></div>
                                    <span className="text-white ml-1">{(emotion.score * 100).toFixed(0)}%</span>
                                  </div>
                                </div>
                              ))
                          ) : (
                            <p className="text-gray-400">No emotions detected</p>
                          )}
                        </div>
                      )}

                      {isAnalyzing && (
                        <div className="absolute bottom-2 right-2 bg-blue-500/70 px-2 py-1 rounded-full">
                          <span className="text-xs text-white">Analyzing...</span>
                        </div>
                      )}
                    </div>

                    {isRecording && (
                      <div className="absolute top-2 right-2 flex items-center bg-black/70 px-2 py-1 rounded-full">
                        <div className="w-2 h-2 rounded-full bg-red-500 mr-2 animate-pulse"></div>
                        <span className="text-xs text-white">Recording</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        {transcriptionError && (
          <div className="p-2 mt-2 bg-red-500/20 border border-red-500/30 rounded-lg text-sm text-red-300">
            {transcriptionError}
          </div>
        )}

        {/* Add audio element for text-to-speech with controls for debugging */}
        <audio ref={audioRef} className="hidden" />

        {/* Add speaking indicator */}
        {isSpeaking && (
          <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-blue-500 text-white px-4 py-2 rounded-full text-sm z-50 flex items-center gap-2">
            <Volume2 className="h-4 w-4 animate-pulse" />
            <span>Speaking...</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default Interview;