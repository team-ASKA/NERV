import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import {
  Mic, MicOff, Camera, CameraOff, Volume2, VolumeX,
  Loader2, ArrowLeft, ArrowRight, Clock, Brain, Briefcase, Users, X
} from 'lucide-react';
import { FaVideo } from 'react-icons/fa';
import ReactMarkdown from 'react-markdown';

// Services
import { sarvamTTS as azureTTS } from '../services/sarvamTTSService';
import { InterviewerAvatar } from '../components/InterviewerAvatar';
import { sarvamSTT as whisperService } from '../services/sarvamSTTService';
import { humeAI, UserExpression } from '../services/humeAIService';
import { openAI, QuestionContext } from '../services/openAIService';
import { resumeService, ResumeData } from '../services/resumeService';
import { getResumeData } from '../services/firebaseResumeService';
import { apiService } from '../services/apiService';

// Types
interface Message {
  id: string;
  text: string;
  sender: 'user' | 'ai';
  timestamp: Date;
  round: 'technical' | 'core' | 'hr';
}

interface RoundConfig {
  name: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  duration: number; // in minutes
}

const ROUND_CONFIGS: Record<string, RoundConfig> = {
  technical: {
    name: 'Technical Round (DSA)',
    description: 'Data Structures & Algorithms',
    icon: <Brain className="h-5 w-5" />,
    color: 'blue',
    duration: 0 // Will be set by user
  },
  core: {
    name: 'Core Subjects Round',
    description: 'DBMS, OOPS, OS, System Design',
    icon: <Briefcase className="h-5 w-5" />,
    color: 'green',
    duration: 0 // Will be set by user
  },
  hr: {
    name: 'HR Round',
    description: 'Behavioral & Soft Skills',
    icon: <Users className="h-5 w-5" />,
    color: 'purple',
    duration: 0 // Will be set by user
  }
};

const MultiRoundInterview: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  // Interview state
  const [isInterviewStarted] = useState(false);
  const [isInterviewComplete, setIsInterviewComplete] = useState(false);
  const [currentRound, setCurrentRound] = useState<'technical' | 'core' | 'hr'>('technical');
  const [roundIndex, setRoundIndex] = useState(0);
  const [isBreak, setIsBreak] = useState(false);
  const [breakTimeRemaining, setBreakTimeRemaining] = useState(20);

  // Time management
  const [totalDuration, setTotalDuration] = useState(3); // minutes (3 rounds of 1 minute each)
  const [roundDuration, setRoundDuration] = useState(1); // minutes per round
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [roundTimeRemaining, setRoundTimeRemaining] = useState(0);

  // UI state
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Interview data
  const [messages, setMessages] = useState<Message[]>([]);
  const [resumeData, setResumeData] = useState<ResumeData | null>(null);
  const [userExpression, setUserExpression] = useState<UserExpression | null>(null);
  const [previousQuestions, setPreviousQuestions] = useState<string[]>([]);
  const [chatInput, setChatInput] = useState<string>('');
  const [questionExpressions, setQuestionExpressions] = useState<Map<string, UserExpression>>(new Map());
  const [isCapturingExpression, setIsCapturingExpression] = useState<boolean>(false);
  const [showSummary, setShowSummary] = useState<boolean>(false);
  const [interviewSummary, setInterviewSummary] = useState<any>(null);

  // Avatar state
  const [isAvatarSpeaking, setIsAvatarSpeaking] = useState<boolean>(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState<boolean>(false);

  // Sync user speaking with recording state
  useEffect(() => {
    setIsUserSpeaking(isRecording);
  }, [isRecording]);

  // Load resume data from Firebase or localStorage
  useEffect(() => {
    const loadResumeData = async () => {
      if (currentUser) {
        try {
          const resumeData = await getResumeData(currentUser.uid);
          if (resumeData) {
            setResumeData(resumeData);
            console.log('Loaded resume data in MultiRoundInterview:', resumeData);
            console.log('Resume data structure:', {
              skills: resumeData?.skills?.length || 0,
              projects: resumeData?.projects?.length || 0,
              achievements: resumeData?.achievements?.length || 0,
              experience: resumeData?.experience?.length || 0,
              education: resumeData?.education?.length || 0
            });
          } else {
            console.warn('No resume data found. Please upload a resume first.');
          }
        } catch (error) {
          console.error('Error loading resume data:', error);
        }
      }
    };

    loadResumeData();
  }, [currentUser]);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const captureIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize interview
  useEffect(() => {
    if (currentUser && !isInterviewStarted) {
      fetchUserDetails();
    }
  }, [currentUser, isInterviewStarted]);

  // Timer effects
  useEffect(() => {
    if (!isInterviewStarted || isInterviewComplete) return;

    const timer = setInterval(() => {
      if (isBreak) {
        setBreakTimeRemaining(prev => {
          if (prev <= 1) {
            setIsBreak(false);
            startNextRound();
            return 30;
          }
          return prev - 1;
        });
      } else {
        setTimeRemaining(prev => {
          if (prev <= 1) {
            endCurrentRound();
            return 0;
          }
          return prev - 1;
        });

        setRoundTimeRemaining(prev => {
          if (prev <= 1) {
            endCurrentRound();
            return 0;
          }
          return prev - 1;
        });
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [isInterviewStarted, isInterviewComplete, isBreak]);

  // Fetch user details and resume data
  const fetchUserDetails = async () => {
    if (!currentUser) return;

    try {
      setIsLoading(true);
      const userDoc = await getDoc(doc(db, 'users', currentUser.uid));

      if (userDoc.exists()) {
        const userData = userDoc.data();

        // Parse resume if available
        if (userData.resumeText) {
          const parsedResume = await resumeService.parseResume(userData.resumeText);
          console.log('Resume data loaded:', parsedResume);
          setResumeData(parsedResume);
        } else {
          console.log('No resume text found in user data');
        }
      }
    } catch (error) {
      console.error('Error fetching user details:', error);
      setError('Failed to load user details');
    } finally {
      setIsLoading(false);
    }
  };

  // Start interview
  const startInterview = () => {
    // Navigate to technical round with data
    navigate('/technical-round', {
      state: {
        roundDuration,
        resumeData,
        messages: [],
        questionExpressions: new Map()
      }
    });
  };

  // Start current round
  const startCurrentRound = async (overrideRound?: 'technical' | 'core' | 'hr') => {
    const activeRound = overrideRound || currentRound;
    try {
      setIsLoading(true);

      // Generate first question for current round
      const questionContext: QuestionContext = {
        round: activeRound,
        userExpression: userExpression || {
          isConfident: false,
          isNervous: false,
          isStruggling: false,
          dominantEmotion: 'neutral',
          confidenceScore: 0.5
        },
        resumeData: resumeData || undefined, // Resume data is now sent to all rounds
        previousQuestions
      };

      console.log('Question context for', activeRound, ':', questionContext);
      const question = await openAI.generateQuestion(questionContext);
      // setCurrentQuestion(question);

      // Generate unique question ID
      const questionId = `${activeRound}_${Date.now()}`;

      // Add question to messages
      const questionMessage: Message = {
        id: questionId,
        text: question,
        sender: 'ai',
        timestamp: new Date(),
        round: activeRound
      };
      setMessages(prev => [...prev, questionMessage]);
      setPreviousQuestions(prev => [...prev, question]);

      // Start capturing expression for this question
      setIsCapturingExpression(true);

      // Capture expression after a short delay to let the question sink in
      setTimeout(() => {
        captureFrame(questionId);
      }, 2000);

      // Ensure React flushes the new message to the DOM before audio starts
      await new Promise(resolve => setTimeout(resolve, 50));

      // Speak the question via Sarvam TTS
      try {
        setIsAvatarSpeaking(true);
        await azureTTS.speak(question, activeRound);
        setIsAvatarSpeaking(false);
      } catch (e) {
        setIsAvatarSpeaking(false);
      }

    } catch (error) {
      console.error('Error starting round:', error);
      setError('Failed to start round');
    } finally {
      setIsLoading(false);
    }
  };

  // End current round
  const endCurrentRound = () => {
    if (roundIndex < 2) {
      // Start break before next round
      setIsBreak(true);
      setBreakTimeRemaining(20);
    } else {
      // Interview complete - generate summary
      generateInterviewSummary();
      setIsInterviewComplete(true);
    }
  };

  // Generate detailed interview summary
  const generateInterviewSummary = async () => {
    try {
      setIsLoading(true);

      // Filter messages by round
      const technicalMessages = messages.filter(m => m.round === 'technical');
      const projectMessages = messages.filter(m => m.round === 'core');
      const hrMessages = messages.filter(m => m.round === 'hr');

      const summary = await apiService.generateInterviewSummary(
        { messages: technicalMessages },
        { messages: projectMessages },
        { messages: hrMessages },
        resumeData,
        questionExpressions
      );

      setInterviewSummary(summary);
      setShowSummary(true);
    } catch (error) {
      console.error('Error generating summary:', error);
      // Create fallback summary
      const fallbackSummary = `
# Interview Summary (Fallback)

## Technical Round
- Questions asked: ${messages.filter(m => m.round === 'technical' && m.sender === 'ai').length}

## Core Round  
- Questions asked: ${messages.filter(m => m.round === 'core' && m.sender === 'ai').length}

## HR Round
- Questions asked: ${messages.filter(m => m.round === 'hr' && m.sender === 'ai').length}

## Assessment
- Total questions: ${messages.filter(m => m.sender === 'ai').length}
- Resume skills: ${resumeData?.skills?.join(', ') || 'Not available'}
      `;
      setInterviewSummary(fallbackSummary);
      setShowSummary(true);
    } finally {
      setIsLoading(false);
    }
  };

  // Start next round
  const startNextRound = () => {
    const rounds: ('technical' | 'core' | 'hr')[] = ['technical', 'core', 'hr'];
    const nextRoundIndex = roundIndex + 1;

    if (nextRoundIndex < rounds.length) {
      const nextRound = rounds[nextRoundIndex];
      setCurrentRound(nextRound);
      setRoundIndex(nextRoundIndex);
      setRoundTimeRemaining(roundDuration * 60);
      // Keep camera running, don't restart it
      startCurrentRound(nextRound);
    }
  };

  // Handle user response
  const handleUserResponse = async (transcription: string) => {
    if (!transcription.trim()) return;

    try {
      // Add user message
      const userMessage: Message = {
        id: Date.now().toString(),
        text: transcription,
        sender: 'user',
        timestamp: new Date(),
        round: currentRound
      };
      setMessages(prev => [...prev, userMessage]);

      // Generate follow-up question or next question
      const questionContext: QuestionContext = {
        round: currentRound,
        userExpression: userExpression || {
          isConfident: false,
          isNervous: false,
          isStruggling: false,
          dominantEmotion: 'neutral',
          confidenceScore: 0.5
        },
        resumeData: resumeData || undefined, // Resume data is always included
        previousQuestions
      };

      const nextQuestion = await openAI.generateFollowUpQuestion(questionContext, transcription);
      // setCurrentQuestion(nextQuestion);

      // Add AI response to messages
      const aiMessage: Message = {
        id: Date.now().toString(),
        text: nextQuestion,
        sender: 'ai',
        timestamp: new Date(),
        round: currentRound
      };
      setMessages(prev => [...prev, aiMessage]);
      setPreviousQuestions(prev => [...prev, nextQuestion]);

      // Ensure React flushes the new message to the DOM before audio starts
      await new Promise(resolve => setTimeout(resolve, 50));

      // Speak the response via Sarvam TTS
      try {
        setIsAvatarSpeaking(true);
        await azureTTS.speak(nextQuestion, currentRound);
        setIsAvatarSpeaking(false);
      } catch (e) {
        setIsAvatarSpeaking(false);
      }

    } catch (error) {
      console.error('Error handling user response:', error);
      setError('Failed to process response');
    }
  };

  // Handle chat input submission
  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const inputText = chatInput.trim();
    setChatInput(''); // Clear input immediately
    await handleUserResponse(inputText);
  };

  // Start recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);

      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });

        try {
          const transcription = await whisperService.transcribeAudio(audioBlob);
          await handleUserResponse(transcription);
        } catch (error) {
          console.error('Transcription error:', error);
          setError('Failed to transcribe audio');
        }
      };

      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
    } catch (error) {
      console.error('Error starting recording:', error);
      setError('Failed to start recording');
    }
  };

  // Stop recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  // Start video stream
  const startVideoStream = async () => {
    try {
      console.log('Requesting camera access...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user'
        },
        audio: false
      });

      console.log('Camera stream obtained:', stream);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(console.error);
        setIsCameraOn(true);
        console.log('Video element updated with stream');
      }
    } catch (error) {
      console.error('Error accessing camera:', error);
      if (error instanceof Error) {
        if (error.name === 'NotAllowedError') {
          setError('Camera access denied. Please allow camera permissions and refresh the page.');
        } else if (error.name === 'NotFoundError') {
          setError('No camera found. Please connect a camera and try again.');
        } else {
          setError(`Camera error: ${error.message}`);
        }
      } else {
        setError('Could not access camera. Please check permissions and try again.');
      }
    }
  };

  // Stop video stream
  const stopVideoStream = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
      setIsCameraOn(false);
      // Clear emotion data when camera is turned off
      setUserExpression(null);
    }
  };

  // Capture frame for emotion analysis (only when question is asked)
  const captureFrame = async (questionId?: string) => {
    if (!videoRef.current || !canvasRef.current || !isCameraOn || !isCapturingExpression) return;

    const canvas = canvasRef.current;
    const video = videoRef.current;
    const ctx = canvas.getContext('2d');

    if (!ctx || video.videoWidth === 0 || video.videoHeight === 0) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);

    const imageData = canvas.toDataURL('image/jpeg', 0.8);

    try {
      const expression = await humeAI.analyzeEmotions(imageData);
      setUserExpression(expression);

      // Store expression for this specific question if questionId provided
      if (questionId) {
        setQuestionExpressions(prev => new Map(prev.set(questionId, expression)));
      }
    } catch (error) {
      console.error('Error analyzing emotions:', error);
    }
  };

  // Start/stop emotion analysis (only when capturing)
  useEffect(() => {
    if (isCameraOn && isCapturingExpression) {
      const interval = setInterval(() => captureFrame(), 1000); // Capture every 1 second when capturing
      captureIntervalRef.current = interval;
    } else {
      if (captureIntervalRef.current) {
        clearInterval(captureIntervalRef.current);
        captureIntervalRef.current = null;
      }
    }

    return () => {
      if (captureIntervalRef.current) {
        clearInterval(captureIntervalRef.current);
      }
    };
  }, [isCameraOn, isCapturingExpression]);

  // Format time helper
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-primary flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white mb-4">Please log in to access the interview</h1>
          <button
            onClick={() => navigate('/login')}
            className="px-6 py-3 bg-white text-black rounded-lg hover:bg-gray-200 transition-colors"
          >
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  if (isLoading && !isInterviewStarted) {
    return (
      <div className="min-h-screen bg-primary flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p className="text-white">Loading interview...</p>
        </div>
      </div>
    );
  }

  if (!isInterviewStarted) {
    return (
      <div className="min-h-screen bg-black text-white p-4 md:p-8 flex flex-col justify-center">
        <div className="max-w-3xl mx-auto w-full">
          <div className="flex items-center mb-6">
            <button
              onClick={() => navigate('/dashboard')}
              className="p-2 hover:bg-white/10 rounded-xl transition-all mr-4 border border-white/5"
              title="Back to dashboard"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-2xl font-black uppercase tracking-tighter">
                NERV <span className="text-white/30">/</span> Setup
              </h1>
              <p className="text-[8px] font-bold uppercase tracking-[0.3em] text-gray-600 mt-0.5">Protocol Initialization</p>
            </div>
          </div>

          <div className="bg-white/[0.01] backdrop-blur-xl rounded-3xl p-6 md:p-8">
            <h2 className="text-xs font-bold uppercase tracking-[0.2em] mb-6 pb-2 border-b border-white/5 text-gray-500 text-center">Configure Session Parameters</h2>

            <div className="space-y-6">
              {/* Duration Slider */}
              <div className="bg-white/[0.03] p-6 rounded-2xl border border-white/5">
                <div className="flex justify-between items-end mb-4">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                    Total Duration
                  </label>
                  <span className="text-xl font-black">{totalDuration} <span className="text-[8px] text-gray-600 uppercase">min</span></span>
                </div>
                <input
                  type="range"
                  min="3"
                  max="60"
                  step="3"
                  value={totalDuration}
                  onChange={(e) => {
                    const duration = parseInt(e.target.value);
                    setTotalDuration(duration);
                    setRoundDuration(Math.max(1, Math.floor(duration / 3)));
                  }}
                  className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-white"
                  aria-label="Total interview duration in minutes"
                />
                <div className="flex justify-between text-[8px] font-bold text-white-700 uppercase tracking-widest mt-3">
                  <span>Fast (3m)</span>
                  <span>{roundDuration}m/round</span>
                  <span>Deep (60m)</span>
                </div>
              </div>

              {/* Round Preview Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {Object.entries(ROUND_CONFIGS).map(([key, config]) => (
                  <div 
                    key={key} 
                    className={`relative overflow-hidden p-4 rounded-xl transition-all duration-300 ${
                      currentRound === key 
                        ? 'bg-white/10 ring-1 ring-white/20' 
                        : 'bg-white/[0.02] opacity-40'
                    }`}
                  >
                    <div className="relative z-10 text-center md:text-left">
                      <div className={`p-2 rounded-lg w-fit mx-auto md:mx-0 mb-3 ${
                        key === 'technical' ? 'bg-blue-500/20 text-blue-400' :
                        key === 'core' ? 'bg-purple-500/20 text-purple-400' :
                        'bg-pink-500/20 text-pink-400'
                      }`}>
                        {React.cloneElement(config.icon as React.ReactElement, { className: 'h-4 w-4' })}
                      </div>
                      <h3 className="font-bold text-[11px] uppercase tracking-tight mb-1">{config.name}</h3>
                      <p className="text-[9px] text-gray-500 font-medium leading-tight">{config.description}</p>
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={startInterview}
                className="w-full relative group overflow-hidden bg-white text-black py-4 rounded-xl font-black text-[10px] uppercase tracking-[0.2em] transition-all hover:scale-[1.01] active:scale-[0.99] shadow-xl shadow-white/5"
              >
                <span className="relative z-10 flex items-center justify-center">
                  Initialize Assessment
                  <ArrowRight className="ml-2 h-4 w-4 transform group-hover:translate-x-1 transition-transform" />
                </span>
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-black/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isBreak) {
    return (
      <div className="min-h-screen bg-primary flex items-center justify-center">
        <div className="text-center">
          <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-8">
            <Clock className="h-16 w-16 mx-auto mb-4 animate-pulse" />
            <h2 className="text-2xl font-bold mb-2">Break Time</h2>
            <p className="text-gray-400 mb-4">Get ready for the next round</p>
            <div className="text-4xl font-bold text-white">
              {breakTimeRemaining}
            </div>
            <p className="text-sm text-gray-400 mt-2">seconds remaining</p>
          </div>
        </div>
      </div>
    );
  }

  if (isInterviewComplete) {
    return (
      <div className="min-h-screen bg-primary flex items-center justify-center">
        <div className="text-center">
          <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-8">
            <h2 className="text-2xl font-bold mb-4">Interview Complete!</h2>
            <p className="text-gray-400 mb-6">Thank you for participating in the multi-round interview.</p>
            <button
              onClick={() => navigate('/dashboard')}
              className="px-6 py-3 bg-white text-black rounded-lg hover:bg-gray-200 transition-colors"
            >
              Back to Dashboard
            </button>
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
          <div className="flex items-center space-x-4">
            <button
              onClick={() => navigate('/dashboard')}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
              title="Back to dashboard"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="flex items-center space-x-2">
              {ROUND_CONFIGS[currentRound].icon}
              <h1 className="text-xl font-semibold">{ROUND_CONFIGS[currentRound].name}</h1>
            </div>
          </div>

          <div className="flex items-center space-x-6">
            <div className="text-center">
              <div className="text-sm text-gray-400">Round Time</div>
              <div className="text-lg font-mono">{formatTime(roundTimeRemaining)}</div>
            </div>
            <div className="text-center">
              <div className="text-sm text-gray-400">Total Time</div>
              <div className="text-lg font-mono">{formatTime(timeRemaining)}</div>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={async () => {
                  if (isCameraOn) {
                    stopVideoStream();
                  } else {
                    await startVideoStream();
                  }
                }}
                className={`p-2 rounded-lg transition-colors ${isCameraOn ? 'bg-red-600 hover:bg-red-700' : 'bg-white/10 hover:bg-white/20'
                  }`}
                title={isCameraOn ? 'Turn off camera' : 'Turn on camera'}
              >
                {isCameraOn ? <CameraOff className="h-5 w-5" /> : <Camera className="h-5 w-5" />}
              </button>

              <button
                onClick={() => setIsSpeaking(!isSpeaking)}
                className={`p-2 rounded-lg transition-colors ${isSpeaking ? 'bg-red-600 hover:bg-red-700' : 'bg-white/10 hover:bg-white/20'
                  }`}
                title={isSpeaking ? 'Mute audio' : 'Unmute audio'}
              >
                {isSpeaking ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6">
        {error && (
          <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4 mb-6">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Video Feed */}
          <div className="lg:col-span-1">
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center">
                <FaVideo className="mr-2" />
                Video Feed
              </h2>

                <div className="aspect-video bg-gray-900 rounded-lg overflow-hidden mb-4 border border-white/10 shadow-2xl relative group">
                  <InterviewerAvatar 
                    isAvatarSpeaking={isAvatarSpeaking}
                    isUserSpeaking={isUserSpeaking}
                  />
                </div>
                
                <div className="relative bg-black rounded-lg overflow-hidden">
                  <video
                    ref={videoRef}
                    autoPlay
                    muted
                    className="w-full h-48 object-cover"
                  />
                <canvas
                  ref={canvasRef}
                  className="hidden"
                />

                {!isCameraOn && (
                  <div className="absolute inset-0 bg-gray-900 flex flex-col items-center justify-center">
                    <Camera className="h-12 w-12 text-gray-400 mb-4" />
                    <button
                      onClick={startVideoStream}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                    >
                      Start Camera
                    </button>
                  </div>
                )}
              </div>

              {/* Emotion Analysis */}
              <div className="mt-4">
                <h3 className="text-sm font-medium mb-2">Emotion Analysis</h3>
                {isCameraOn && userExpression ? (
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span>Confidence</span>
                      <span>{Math.round(userExpression.confidenceScore * 100)}%</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span>Dominant Emotion</span>
                      <span className="capitalize">{userExpression.dominantEmotion}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span>Status</span>
                      <span className={userExpression.isConfident ? 'text-green-400' : 'text-yellow-400'}>
                        {userExpression.isConfident ? 'Confident' : userExpression.isNervous ? 'Nervous' : 'Neutral'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-gray-400">
                    {isCameraOn ? 'Analyzing emotions...' : 'Turn on camera for emotion analysis'}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Chat Interface */}
          <div className="lg:col-span-2">
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 h-[600px] flex flex-col">
              {/* Messages */}
              <div className="flex-1 overflow-y-auto space-y-4 mb-6">
                <AnimatePresence>
                  {messages.map((message) => (
                    <motion.div
                      key={message.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20 }}
                      className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`max-w-[80%] rounded-2xl p-4 ${message.sender === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-white/20 text-white'
                        }`}>
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
              </div>

              {/* Recording Controls */}
              <div className="space-y-4">
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
                  <button
                    type="submit"
                    className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Send
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Interview Summary Modal */}
      {showSummary && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold text-gray-800">Interview Summary</h2>
                <button
                  onClick={() => setShowSummary(false)}
                  className="text-gray-500 hover:text-gray-700"
                  title="Close summary"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="space-y-6">
                {/* Summary Content */}
                <div className="prose max-w-none">
                  <div className="whitespace-pre-wrap text-gray-700">
                    {interviewSummary || 'Generating summary...'}
                  </div>
                </div>

                {/* Expression Analysis */}
                <div className="border-t pt-6">
                  <h3 className="text-lg font-semibold mb-4">Expression Analysis by Question</h3>
                  <div className="space-y-3">
                    {Array.from(questionExpressions.entries()).map(([questionId, expression]) => (
                      <div key={questionId} className="bg-gray-50 p-3 rounded-lg">
                        <div className="text-sm text-gray-600 mb-2">Question ID: {questionId}</div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <span className="font-medium">Confident:</span> {expression.isConfident ? 'Yes' : 'No'}
                          </div>
                          <div>
                            <span className="font-medium">Nervous:</span> {expression.isNervous ? 'Yes' : 'No'}
                          </div>
                          <div>
                            <span className="font-medium">Struggling:</span> {expression.isStruggling ? 'Yes' : 'No'}
                          </div>
                          <div>
                            <span className="font-medium">Dominant Emotion:</span> {expression.dominantEmotion}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Resume Skills Gap */}
                {resumeData && (
                  <div className="border-t pt-6">
                    <h3 className="text-lg font-semibold mb-4">Resume Skills Analysis</h3>
                    <div className="grid md:grid-cols-2 gap-6">
                      <div>
                        <h4 className="font-medium mb-2">Your Skills:</h4>
                        <div className="flex flex-wrap gap-2">
                          {resumeData.skills.map((skill, index) => (
                            <span key={index} className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm">
                              {typeof skill === 'string' ? skill : JSON.stringify(skill)}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div>
                        <h4 className="font-medium mb-2">Projects:</h4>
                        <div className="space-y-1">
                          {resumeData.projects.map((project, index) => (
                            <div key={index} className="text-sm text-gray-600">
                              • {typeof project === 'string' ? project : JSON.stringify(project)}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end space-x-4 pt-6 border-t">
                <button
                  onClick={() => setShowSummary(false)}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                >
                  Close
                </button>
                <button
                  onClick={() => navigate('/nerv-summary', {
                    state: {
                      summary: interviewSummary,
                      messages,
                      questionExpressions,
                      resumeData,
                      roundDuration
                    }
                  })}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  View NERV Summary
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MultiRoundInterview;
