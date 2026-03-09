import React, { useState, useEffect, useRef } from 'react';
import { InterviewerAvatar } from '../components/InterviewerAvatar';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, useLocation } from 'react-router-dom';
import { apiService } from '../services/apiService';
import { useAuth } from '../contexts/AuthContext';
import {
  Mic, MicOff, Camera, CameraOff,
  Clock, Users, X
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';

// Services
import { sarvamTTS as azureTTS } from '../services/sarvamTTSService';
import { sarvamSTT as whisperService } from '../services/sarvamSTTService';
// import { humeAI } from '../services/humeAIService'; // Using direct API instead
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

const HRRound: React.FC = (): JSX.Element => {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser } = useAuth();

  // Get data from previous rounds
  const roundDuration = location.state?.roundDuration || 3;
  const previousMessages = location.state?.messages || [];
  const previousExpressions = location.state?.questionExpressions || new Map();

  // UI state
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Avatar state
  const [isAvatarSpeaking, setIsAvatarSpeaking] = useState<boolean>(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState<boolean>(false);

  // Sync user speaking with recording state
  useEffect(() => {
    setIsUserSpeaking(isRecording);
  }, [isRecording]);

  // Interview data
  const [messages, setMessages] = useState<Message[]>(previousMessages);
  const [currentQuestionId, setCurrentQuestionId] = useState<string>('');
  const [resumeData, setResumeData] = useState<ResumeData | null>(location.state?.resumeData || null);
  const [userExpression, setUserExpression] = useState<UserExpression | null>(null);
  const [previousQuestions, setPreviousQuestions] = useState<string[]>([]);
  const [chatInput, setChatInput] = useState<string>('');
  const [questionExpressions, setQuestionExpressions] = useState<Map<string, UserExpression>>(previousExpressions);
  const [isCapturingExpression, setIsCapturingExpression] = useState<boolean>(false);
  const [currentEmotions, setCurrentEmotions] = useState<any[]>([]);
  const [humeApiKey] = useState<string>(
    import.meta.env.VITE_HUME_API_KEY || ''
  );

  // Time management
  const [timeRemaining, setTimeRemaining] = useState(roundDuration * 60);
  const [isInterviewStarted, setIsInterviewStarted] = useState(false);
  const [isInterviewComplete, setIsInterviewComplete] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [conversationId, setConversationId] = useState<string>('');

  // Generate conversation ID when component mounts
  useEffect(() => {
    const newConversationId = `hr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    setConversationId(newConversationId);
    console.log('[HRRound] Generated conversation ID:', newConversationId);
  }, []);

  // Load resume data from location state or Firebase
  useEffect(() => {
    const loadResumeData = async () => {
      if (location.state?.resumeData) {
        setResumeData(location.state.resumeData);
        console.log('Loaded resume data from location state:', location.state.resumeData);
      } else if (currentUser) {
        // Fallback to Firebase if not in location state
        try {
          const resumeData = await getResumeData(currentUser.uid);
          if (resumeData) {
            setResumeData(resumeData);
            console.log('Loaded resume data from Firebase:', resumeData);
          }
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
      console.log('[HRRound] Interview completed, collecting data...');
      console.log('[HRRound] Messages:', messages);
      console.log('[HRRound] Question expressions:', questionExpressions);
      setShowSummary(true);
    }
  }, [isInterviewComplete, messages, questionExpressions]);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const captureIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Timer effect
  useEffect(() => {
    if (!isInterviewStarted || isInterviewComplete) return;

    const timer = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          setIsInterviewComplete(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isInterviewStarted, isInterviewComplete]);

  // Start interview
  const startInterview = () => {
    setIsInterviewStarted(true);
    setTimeRemaining(roundDuration * 60);
    startCurrentRound();
  };

  // Start current round
  const startCurrentRound = async () => {
    try {
      setIsLoading(true);
      setError(null); // Clear any previous errors

      // Generate first question using API with fallback
      const emotionScore = userExpression ?
        `${userExpression.dominantEmotion} (confidence: ${userExpression.confidenceScore})` :
        'neutral (confidence: 0.5)';

      const achievements = resumeData?.achievements || [];
      const experience = resumeData?.experience || [];

      // Convert achievement and experience objects to strings for the API
      const achievementStrings = achievements.map(achievement => {
        if (typeof achievement === 'string') {
          return achievement;
        } else if (typeof achievement === 'object' && achievement !== null) {
          return achievement.description || achievement.name || 'Achievement';
        }
        return 'Unknown achievement';
      });

      const experienceStrings = experience.map(exp => {
        if (typeof exp === 'string') {
          return exp;
        } else if (typeof exp === 'object' && exp !== null) {
          return `${exp.title || 'Role'}: ${exp.company || 'Company'}`;
        }
        return 'Unknown experience';
      });

      console.log('Generating HR question with emotion:', emotionScore);
      console.log('Resume data:', resumeData);
      console.log('Achievements count:', achievements.length);
      console.log('Achievement strings:', achievementStrings);
      console.log('Experience count:', experience.length);
      console.log('Experience strings:', experienceStrings);
      console.log('Full API request will be:', {
        emotion: emotionScore,
        last_answer: '',
        achievements: achievementStrings,
        experiences: experienceStrings,
        round: 'hr'
      });

      let question: string;
      let questionGenerated = false;

      // ── PRIMARY: Backend API ───────────────────────────────────────────
      try {
        console.log('[HRRound] Attempting to call backend API for HR round...');
        const response = await apiService.getHRQuestion({
          emotion: emotionScore,
          last_answer: '', // Start with empty string for first question
          achievements: achievementStrings,
          experiences: experienceStrings,
          round: 'hr',
        }, conversationId);
        question = response.question;
        questionGenerated = true;
        console.log('[HRRound] Backend API success, question:', question);
      } catch (apiError) {
        console.error('[HRRound] Backend API failed, trying local OpenAI service:', apiError);
        // ── SECONDARY: Gemini (Local) ──────────────────────────────────────────
        try {
          const questionContext: QuestionContext = {
            round: 'hr',
            previousQuestions: [],
            userExpression: userExpression,
            resumeData: resumeData
          };
          question = await openAI.generateQuestion(questionContext);
          questionGenerated = true;
          console.log('[HRRound] Gemini fallback success, question:', question);
        } catch (fallbackError) {
          console.error('[HRRound] Both API and Gemini failed:', fallbackError);
          // ── LAST RESORT ─────────────────────────────────────────────────────
          question = "Tell me about a time when you had to work under pressure.";
          questionGenerated = true;
        }
      }

      if (!questionGenerated) {
        throw new Error('Failed to generate question');
      }

      // Generate unique question ID
      const questionId = `hr_${Date.now()}`;
      setCurrentQuestionId(questionId);

      // Add question to messages
      const questionMessage: Message = {
        id: questionId,
        text: question,
        sender: 'ai',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, questionMessage]);
      setPreviousQuestions(prev => [...prev, question]);

      // Start capturing expression for this question
      console.log('[HRRound] Starting emotion capture for questionId:', questionId);
      setIsCapturingExpression(true);

      // Capture expression after a short delay to let the question sink in
      setTimeout(() => {
        console.log('[HRRound] Triggering captureFrame after timeout');
        captureFrame(questionId);
      }, 2000);

      // Speak the question
      try {
        setIsAvatarSpeaking(true);
        await azureTTS.speak(question, 'hr');
        setIsAvatarSpeaking(false);
      } catch (ttsError) {
        console.warn('TTS failed, continuing without audio:', ttsError);
        setIsAvatarSpeaking(false);
      }

    } catch (error) {
      console.error('Error starting round:', error);
      setError('Failed to start round - please try again');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle user response
  const handleUserResponse = async (transcription: string) => {
    let safeText = (typeof transcription === 'string') ? transcription.trim() : '';
    if (!safeText || safeText.toLowerCase() === 'undefined' || safeText.toLowerCase() === 'null') {
      safeText = '[no answer]';
    }

    try {
      // Add user message
      const userMessage: Message = {
        id: Date.now().toString(),
        text: safeText,
        sender: 'user',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, userMessage]);

      // Capture emotion when user responds
      console.log('[HRRound] User responded, capturing emotion...');
      setIsCapturingExpression(true);
      setTimeout(() => {
        console.log('[HRRound] Triggering captureFrame for user response with questionId:', currentQuestionId);
        captureFrame(currentQuestionId); // Use stored question ID
      }, 1000);

      // Generate follow-up question using API with fallback
      const emotionScore = userExpression ?
        `${userExpression.dominantEmotion} (confidence: ${userExpression.confidenceScore})` :
        'neutral (confidence: 0.5)';

      const achievements = resumeData?.achievements || [];
      const experience = resumeData?.experience || [];

      // Convert achievement and experience objects to strings for the API
      const achievementStrings = achievements.map(achievement => {
        if (typeof achievement === 'string') {
          return achievement;
        } else if (typeof achievement === 'object' && achievement !== null) {
          return achievement.description || achievement.name || 'Achievement';
        }
        return 'Unknown achievement';
      });

      const experienceStrings = experience.map(exp => {
        if (typeof exp === 'string') {
          return exp;
        } else if (typeof exp === 'object' && exp !== null) {
          return `${exp.title || 'Role'}: ${exp.company || 'Company'}`;
        }
        return 'Unknown experience';
      });

      let nextQuestion: string;
      try {
        console.log('[HRRound] Calling backend API for HR follow-up...');
        const response = await apiService.getHRQuestion({
          emotion: emotionScore,
          last_answer: safeText,
          achievements: achievementStrings,
          experiences: experienceStrings,
          round: 'hr',
        }, conversationId);
        nextQuestion = response.question;
        console.log('[HRRound] Backend API success, follow-up question:', nextQuestion);
      } catch (apiError) {
        console.warn('Backend API failed for follow-up, using local OpenAI service:', apiError);
        try {
          const questionContext: QuestionContext = {
            round: 'hr',
            previousQuestions: previousQuestions,
            userExpression: userExpression,
            resumeData: resumeData,
            lastAnswer: safeText
          };
          nextQuestion = await openAI.generateFollowUpQuestion(questionContext, safeText);
          console.log('[HRRound] Gemini fallback success, question:', nextQuestion);
        } catch (geminiError) {
          console.error('[HRRound] Both API and Gemini failed for follow-up:', geminiError);
          // ── LAST RESORT ───────────────────────────────────────────────────
          nextQuestion = "Interesting. Can you tell me more about how you handle constructive feedback from your peers?";
        }
      }
      // Add AI response to messages
      const aiMessage: Message = {
        id: Date.now().toString(),
        text: nextQuestion,
        sender: 'ai',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, aiMessage]);
      setPreviousQuestions(prev => [...prev, nextQuestion]);

      // Speak the response via Sarvam TTS
      await azureTTS.speak(nextQuestion, 'hr');

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
      mediaRecorderRef.current = mediaRecorder;

      const audioChunks: Blob[] = [];
      mediaRecorder.ondataavailable = (event) => {
        audioChunks.push(event.data);
      };

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

  // Stop recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  // Start camera
  const startCamera = async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: 640,
          height: 480,
          facingMode: 'user'
        }
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setIsCameraOn(true);
        console.log('Camera started successfully');

        // Start emotion analysis after camera is ready
        setTimeout(() => {
          setIsCapturingExpression(true);
          console.log('Starting emotion analysis');
          captureFrame();
        }, 1000);
      }
    } catch (error) {
      console.error('Error starting camera:', error);
      if (error instanceof Error) {
        if (error.name === 'NotAllowedError') {
          setError('Camera access denied. Please allow camera access and try again.');
        } else if (error.name === 'NotFoundError') {
          setError('No camera found. Please connect a camera and try again.');
        } else {
          setError('Failed to start camera. Please try again.');
        }
      }
    }
  };

  // Stop camera
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

  // Capture frame for emotion analysis (only when question is asked)
  const captureFrame = async (questionId?: string) => {
    const targetQuestionId = questionId || currentQuestionId;
    console.log('[HRRound] captureFrame called with questionId:', questionId, 'resolved as:', targetQuestionId);
    console.log('[HRRound] Conditions check:', {
      videoRef: !!videoRef.current,
      canvasRef: !!canvasRef.current,
      isCameraOn,
      isCapturingExpression
    });

    if (!videoRef.current || !canvasRef.current || !isCameraOn || !isCapturingExpression) {
      console.log('[HRRound] captureFrame skipped due to conditions');
      return;
    }

    const canvas = canvasRef.current;
    const video = videoRef.current;
    const ctx = canvas.getContext('2d');

    if (!ctx || video.videoWidth === 0 || video.videoHeight === 0) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);

    // Convert to blob like in TechnicalRound
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.8);
    });

    if (!blob) return;
    console.log('[HRRound] Image captured, size:', blob.size, "bytes");

    try {
      // setIsAnalyzing(true);
      console.log("Starting facial analysis...");

      // Create a File object from the blob
      const file = new File([blob], "frame.jpg", { type: "image/jpeg" });

      // Start inference job
      console.log("Starting inference job...");
      const formData = new FormData();
      formData.append('file', file);
      formData.append('json', JSON.stringify({
        models: { face: {} }
      }));

      console.log('Using Hume API Key:', humeApiKey ? 'Key present' : 'No key');

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
      const maxAttempts = 30;

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
          console.log("Job completed, waiting before fetching predictions...");
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
              console.log("Processing predictions structure...");

              if (predictions[0].results?.predictions &&
                Array.isArray(predictions[0].results.predictions) &&
                predictions[0].results.predictions.length > 0) {

                const filePrediction = predictions[0].results.predictions[0];
                console.log("File prediction:", filePrediction);

                if (filePrediction.models?.face?.grouped_predictions &&
                  filePrediction.models.face.grouped_predictions.length > 0 &&
                  filePrediction.models.face.grouped_predictions[0].predictions &&
                  filePrediction.models.face.grouped_predictions[0].predictions.length > 0) {

                  const emotions = filePrediction.models.face.grouped_predictions[0].predictions[0].emotions;

                  if (emotions && emotions.length > 0) {
                    console.log("Emotions found:", emotions.length, "emotions");

                    const dominantEmotion = emotions.reduce((max: any, emotion: any) =>
                      emotion.score > max.score ? emotion : max
                    );

                    const expression = {
                      isConfident: dominantEmotion.name === 'Confidence' || dominantEmotion.score > 0.6,
                      isNervous: dominantEmotion.name === 'Doubt' || dominantEmotion.name === 'Frustration' || dominantEmotion.score < 0.4,
                      isStruggling: dominantEmotion.name === 'Confusion' || dominantEmotion.name === 'Frustration' || dominantEmotion.score < 0.3,
                      dominantEmotion: dominantEmotion.name,
                      confidenceScore: Math.round(dominantEmotion.score * 100) / 100,
                      emotionBreakdown: emotions
                    };

                    setUserExpression(expression);
                    setCurrentEmotions(emotions);
                    localStorage.setItem('currentEmotions', JSON.stringify(emotions));

                    console.log('✅ Real Hume AI data received:', expression.dominantEmotion, expression.confidenceScore);

                    if (targetQuestionId) {
                      console.log('[HRRound] Setting question expression for questionId:', targetQuestionId, expression);
                      setQuestionExpressions(prev => {
                        const newMap = new Map(prev);
                        newMap.set(targetQuestionId, expression);
                        console.log('[HRRound] Updated questionExpressions map size:', newMap.size);
                        return newMap;
                      });
                    } else {
                      console.log('[HRRound] No questionId provided, not storing expression');
                    }

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
              console.log("Waiting before retrying predictions...");
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
          }

          if (!predictionsFound) {
            console.log("Failed to get valid predictions after multiple attempts");
            const fallbackExpression = {
              isConfident: false,
              isNervous: true,
              isStruggling: false,
              dominantEmotion: 'Neutral',
              confidenceScore: 0.5,
              emotionBreakdown: []
            };
            setUserExpression(fallbackExpression);
            console.log('⚠️ Using fallback emotion data (no real face detected)');
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

    } catch (error: any) {
      console.error('[HRRound] Error analyzing emotions:', error);
      const fallbackExpression = {
        isConfident: false,
        isNervous: true,
        isStruggling: false,
        dominantEmotion: 'Neutral',
        confidenceScore: 0.5,
        emotionBreakdown: []
      };
      setUserExpression(fallbackExpression);
      console.log('⚠️ Using fallback emotion data due to error');
    } finally {
      // setIsAnalyzing(false);
    }
  };

  // Start/stop emotion analysis (only when capturing)
  useEffect(() => {
    if (isCameraOn && isCapturingExpression) {
      console.log('[HRRound] Starting emotion capture...');
      const timeout = setTimeout(() => {
        console.log('[HRRound] Capturing emotion now...');
        captureFrame();
        setIsCapturingExpression(false); // Stop capturing after one capture
        console.log('[HRRound] Emotion capture completed, stopping...');
      }, 2000); // Wait 2 seconds for user to see/hear the question
      captureIntervalRef.current = timeout;
    } else {
      if (captureIntervalRef.current) {
        console.log('[HRRound] Clearing emotion capture timeout...');
        clearTimeout(captureIntervalRef.current);
        captureIntervalRef.current = null;
      }
    }

    return () => {
      if (captureIntervalRef.current) {
        clearTimeout(captureIntervalRef.current);
      }
    };
  }, [isCameraOn, isCapturingExpression]);

  // Generate detailed interview summary
  const generateInterviewSummary = async () => {
    try {
      setIsLoading(true);

      const technicalHistory = { messages: location.state?.technicalMessages || [] };
      const projectHistory = { messages: location.state?.coreMessages || [] };
      const hrHistory = { messages: messages };

      const summary = await apiService.generateInterviewSummary(
        technicalHistory,
        projectHistory,
        hrHistory,
        resumeData,
        questionExpressions
      );

      // Navigate to NERV summary page with all data
      navigate('/nerv-summary', {
        state: {
          summary: summary,
          messages: [
            ...(location.state?.technicalMessages || []),
            ...(location.state?.coreMessages || []),
            ...messages
          ],
          questionExpressions: Array.from(questionExpressions.entries()),
          technicalQuestionExpressions: location.state?.technicalQuestionExpressions || [],
          coreQuestionExpressions: location.state?.coreQuestionExpressions || [],
          hrQuestionExpressions: Array.from(questionExpressions.entries()),
          resumeData,
          roundDuration
        }
      });
    } catch (error) {
      console.error('Error generating summary:', error);
      // Fallback
      navigate('/nerv-summary', {
        state: {
          summary: "# Interview Completed\n\nFailed to generate detailed summary.",
          messages: [
            ...(location.state?.technicalMessages || []),
            ...(location.state?.coreMessages || []),
            ...messages
          ],
          resumeData,
          roundDuration
        }
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Format time helper
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
            <h1 className="text-3xl font-bold">HR Round - Behavioral Interview</h1>
          </div>

          <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-8">
            <h2 className="text-2xl font-semibold mb-6">HR Round Setup</h2>

            <div className="space-y-6">
              <div className="bg-purple-500/20 border border-purple-500/30 rounded-lg p-4">
                <h3 className="text-lg font-semibold mb-2">Round Details</h3>
                <p className="text-gray-300">
                  This round focuses on behavioral questions and soft skills. The interviewer will ask about
                  your achievements, leadership experiences, and how you handle various workplace situations.
                </p>
                <p className="text-sm text-gray-400 mt-2">
                  Duration: {roundDuration} minutes
                </p>
              </div>

              {resumeData && (
                <div className="bg-blue-500/20 border border-blue-500/30 rounded-lg p-4">
                  <h3 className="text-lg font-semibold mb-2">Your Achievements</h3>
                  <div className="space-y-1">
                    {resumeData.achievements.map((achievement, index) => (
                      <div key={index} className="text-sm text-gray-300">
                        • {typeof achievement === 'string' ? achievement : JSON.stringify(achievement)}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={startInterview}
                className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-4 px-6 rounded-lg transition-colors"
              >
                Start HR Round
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isInterviewComplete) {
    return (
      <div className="min-h-screen bg-primary text-white p-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center">
            <h1 className="text-3xl font-bold mb-4">HR Round Complete!</h1>
            <p className="text-xl text-gray-300 mb-8">
              Congratulations! You've completed all three rounds of the interview.
            </p>

            <div className="space-y-4">
              <button
                onClick={generateInterviewSummary}
                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors mr-4"
              >
                Generate Complete Summary
              </button>

              <button
                onClick={() => navigate('/dashboard')}
                className="bg-gray-600 hover:bg-gray-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
              >
                Back to Dashboard
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
            <div className="p-2 bg-purple-500/20 rounded-lg border border-purple-500/30">
              <Users className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <div className="flex items-center space-x-3">
                <h1 className="text-base font-semibold leading-tight">HR Round</h1>
                <span className="flex items-center space-x-1.5 bg-green-500/10 border border-green-500/20 rounded px-2 py-0.5 text-[10px] uppercase tracking-wider text-green-400 font-medium">
                  {/* <Shield className="h-3 w-3" /> */}
                  <span>Proctoring Active</span>
                </span>
              </div>
              <p className="text-xs text-gray-400">Behavioral & Soft Skills</p>
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
                className={`flex items-center space-x-2 px-6 py-4 text-sm font-medium transition-colors border-b-2 border-purple-500 text-purple-400 bg-purple-500/5`}
              >
                <Users className="h-4 w-4" />
                <span>Interview Chat</span>
                {isLoading && (
                  <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse ml-2" />
                )}
              </div>
            </div>

            {/* Panel Body */}
            <div className="flex-1 overflow-hidden relative flex flex-col">
              {/* Scrollable Messages */}
              <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
                {messages.length === 0 && !isLoading && (
                  <div className="h-full flex flex-col items-center justify-center text-gray-500">
                    <Users className="h-12 w-12 mb-4 opacity-20" />
                    <p>Your HR interview connects shortly...</p>
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
                          ? 'bg-purple-600 text-white rounded-br-sm'
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
                        <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                      <span className="text-sm text-gray-400 font-medium">HR AI is typing...</span>
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
                        className="flex items-center space-x-2 px-4 py-2 bg-white/10 hover:bg-purple-500/20 border border-white/10 hover:border-purple-500/40 rounded-xl text-sm transition-all disabled:opacity-50"
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
                    className="flex-1 px-5 py-3 bg-white/5 border border-white/15 rounded-xl text-white text-[15px] placeholder-gray-500 focus:outline-none focus:border-purple-500/60 focus:bg-white/10 transition-all disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={isRecording || !chatInput.trim() || isLoading}
                    className="px-6 py-3 bg-purple-600 hover:bg-purple-500 disabled:bg-white/10 disabled:text-gray-500 text-white text-[15px] rounded-xl transition-all font-medium flex items-center shadow-lg shadow-purple-500/20"
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
                  <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
                  <h3 className="text-sm font-medium text-gray-200">HR AI</h3>
                </div>
                {isLoading && (
                  <span className="text-[10px] uppercase tracking-wider text-purple-400 border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 rounded">Analyzing</span>
                )}
              </div>
              <div className="flex-1 relative bg-black/40 min-h-[200px]">
                <InterviewerAvatar 
                  isAvatarSpeaking={isAvatarSpeaking}
                  isUserSpeaking={isUserSpeaking}
                  accentColor="purple" 
                />
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
            <div className="absolute -top-32 -right-32 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />

            <div className="text-center mb-8 relative z-10">
              <div className="w-16 h-16 bg-purple-500/20 border border-purple-500/30 rounded-full flex items-center justify-center mx-auto mb-4">
                <Users className="h-8 w-8 text-purple-400" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">HR Round Complete</h2>
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
                        summary: 'HR Round completed successfully',
                        messages,
                        questionExpressions: Array.from(questionExpressions.entries()),
                        resumeData,
                        roundDuration,
                        conversationId,
                        roundType: 'hr'
                      }
                    });
                  }}
                  className="px-5 py-2.5 bg-white/10 hover:bg-white/20 border border-white/20 shadow-lg shadow-black/50 text-white rounded-lg transition-all text-sm font-medium"
                >
                  View Report
                </button>
                <button
                  onClick={generateInterviewSummary}
                  className="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white rounded-lg transition-all text-sm font-medium shadow-lg shadow-purple-500/20 block w-full"
                >
                  Generate Complete Summary →
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default HRRound;
