import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import {
  Mic, MicOff, Camera, CameraOff, Volume2, VolumeX,
  Loader2, ArrowLeft, Clock, Briefcase, X
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';

// Services
import { sarvamTTS as azureTTS } from '../services/sarvamTTSService';
import { sarvamSTT as whisperService } from '../services/sarvamSTTService';
import { apiService } from '../services/apiService';
import { openAI, QuestionContext } from '../services/openAIService';
import { resumeService } from '../services/resumeService';
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
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' }
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setIsCameraOn(true);
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
      setIsCameraOn(false);
      setUserExpression(null);
    }
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
    <div className="min-h-screen bg-primary text-white">
      {/* Header */}
      <div className="bg-black/20 backdrop-blur-sm border-b border-white/10 p-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Briefcase className="h-6 w-6 text-blue-400" />
            <h1 className="text-xl font-semibold">Core Round - Technical Subjects</h1>
          </div>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <Clock className="h-5 w-5" />
              <span className="font-mono text-lg">{formatTime(timeRemaining)}</span>
            </div>
            <button
              onClick={() => setIsInterviewComplete(true)}
              className="flex items-center space-x-1 px-3 py-1 bg-red-600/20 hover:bg-red-600/40 border border-red-500/30 rounded-lg text-red-300 text-sm transition-colors"
            >
              <X className="h-4 w-4" />
              <span>End Round</span>
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Video Feed */}
          <div className="lg:col-span-1">
            <div className="bg-black/20 backdrop-blur-sm rounded-2xl p-6">
              <h3 className="text-lg font-semibold mb-4 flex items-center">
                <Camera className="h-5 w-5 mr-2" />
                Video Feed
              </h3>

              <div className="relative bg-black rounded-lg overflow-hidden mb-4">
                <video ref={videoRef} className="w-full h-64 object-cover" autoPlay muted playsInline />
                <canvas ref={canvasRef} className="hidden" />
                {!isCameraOn && (
                  <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
                    <div className="text-center">
                      <CameraOff className="h-12 w-12 text-gray-400 mx-auto mb-2" />
                      <p className="text-gray-400">Camera Off</p>
                      <button onClick={startCamera} className="mt-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors">
                        Start Camera
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex space-x-2 mb-4">
                {!isCameraOn ? (
                  <button onClick={startCamera} className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">
                    <Camera className="h-4 w-4" />
                    <span>Start Camera</span>
                  </button>
                ) : (
                  <button onClick={stopCamera} className="flex items-center space-x-2 px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg transition-colors">
                    <CameraOff className="h-4 w-4" />
                    <span>Stop Camera</span>
                  </button>
                )}
              </div>

              {/* Emotion Analysis */}
              <div className="mt-4 p-4 bg-white/5 rounded-lg">
                <h4 className="text-sm font-medium mb-2">Emotion Analysis</h4>
                {isCameraOn ? (
                  userExpression ? (
                    <div className="space-y-3">
                      {userExpression.emotionBreakdown && (
                        <div className="space-y-2">
                          <h4 className="text-sm font-medium text-gray-300 mb-2">Emotions:</h4>
                          {userExpression.emotionBreakdown.slice(0, 5).map((emotion, index) => (
                            <div key={index} className="space-y-1">
                              <div className="flex justify-between text-xs">
                                <span className="text-gray-300">{emotion.name}:</span>
                                <span className="text-white font-medium">{(emotion.score * 100).toFixed(0)}%</span>
                              </div>
                              <div className="w-full bg-gray-700 rounded-full h-1.5">
                                <div
                                  className="bg-gradient-to-r from-blue-500 to-cyan-500 h-1.5 rounded-full transition-all duration-300"
                                  style={{ width: `${emotion.score * 100}%` }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="space-y-2 text-sm border-t border-gray-600 pt-2">
                        <div className="flex justify-between">
                          <span>Confidence:</span>
                          <span className={userExpression.isConfident ? 'text-green-400' : 'text-red-400'}>
                            {userExpression.isConfident ? 'High' : 'Low'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Status:</span>
                          <span className={userExpression.isStruggling ? 'text-yellow-400' : 'text-green-400'}>
                            {userExpression.isStruggling ? 'Struggling' : 'Doing Well'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Data Source:</span>
                          <span className="text-blue-400 text-xs">
                            {userExpression.emotionBreakdown && userExpression.emotionBreakdown.length > 0 ? 'Real Face Detected' : 'Fallback Data'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-gray-400 text-sm">
                      {isCapturingExpression ? 'Analyzing emotions...' : 'Turn on camera for emotion analysis'}
                    </p>
                  )
                ) : (
                  <p className="text-gray-400 text-sm">Turn on camera for emotion analysis</p>
                )}
              </div>

              {/* Error display */}
              {error && (
                <div className="mt-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-300 text-sm">
                  {error}
                  <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-200">✕</button>
                </div>
              )}
            </div>
          </div>

          {/* Chat Interface */}
          <div className="lg:col-span-2">
            <div className="bg-black/20 backdrop-blur-sm rounded-2xl p-6 h-full flex flex-col">
              <h3 className="text-lg font-semibold mb-4">Interview Chat</h3>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto space-y-4 min-h-0 mb-4 max-h-96">
                <AnimatePresence>
                  {messages.map((message) => (
                    <motion.div
                      key={message.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20 }}
                      className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`max-w-[80%] p-4 rounded-lg ${message.sender === 'user' ? 'bg-blue-600 text-white' : 'bg-white/10 text-gray-100'}`}>
                        <div className="prose prose-invert max-w-none">
                          <ReactMarkdown>{message.text}</ReactMarkdown>
                        </div>
                        <div className="text-xs opacity-70 mt-2">
                          {message.timestamp.toLocaleTimeString()}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
                <div ref={messagesEndRef} />
              </div>

              {/* Controls */}
              <div className="sticky bottom-0 space-y-4 bg-black/20 backdrop-blur-sm rounded-lg p-4 -mx-2 -mb-2">
                <div className="flex items-center space-x-4">
                  {!isRecording ? (
                    <button
                      onClick={startRecording}
                      className="flex items-center space-x-2 px-6 py-3 bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
                    >
                      <Mic className="h-5 w-5" />
                      <span>Start Recording</span>
                    </button>
                  ) : (
                    <button
                      onClick={stopRecording}
                      className="flex items-center space-x-2 px-6 py-3 bg-gray-600 hover:bg-gray-700 rounded-lg transition-colors"
                    >
                      <MicOff className="h-5 w-5" />
                      <span>Stop Recording</span>
                    </button>
                  )}

                  {isLoading && (
                    <div className="flex items-center space-x-2 text-sm text-gray-400">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Generating question...</span>
                    </div>
                  )}
                </div>

                {/* Chat Input */}
                <form onSubmit={handleChatSubmit} className="flex space-x-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Type your response here..."
                    className="flex-1 px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                  />
                  <button type="submit" className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                    Send
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Interview Complete Summary */}
      {isInterviewComplete && showSummary && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-gray-900 rounded-2xl p-8 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-white mb-2">Core Round Complete!</h2>
              <p className="text-gray-400">Round Duration: {roundDuration} minutes</p>
            </div>

            <div className="space-y-4 mb-6">
              <div className="bg-blue-600/20 border border-blue-500/50 rounded-lg p-4">
                <h3 className="text-lg font-semibold text-blue-300 mb-2">Round Statistics</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-400">Questions Asked:</span>
                    <span className="text-white ml-2">{messages.filter(m => m.sender === 'ai').length}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">Your Responses:</span>
                    <span className="text-white ml-2">{messages.filter(m => m.sender === 'user').length}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">Emotion Captures:</span>
                    <span className="text-white ml-2">{questionExpressions.size}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">Confident Moments:</span>
                    <span className="text-white ml-2">{Array.from(questionExpressions.values()).filter(e => e.isConfident).length}</span>
                  </div>
                </div>
              </div>

              {questionExpressions.size > 0 && (
                <div className="bg-green-600/20 border border-green-500/50 rounded-lg p-4">
                  <h3 className="text-lg font-semibold text-green-300 mb-2">Emotion Analysis</h3>
                  <div className="space-y-2">
                    {Array.from(questionExpressions.entries()).map(([questionId, expression], index) => (
                      <div key={questionId} className="flex justify-between items-center text-sm">
                        <span className="text-gray-300">Question {index + 1}:</span>
                        <span className={`px-2 py-1 rounded text-xs ${expression.isConfident ? 'bg-green-600/30 text-green-300' : expression.isNervous ? 'bg-red-600/30 text-red-300' : 'bg-yellow-600/30 text-yellow-300'}`}>
                          {expression.dominantEmotion} ({Math.round(expression.confidenceScore * 100)}%)
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-4">
              <button
                onClick={() => navigate('/dashboard')}
                className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
              >
                Back to Dashboard
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
                      // Pass technical round data through
                      technicalMessages: location.state?.technicalMessages || location.state?.messages || [],
                      technicalQuestionExpressions: location.state?.technicalQuestionExpressions || location.state?.questionExpressions || [],
                      coreMessages: messages,
                      coreQuestionExpressions: Array.from(questionExpressions.entries()),
                    }
                  });
                }}
                className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
              >
                Continue to HR Round →
              </button>
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
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                View Summary
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CoreRound;