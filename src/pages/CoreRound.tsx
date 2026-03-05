import React, { useState, useEffect, useRef } from 'react';
import { InterviewerAvatar } from '../components/InterviewerAvatar';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../lib/firebase';
import {
  Mic, MicOff, Camera, CameraOff,
  Loader2, Clock, Briefcase, X
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';

// Services
import { sarvamTTS as azureTTS } from '../services/sarvamTTSService';
import { sarvamSTT as whisperService } from '../services/sarvamSTTService';
import { apiService } from '../services/apiService';
import { openAI, QuestionContext } from '../services/openAIService';
import { getResumeData } from '../services/firebaseResumeService';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'ai';
  timestamp: Date;
}

interface UserExpression {
  isConfident: boolean;
  isNervous: boolean;
  isStruggling: boolean;
  dominantEmotion: string;
  confidenceScore: number;
  emotionBreakdown?: any[];
}

interface ResumeData {
  skills: string[];
  projects: (string | { name?: string; description?: string })[];
  achievements: (string | { name?: string; description?: string })[];
  experience: (string | { title?: string; company?: string })[];
  education: string[];
}

const CoreRound: React.FC = (): JSX.Element => {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser } = useAuth();

  // Get data from previous round
  const roundDuration = location.state?.roundDuration || 3;
  const previousMessages = location.state?.messages || [];
  const previousExpressions = location.state?.questionExpressions || new Map();

  // UI state
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Interview data
  const [messages, setMessages] = useState<Message[]>(previousMessages);
  const [currentQuestion, setCurrentQuestion] = useState<string>('');
  const [currentQuestionId, setCurrentQuestionId] = useState<string>('');
  const [resumeData, setResumeData] = useState<ResumeData | null>(location.state?.resumeData || null);
  const [userExpression, setUserExpression] = useState<UserExpression | null>(null);
  const [previousQuestions, setPreviousQuestions] = useState<string[]>([]);
  const [chatInput, setChatInput] = useState<string>('');
  const [questionExpressions, setQuestionExpressions] = useState<Map<string, UserExpression>>(previousExpressions);
  const [isCapturingExpression, setIsCapturingExpression] = useState<boolean>(false);
  const [currentEmotions, setCurrentEmotions] = useState<any[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [humeApiKey] = useState<string>(import.meta.env.VITE_HUME_API_KEY || '');

  // Time management
  const [timeRemaining, setTimeRemaining] = useState(roundDuration * 60);
  const [isInterviewStarted, setIsInterviewStarted] = useState(false);
  const [isInterviewComplete, setIsInterviewComplete] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [conversationId, setConversationId] = useState<string>('');

  // Generate conversation ID
  useEffect(() => {
    const newConversationId = `core_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    setConversationId(newConversationId);
    console.log('[CoreRound] Generated conversation ID:', newConversationId);
  }, []);

  // Load resume data
  useEffect(() => {
    const loadResumeData = async () => {
      if (location.state?.resumeData) {
        setResumeData(location.state.resumeData);
      } else if (currentUser) {
        try {
          const data = await getResumeData(currentUser.uid);
          if (data) setResumeData(data);
        } catch (error) {
          console.error('Error loading resume data from Firebase:', error);
        }
      }
    };
    loadResumeData();
  }, [location.state, currentUser]);

  // Handle interview completion
  useEffect(() => {
    if (isInterviewComplete) {
      setShowSummary(true);
    }
  }, [isInterviewComplete]);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const captureIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Timer
  useEffect(() => {
    if (!isInterviewStarted || isInterviewComplete) return;
    const timer = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) { setIsInterviewComplete(true); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isInterviewStarted, isInterviewComplete]);

  // Emotion capture effect
  useEffect(() => {
    if (isCameraOn && isCapturingExpression) {
      const timeout = setTimeout(() => {
        captureFrame();
        setIsCapturingExpression(false);
      }, 2000);
      captureIntervalRef.current = timeout;
    } else {
      if (captureIntervalRef.current) {
        clearTimeout(captureIntervalRef.current);
        captureIntervalRef.current = null;
      }
    }
    return () => {
      if (captureIntervalRef.current) clearTimeout(captureIntervalRef.current);
    };
  }, [isCameraOn, isCapturingExpression]);

  const startInterview = () => {
    setIsInterviewStarted(true);
    setTimeRemaining(roundDuration * 60);
    startCurrentRound();
  };

  const startCurrentRound = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const emotionScore = userExpression
        ? `${userExpression.dominantEmotion} (confidence: ${userExpression.confidenceScore})`
        : 'neutral (confidence: 0.5)';

      const skillStrings = (resumeData?.skills || []).map(s =>
        typeof s === 'string' ? s : JSON.stringify(s)
      );
      const projectStrings = (resumeData?.projects || []).map(p =>
        typeof p === 'string' ? p : (p as any).name || (p as any).description || 'Project'
      );

      let question: string;

      // ── PRIMARY: Backend API ───────────────────────────────────────────
      try {
        console.log('[CoreRound] Attempting to call backend API for core round...');
        const response = await apiService.getProjectQuestion({
          emotion: emotionScore,
          last_answer: '',
          projects: projectStrings,
          skills: skillStrings,
          round: 'core',
        }, conversationId);
        question = response.question;
        console.log('[CoreRound] Backend API success:', question);
      } catch (apiError) {
        console.warn('[CoreRound] Backend API failed, trying local OpenAI service:', apiError);
        // ── SECONDARY: Gemini (Local) ──────────────────────────────────────────
        try {
          const ctx: QuestionContext = {
            round: 'core',
            previousQuestions: [],
            userExpression,
            resumeData
          };
          question = await openAI.generateQuestion(ctx);
          console.log('[CoreRound] Gemini fallback success:', question);
        } catch (geminiError) {
          console.error('[CoreRound] Both API and Gemini failed:', geminiError);
          // ── LAST RESORT ─────────────────────────────────────────────────────
          question = 'Can you explain the difference between a process and a thread in an operating system?';
          console.log('[CoreRound] Using hardcoded fallback question.');
        }
      }

      setCurrentQuestion(question);
      const questionId = `core_${Date.now()}`;
      setCurrentQuestionId(questionId);

      const questionMessage: Message = {
        id: questionId,
        text: question,
        sender: 'ai',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, questionMessage]);
      setPreviousQuestions(prev => [...prev, question]);

      setIsCapturingExpression(true);
      setTimeout(() => captureFrame(questionId), 2000);

      try {
        await azureTTS.speak(question, 'core');
      } catch (ttsError) {
        console.warn('TTS failed, continuing without audio:', ttsError);
      }

    } catch (error) {
      console.error('Error starting core round:', error);
      setError('Failed to start round - please try again');
    } finally {
      setIsLoading(false);
    }
  };

  const handleUserResponse = async (transcription: string) => {
    let safeText = (typeof transcription === 'string') ? transcription.trim() : '';
    if (!safeText || safeText.toLowerCase() === 'undefined' || safeText.toLowerCase() === 'null') {
      safeText = '[no answer]';
    }

    try {
      const userMessage: Message = {
        id: Date.now().toString(),
        text: safeText,
        sender: 'user',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, userMessage]);

      setIsCapturingExpression(true);
      setTimeout(() => captureFrame(currentQuestionId), 1000);

      const emotionScore = userExpression
        ? `${userExpression.dominantEmotion} (confidence: ${userExpression.confidenceScore})`
        : 'neutral (confidence: 0.5)';

      const skillStrings = (resumeData?.skills || []).map(s =>
        typeof s === 'string' ? s : JSON.stringify(s)
      );
      const projectStrings = (resumeData?.projects || []).map(p =>
        typeof p === 'string' ? p : (p as any).name || (p as any).description || 'Project'
      );

      let nextQuestion: string;

      // ── PRIMARY: Backend API ──────────────────────────────────────────
      try {
        console.log('[CoreRound] Calling backend API for core follow-up...');
        const response = await apiService.getProjectQuestion({
          emotion: emotionScore,
          last_answer: safeText,
          projects: projectStrings,
          skills: skillStrings,
          round: 'core',
        }, conversationId);
        nextQuestion = response.question;
        console.log('[CoreRound] Backend follow-up success:', nextQuestion);
      } catch (apiError) {
        console.warn('[CoreRound] Backend API failed for follow-up, trying local OpenAI service:', apiError);
        // ── SECONDARY: Gemini (Local) ──────────────────────────────────────────
        try {
          const ctx: QuestionContext = {
            round: 'core',
            previousQuestions,
            userExpression,
            resumeData,
            lastAnswer: safeText
          };
          nextQuestion = await openAI.generateFollowUpQuestion(ctx, safeText);
          console.log('[CoreRound] Gemini fallback follow-up generated:', nextQuestion);
        } catch (geminiError) {
          console.error('[CoreRound] Both API and Gemini failed for follow-up:', geminiError);
          // ── LAST RESORT ───────────────────────────────────────────────────
          nextQuestion = "Good answer! Now can you explain the ACID properties in database management systems?";
        }
      }

      setCurrentQuestion(nextQuestion);

      const nextQuestionId = `core_${Date.now()}`;
      const aiMessage: Message = {
        id: nextQuestionId,
        text: nextQuestion,
        sender: 'ai',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, aiMessage]);
      setPreviousQuestions(prev => [...prev, nextQuestion]);
      setCurrentQuestionId(nextQuestionId);

      await azureTTS.speak(nextQuestion, 'core');

    } catch (error) {
      console.error('Error handling user response:', error);
      setError('Failed to process response');
    }
  };

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const inputText = chatInput.trim();
    setChatInput('');
    await handleUserResponse(inputText);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      const audioChunks: Blob[] = [];
      mediaRecorder.ondataavailable = (event) => { audioChunks.push(event.data); };
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
        try {
          const transcription = await whisperService.transcribeAudio(audioBlob);
          await handleUserResponse(transcription);
        } catch (error) {
          console.error('Transcription error:', error);
          setError('Failed to transcribe audio');
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error('Error starting recording:', error);
      setError('Failed to start recording');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const startCamera = async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' }
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setIsCameraOn(true);

        setTimeout(() => {
          setIsCapturingExpression(true);
          captureFrame();
        }, 1000);
      }
    } catch (error) {
      console.error('Error starting camera:', error);
      if (error instanceof Error) {
        if (error.name === 'NotAllowedError') setError('Camera access denied.');
        else if (error.name === 'NotFoundError') setError('No camera found.');
        else setError('Failed to start camera.');
      }
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsCameraOn(false);
    setUserExpression(null);
    setCurrentEmotions([]);
  };

  const captureFrame = async (questionId?: string) => {
    const targetQuestionId = questionId || currentQuestionId;
    if (!videoRef.current || !canvasRef.current || !isCameraOn || !isCapturingExpression) return;

    const canvas = canvasRef.current;
    const video = videoRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx || video.videoWidth === 0 || video.videoHeight === 0) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.8);
    });

    if (!blob) return;

    try {
      setIsAnalyzing(true);
      const file = new File([blob], 'frame.jpg', { type: 'image/jpeg' });
      const formData = new FormData();
      formData.append('file', file);
      formData.append('json', JSON.stringify({ models: { face: {} } }));

      const jobResponse = await fetch('https://api.hume.ai/v0/batch/jobs', {
        method: 'POST',
        headers: { 'X-Hume-Api-Key': humeApiKey },
        body: formData,
      });

      if (!jobResponse.ok) throw new Error(`API error: ${jobResponse.status}`);

      const jobData = await jobResponse.json();
      const jobId = jobData.job_id;

      let jobStatus = 'RUNNING';
      let attempts = 0;
      const maxAttempts = 30;

      while (jobStatus === 'RUNNING' && attempts < maxAttempts) {
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 1000));

        const statusResponse = await fetch(`https://api.hume.ai/v0/batch/jobs/${jobId}`, {
          method: 'GET',
          headers: { 'X-Hume-Api-Key': humeApiKey },
        });

        if (!statusResponse.ok) break;

        const statusData = await statusResponse.json();
        jobStatus = statusData.state?.status || statusData.status;

        if (jobStatus === 'COMPLETED') {
          await new Promise(resolve => setTimeout(resolve, 1000));

          let predictionsFound = false;
          for (let predAttempt = 1; predAttempt <= 3; predAttempt++) {
            const predictionsResponse = await fetch(`https://api.hume.ai/v0/batch/jobs/${jobId}/predictions`, {
              method: 'GET',
              headers: { 'X-Hume-Api-Key': humeApiKey, 'accept': 'application/json; charset=utf-8' },
            });

            if (!predictionsResponse.ok) {
              if (predAttempt < 3) { await new Promise(r => setTimeout(r, 2000)); continue; }
              break;
            }

            const predictions = await predictionsResponse.json();
            if (predictions && Array.isArray(predictions) && predictions.length > 0 &&
              predictions[0].results?.predictions?.[0]?.models?.face?.grouped_predictions?.[0]?.predictions?.[0]?.emotions) {

              const emotions = predictions[0].results.predictions[0].models.face.grouped_predictions[0].predictions[0].emotions;
              if (emotions && emotions.length > 0) {
                const dominantEmotion = emotions.reduce((max: any, emotion: any) =>
                  emotion.score > max.score ? emotion : max
                );
                const expression = {
                  isConfident: dominantEmotion.name === 'Confidence' || dominantEmotion.score > 0.6,
                  isNervous: dominantEmotion.name === 'Doubt' || dominantEmotion.score < 0.4,
                  isStruggling: dominantEmotion.name === 'Confusion' || dominantEmotion.score < 0.3,
                  dominantEmotion: dominantEmotion.name,
                  confidenceScore: Math.round(dominantEmotion.score * 100) / 100,
                  emotionBreakdown: emotions
                };

                setUserExpression(expression);
                setCurrentEmotions(emotions);
                localStorage.setItem('currentEmotions', JSON.stringify(emotions));

                if (targetQuestionId) {
                  setQuestionExpressions(prev => {
                    const newMap = new Map(prev);
                    newMap.set(targetQuestionId, expression);
                    return newMap;
                  });
                }
                predictionsFound = true;
                break;
              }
            }

            if (predAttempt < 3 && !predictionsFound) {
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
          }

          if (!predictionsFound) {
            setUserExpression({ isConfident: false, isNervous: true, isStruggling: false, dominantEmotion: 'Neutral', confidenceScore: 0.5, emotionBreakdown: [] });
          }
          break;
        } else if (jobStatus === 'FAILED') break;
      }

    } catch (error: any) {
      console.error('[CoreRound] Error analyzing emotions:', error);
      setUserExpression({ isConfident: false, isNervous: true, isStruggling: false, dominantEmotion: 'Neutral', confidenceScore: 0.5, emotionBreakdown: [] });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (!isInterviewStarted) {
    return (
      <div className="min-h-screen bg-primary text-white p-6">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center mb-8">
            <h1 className="text-3xl font-bold">Core Round - Technical Subjects</h1>
          </div>

          <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-8">
            <h2 className="text-2xl font-semibold mb-6">Core Round Setup</h2>

            <div className="space-y-6">
              <div className="bg-blue-500/20 border border-blue-500/30 rounded-lg p-4">
                <h3 className="text-lg font-semibold mb-2">Round Details</h3>
                <p className="text-gray-300">
                  This round covers core computer science subjects: DBMS, OOP, Operating Systems,
                  System Design, and your resume skills/projects.
                </p>
                <p className="text-sm text-gray-400 mt-2">Duration: {roundDuration} minutes</p>
              </div>

              {resumeData && (
                <div className="bg-green-500/20 border border-green-500/30 rounded-lg p-4">
                  <h3 className="text-lg font-semibold mb-2">Your Skills</h3>
                  <div className="flex flex-wrap gap-2">
                    {resumeData.skills.map((skill, index) => (
                      <span key={index} className="text-sm bg-white/10 px-3 py-1 rounded-full text-gray-200">
                        {typeof skill === 'string' ? skill : JSON.stringify(skill)}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={startInterview}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-4 px-6 rounded-lg transition-colors"
              >
                Start Core Round
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-black text-white flex flex-col overflow-hidden relative">
      {/* Anti-cheat Warning Banner could go here if added */}

      {/* Header */}
      <div className="flex-shrink-0 bg-black/60 backdrop-blur-md border-b border-white/10 px-6 py-3 relative z-40">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="p-2 bg-green-500/20 rounded-lg border border-green-500/30">
              <Briefcase className="h-5 w-5 text-green-400" />
            </div>
            <div>
              <div className="flex items-center space-x-3">
                <h1 className="text-base font-semibold leading-tight">Core Round</h1>
                <span className="flex items-center space-x-1.5 bg-green-500/10 border border-green-500/20 rounded px-2 py-0.5 text-[10px] uppercase tracking-wider text-green-400 font-medium">
                  {/* <Shield className="h-3 w-3" /> */}
                  <span>Proctoring Active</span>
                </span>
              </div>
              <p className="text-xs text-gray-400">DBMS, OOP, OS & System Design</p>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2 px-3 py-1.5 bg-white/5 rounded-lg border border-white/10">
              <Clock className="h-4 w-4 text-gray-400" />
              <span className="font-mono text-sm font-medium">{formatTime(timeRemaining)}</span>
            </div>
            <button
              onClick={() => setIsInterviewComplete(true)}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-sm transition-colors"
            >
              <X className="h-4 w-4" />
              <span>End Round</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 p-4">
        <div className="max-w-7xl mx-auto h-full grid grid-cols-1 lg:grid-cols-5 gap-6">

          {/* LEFT PANEL: Chat (Takes up 3/5 width) */}
          <div className="lg:col-span-3 flex flex-col min-h-0 bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 overflow-hidden relative">

            {/* Panel Tabs */}
            <div className="flex-shrink-0 flex items-center border-b border-white/10 bg-black/20">
              <div
                className={`flex items-center space-x-2 px-6 py-4 text-sm font-medium transition-colors border-b-2 border-green-500 text-green-400 bg-green-500/5`}
              >
                <Briefcase className="h-4 w-4" />
                <span>Interview Chat</span>
                {isLoading && (
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse ml-2" />
                )}
              </div>
            </div>

            {/* Panel Body */}
            <div className="flex-1 overflow-hidden relative flex flex-col">
              {/* Scrollable Messages */}
              <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
                {messages.length === 0 && !isLoading && (
                  <div className="h-full flex flex-col items-center justify-center text-gray-500">
                    <Briefcase className="h-12 w-12 mb-4 opacity-20" />
                    <p>Your core interview connects shortly...</p>
                  </div>
                )}

                <AnimatePresence>
                  {messages.map((message) => (
                    <motion.div
                      key={message.id}
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -16 }}
                      transition={{ duration: 0.25 }}
                      className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[85%] px-5 py-4 rounded-2xl text-[15px] leading-relaxed shadow-sm ${message.sender === 'user'
                          ? 'bg-green-600 text-white rounded-br-sm'
                          : 'bg-white/10 text-gray-100 border border-white/10 rounded-bl-sm'
                          }`}
                      >
                        <div className="prose prose-invert prose-sm max-w-none">
                          <ReactMarkdown>{message.text}</ReactMarkdown>
                        </div>
                        <div className="text-xs opacity-40 mt-2 flex justify-end">
                          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>

                {isLoading && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
                    <div className="bg-white/5 border border-white/10 rounded-2xl rounded-bl-sm px-5 py-4 flex items-center space-x-3">
                      <div className="flex space-x-1">
                        <div className="w-2 h-2 bg-green-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <div className="w-2 h-2 bg-green-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <div className="w-2 h-2 bg-green-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                      <span className="text-sm text-gray-400 font-medium">Interviewer AI is typing...</span>
                    </div>
                  </motion.div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Chat Input Bar */}
              <div className="flex-shrink-0 px-6 py-4 border-t border-white/10 bg-black/20 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    {!isRecording ? (
                      <button
                        onClick={startRecording}
                        disabled={isLoading}
                        className="flex items-center space-x-2 px-4 py-2 bg-white/10 hover:bg-green-500/20 border border-white/10 hover:border-green-500/40 rounded-xl text-sm transition-all disabled:opacity-50"
                      >
                        <Mic className="h-4 w-4" />
                        <span>Voice Answer</span>
                      </button>
                    ) : (
                      <button
                        onClick={stopRecording}
                        className="flex items-center space-x-2 px-4 py-2 bg-red-600/30 hover:bg-red-600/50 border border-red-500/50 rounded-xl text-sm text-red-300 transition-all shadow-[0_0_15px_rgba(239,68,68,0.3)] animate-pulse"
                      >
                        <MicOff className="h-4 w-4" />
                        <span>Stop Recording</span>
                      </button>
                    )}
                  </div>
                </div>

                <form onSubmit={handleChatSubmit} className="flex space-x-3">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder={isRecording ? "Listening..." : "Type your answer..."}
                    disabled={isRecording || isLoading}
                    className="flex-1 px-5 py-3 bg-white/5 border border-white/15 rounded-xl text-white text-[15px] placeholder-gray-500 focus:outline-none focus:border-green-500/60 focus:bg-white/10 transition-all disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={isRecording || !chatInput.trim() || isLoading}
                    className="px-6 py-3 bg-green-600 hover:bg-green-500 disabled:bg-white/10 disabled:text-gray-500 text-white text-[15px] rounded-xl transition-all font-medium flex items-center shadow-lg shadow-green-500/20"
                  >
                    Send
                  </button>
                </form>
              </div>
            </div>
          </div>

          {/* RIGHT PANEL: AI Avatar & Camera Stack (Takes up 2/5 width) */}
          <div className="lg:col-span-2 flex flex-col gap-6 min-h-0">

            {/* Top: AI Avatar Frame */}
            <div className="flex-1 bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 overflow-hidden flex flex-col">
              <div className="px-4 py-3 border-b border-white/10 bg-black/20 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                  <h3 className="text-sm font-medium text-gray-200">Interviewer AI</h3>
                </div>
                {isLoading && (
                  <span className="text-[10px] uppercase tracking-wider text-green-400 border border-green-500/30 bg-green-500/10 px-2 py-0.5 rounded">Analyzing</span>
                )}
              </div>
              <div className="flex-1 relative bg-black/40 min-h-[200px]">
                <InterviewerAvatar isSpeaking={isLoading} accentColor="green" />
              </div>
            </div>

            {/* Bottom: Camera & Emotion Analysis */}
            <div className="flex-1 bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 overflow-hidden flex flex-col">
              <div className="relative bg-black h-full flex items-center justify-center">
                <video
                  ref={videoRef}
                  className="w-full h-full object-cover"
                  style={{ transform: 'scaleX(-1)' }}
                  autoPlay
                  muted
                  playsInline
                />
                <canvas ref={canvasRef} className="hidden" />

                {!isCameraOn && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80">
                    <CameraOff className="h-10 w-10 text-gray-500 mb-3" />
                    <p className="text-gray-400 text-sm mb-3">Camera is off</p>
                    <button
                      onClick={startCamera}
                      className="flex items-center space-x-2 px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg text-sm transition-colors"
                    >
                      <Camera className="h-4 w-4" />
                      <span>Enable Camera</span>
                    </button>
                  </div>
                )}

                {isCameraOn && (
                  <div className="absolute top-3 left-3 flex items-center space-x-1.5 px-2 py-1 bg-black/60 backdrop-blur-sm rounded-full border border-white/10">
                    <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                    <span className="text-xs text-gray-300 font-medium">LIVE</span>
                  </div>
                )}

                {isCameraOn && (
                  <button
                    onClick={stopCamera}
                    className="absolute top-3 right-3 p-1.5 bg-black/60 backdrop-blur-sm hover:bg-red-500/30 border border-white/10 rounded-full transition-colors z-10"
                    title="Turn off camera"
                  >
                    <CameraOff className="h-3.5 w-3.5 text-gray-300" />
                  </button>
                )}

                {/* Top 5 Emotions Overlay */}
                {isCameraOn && currentEmotions && currentEmotions.length > 0 && (
                  <div className="absolute top-12 right-3 pointer-events-none z-20">
                    <motion.div
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="bg-black/40 backdrop-blur-md border border-white/10 rounded-xl p-2.5 shadow-2xl w-40"
                    >
                      <div className="flex items-center justify-between mb-2 px-1">
                        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Sentiment</span>
                        <div className="flex items-center space-x-1">
                          <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                          <span className="text-[8px] text-gray-500 uppercase">Live</span>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        {[...currentEmotions]
                          .sort((a, b) => b.score - a.score)
                          .slice(0, 5)
                          .map((emotion) => (
                            <div key={emotion.name} className="flex flex-col space-y-0.5">
                              <div className="flex justify-between text-[10px] px-0.5">
                                <span className="text-gray-300 font-medium truncate mr-2">{emotion.name}</span>
                                <span className="text-gray-400 font-mono">{(emotion.score * 100).toFixed(0)}%</span>
                              </div>
                              <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                                <motion.div
                                  initial={{ width: 0 }}
                                  animate={{ width: `${emotion.score * 100}%` }}
                                  transition={{ duration: 0.5 }}
                                  className="h-full bg-gradient-to-r from-blue-500/50 to-purple-500/80"
                                />
                              </div>
                            </div>
                          ))
                        }
                      </div>
                    </motion.div>
                  </div>
                )}

                {/* AI Sentiment Status Indicator */}
                {isCameraOn && (
                  <div className="absolute bottom-3 left-3 p-1 rounded-lg pointer-events-none">
                    <div className="flex items-center bg-black/40 backdrop-blur-sm px-2 py-1 rounded-lg border border-white/5 text-[10px] text-gray-400 font-medium italic">
                      AI sentiment analysis active
                    </div>
                  </div>
                )}
              </div>
            </div>

            {error && (
              <div className="flex-shrink-0 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm flex items-start space-x-2">
                <span className="flex-1">{error}</span>
                <button onClick={() => setError(null)} className="text-red-500 hover:text-red-300 flex-shrink-0">✕</button>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Completion Modal */}
      {isInterviewComplete && showSummary && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-[#111] border border-white/10 rounded-2xl p-8 max-w-xl w-full mx-4 shadow-2xl relative overflow-hidden"
          >
            {/* Background decoration */}
            <div className="absolute -top-32 -right-32 w-64 h-64 bg-green-500/10 rounded-full blur-3xl pointer-events-none" />

            <div className="text-center mb-8 relative z-10">
              <div className="w-16 h-16 bg-green-500/20 border border-green-500/30 rounded-full flex items-center justify-center mx-auto mb-4">
                <Briefcase className="h-8 w-8 text-green-400" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Core Round Complete</h2>
              <p className="text-gray-400 text-sm">Time spent: {roundDuration} minutes</p>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-xl p-5 mb-8 relative z-10">
              <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">Round Statistics</h3>
              <div className="grid grid-cols-2 gap-y-4 gap-x-6 text-sm">
                <div className="flex justify-between items-center border-b border-white/5 pb-2">
                  <span className="text-gray-500">Total Questions</span>
                  <span className="text-white font-medium">{messages.filter(m => m.sender === 'ai').length}</span>
                </div>
                <div className="flex justify-between items-center border-b border-white/5 pb-2">
                  <span className="text-gray-500">Your Responses</span>
                  <span className="text-white font-medium">{messages.filter(m => m.sender === 'user').length}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-500">Emotion Captures</span>
                  <span className="text-white font-medium">{questionExpressions.size}</span>
                </div>
              </div>
            </div>

            <div className="flex justify-between items-center relative z-10">
              <button
                onClick={() => navigate('/dashboard')}
                className="px-5 py-2.5 text-gray-400 hover:text-white transition-colors text-sm font-medium"
              >
                Exit to Dashboard
              </button>

              <div className="flex space-x-3">
                <button
                  onClick={() => {
                    navigate('/nerv-summary', {
                      state: {
                        summary: 'Core Round completed successfully',
                        messages,
                        questionExpressions: Array.from(questionExpressions.entries()),
                        resumeData,
                        roundDuration,
                        conversationId,
                        roundType: 'core'
                      }
                    });
                  }}
                  className="px-5 py-2.5 bg-white/10 hover:bg-white/20 border border-white/20 shadow-lg shadow-black/50 text-white rounded-lg transition-all text-sm font-medium"
                >
                  View Report
                </button>
                <button
                  onClick={() => {
                    navigate('/hr-round', {
                      state: {
                        messages,
                        questionExpressions: Array.from(questionExpressions.entries()),
                        resumeData,
                        roundDuration,
                        conversationId,
                        technicalMessages: location.state?.technicalMessages || location.state?.messages || [],
                        technicalQuestionExpressions: location.state?.technicalQuestionExpressions || location.state?.questionExpressions || [],
                        coreMessages: messages,
                        coreQuestionExpressions: Array.from(questionExpressions.entries()),
                      }
                    });
                  }}
                  className="px-6 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-all text-sm font-medium shadow-lg shadow-purple-500/20"
                >
                  Start HR Round →
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default CoreRound;
