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
  }
];

// Update the speakResponse function to handle sequential TTS
const speakResponse = async (text: string) => {
  try {
    // Get the Azure TTS API key from environment variables
    const ttsApiKey = import.meta.env.VITE_APP_AZURE_TTS_API_KEY || '';
    const endpoint = "https://kusha-m8t3pks8-swedencentral.cognitiveservices.azure.com";
    const deploymentName = "tts";
    
    console.log("Converting text to speech...");
    
    // Ensure we have text to convert
    if (!text || text.trim() === '') {
      console.error("Empty text provided for TTS");
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
        resolve();
      };
      audio.play().catch(error => {
        console.error("Error playing audio:", error);
        resolve();
      });
    });
  } catch (error) {
    console.error("Error in speakResponse:", error);
    return Promise.resolve();
  }
};

const Interview = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState(0);
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
  const [viewMode, setViewMode] = useState<'camera' | 'chat'>('camera');
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
  const [currentEmotions, setCurrentEmotions] = useState<any[]>([]);
  const [interviewIntroduction, setInterviewIntroduction] = useState<string>(
    "Hello! I'm your NERV interviewer today. Let's begin our technical interview."
  );
  const [conversationHistory, setConversationHistory] = useState<{ role: string; content: string }[]>([
    { role: "system", content: "You are NERV, an AI technical interviewer conducting a job interview." }
  ]);
  const [followUpCount, setFollowUpCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);

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

  useEffect(() => {
    const fetchUserDetailsAndStartInterview = async () => {
      if (!currentUser) {
        navigate('/login');
        return;
      }
      
      // Set loading state to true at the beginning
      setIsLoading(true);
      
      try {
        // Get user document from Firestore
        const userDocRef = doc(db, 'users', currentUser.uid);
        const userDoc = await getDoc(userDocRef);
        
        if (!userDoc.exists()) {
          console.log('User document not found');
          return;
        }
        
        const userData = userDoc.data();
        let resumeText = "No resume available.";
        
        // Try to get resume content if available
        if (userData.resumeURL) {
          try {
            // Fetch the resume content
            const response = await fetch(userData.resumeURL);
            if (!response.ok) {
              throw new Error(`Failed to fetch resume: ${response.status}`);
            }
            
            const blob: Blob = await response.blob();
            
            // Check if blob is valid before processing
            if (blob && blob.size > 0) {
              try {
                resumeText = await extractTextFromPDF(blob);
                console.log("Successfully extracted resume text");
              } catch (pdfError) {
                console.error('Error extracting text from PDF:', pdfError);
                resumeText = "Unable to extract text from resume. Proceeding with general interview.";
              }
            } else {
              console.error('Invalid blob received from resume URL');
              resumeText = "Resume file appears to be empty or invalid. Proceeding with general interview.";
            }
          } catch (error) {
            console.error('Error fetching resume:', error);
            resumeText = "Unable to access resume. Proceeding with general interview.";
          }
        } else {
          console.log('No resume URL available');
          resumeText = "No resume provided. Proceeding with general interview.";
        }
        
        console.log("Resume text length:", resumeText.length);
        
        // Initialize the interview with resume data
        const generatedQuestions = await initializeInterview(resumeText);
        
        // Set the questions
        setQuestions(generatedQuestions.map((text, index) => ({
          id: index + 1,
          text,
          isAsked: index === 0 // Only mark the first question as asked initially
        })));
        
        // Create a more personalized introduction
        const personalizedIntro = `Hello! I'm your NERV technical interviewer today. Please introduce yourself briefly, and then we'll discuss your experience and skills.`;
        
        // Start the interview with AI speaking the introduction
        setInterviewState('ai-speaking');
        setIsSpeaking(true);
        
        // Generate unique IDs for messages
        const introId = Date.now().toString();
        
        // Add initial AI message - just the introduction
        const initialMessages = [
          {
            id: introId,
            text: personalizedIntro,
            sender: 'ai' as const,
            timestamp: new Date()
          }
        ];
        
        setMessages(initialMessages);
        
        // Update conversation history for context
        setConversationHistory(prev => [
          ...prev,
          { role: "assistant", content: personalizedIntro }
        ]);
        
        // Turn off loading state before speaking
        setIsLoading(false);
        
        // Speak the introduction
        await speakResponse(personalizedIntro);
        
        // After introduction, set the interview state to idle to let user respond
        setIsSpeaking(false);
        setInterviewState('idle');
        setIsUserTurn(true);
        
      } catch (error) {
        console.error('Error starting interview:', error);
        
        // Even on error, we should turn off loading and show something
        setIsLoading(false);
        
        // Minimal fallback with just an introduction
        const defaultIntro = "Hello! I'm your NERV interviewer today. Please introduce yourself, and we'll begin our technical interview.";
        
        setMessages([
          {
            id: '1',
            text: defaultIntro,
            sender: 'ai',
            timestamp: new Date()
          }
        ]);
        
        // Update conversation history
        setConversationHistory(prev => [
          ...prev,
          { role: "assistant", content: defaultIntro }
        ]);
        
        // Speak the introduction
        setIsSpeaking(true);
        setInterviewState('ai-speaking');
        
        speakResponse(defaultIntro).then(() => {
          setIsSpeaking(false);
          setInterviewState('idle');
          setIsUserTurn(true);
        });
      }
    };

    fetchUserDetailsAndStartInterview();
  }, [currentUser, navigate]);

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
      
      // Set up interval to capture emotions during recording
      let emotionCaptureInterval: NodeJS.Timeout | null = null;
      
      if (isCameraOn && videoRef.current) {
        // Capture emotions every 3 seconds during recording
        emotionCaptureInterval = setInterval(() => {
          captureAndAnalyzeFrame();
        }, 3000);
      }
      
      recorder.onstop = async () => {
        // Clear the emotion capture interval
        if (emotionCaptureInterval) {
          clearInterval(emotionCaptureInterval);
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
          
          console.log("Sending transcription request to Azure Whisper API...");
          
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
          console.log("Transcription result:", result);
          
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
              
              // Only generate the next question if this was the last question in the current topic
              // Changed from checking for questions.length - 1 to checking for 1 (2 questions total)
              if (currentQuestion >= 1) {
                // Interview complete
                const completionMessage = "That concludes our interview. Thank you for your responses! I'll now generate your detailed feedback report.";
                
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
                  navigate('/results');
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
      startRecording();
    } else {
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
      console.log("Starting facial analysis...");
      
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
      console.log("Image captured, size:", blob.size, "bytes");
      
      // Create a File object from the blob
      const file = new File([blob], "frame.jpg", { type: "image/jpeg" });
      
      // Start inference job
      console.log("Starting inference job...");
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
          console.log("Job completed, waiting before fetching predictions...");
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
              console.log("Processing predictions structure...");
              
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
                    setCurrentEmotions(emotions); // Store the current emotions
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
        
        // Start the analysis interval (every 5 seconds)
        const interval = setInterval(() => {
          captureAndAnalyzeFrame();
        }, 5000);
        
        setCaptureInterval(interval);
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

  const handleSendMessage = async () => {
    if (!userInput.trim() || isThinking || isSpeaking) return;
    
    // Add user message
    const userMessage: Message = {
      id: Date.now().toString() + '-user',
      text: userInput,
      sender: 'user',
      timestamp: new Date()
    };
    
    setMessages(prev => [...prev, userMessage]);
    
    // Update conversation history with user's message
    setConversationHistory(prev => [
      ...prev,
      { role: "user", content: userInput }
    ]);
    
    // Check if user wants to move to next question
    const userWantsNextQuestion = shouldMoveToNextQuestion(userInput);
    
    setUserInput('');
    setIsThinking(true);
    setInterviewState('ai-thinking');
    setIsUserTurn(false);
    
    try {
      // If user wants to move to next question and we're not at the last question
      if (userWantsNextQuestion && currentQuestion < questions.length - 1) {
        const nextQuestionIndex = currentQuestion + 1;
        setCurrentQuestion(nextQuestionIndex);
        setFollowUpCount(0);
        
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
      const feedback = await processUserAnswer(userInput);
      
      // Short delay before AI response
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      setIsThinking(false);
      setIsSpeaking(true);
      setInterviewState('ai-speaking');
      
      // Add feedback message
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
      
      // Speak the feedback first
      await speakResponse(feedback);
      
      // If AI wants to move to next question and we're not at the last question
      if (aiWantsNextQuestion && currentQuestion < questions.length - 1) {
        const nextQuestionIndex = currentQuestion + 1;
        setCurrentQuestion(nextQuestionIndex);
        setFollowUpCount(0);
        
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
      
      // If not moving to next question, generate a follow-up or next question
      const nextQuestion = await generateNextQuestion();
      
      // Add question message
      const questionMessage: Message = {
        id: Date.now().toString() + '-question',
        text: nextQuestion,
        sender: 'ai',
        timestamp: new Date()
      };
      
      setMessages(prev => [...prev, questionMessage]);
      
      // Update conversation history with the new question
      setConversationHistory(prev => [
        ...prev,
        { role: "assistant", content: nextQuestion }
      ]);
      
      // Check if this new question indicates moving to next topic
      if (shouldMoveToNextQuestion(nextQuestion) && currentQuestion < questions.length - 1) {
        // Update to next question in the list
        const nextQuestionIndex = currentQuestion + 1;
        setCurrentQuestion(nextQuestionIndex);
        setFollowUpCount(0);
        
        // Mark the next question as asked
        setQuestions(prevQuestions => 
          prevQuestions.map((q, idx) => 
            idx === nextQuestionIndex ? { ...q, isAsked: true } : q
          )
        );
        
        // Add the actual next question
        const nextQuestionText = questions[nextQuestionIndex].text;
        const actualQuestionMsg: Message = {
          id: Date.now().toString() + '-actual-question',
          text: nextQuestionText,
          sender: 'ai',
          timestamp: new Date()
        };
        
        setMessages(prev => [...prev, actualQuestionMsg]);
        
        // Update conversation history with the actual next question
        setConversationHistory(prev => [
          ...prev,
          { role: "assistant", content: nextQuestionText }
        ]);
        
        // Speak the next question
        await speakResponse(nextQuestionText);
      } else {
        // Speak the follow-up question
        await speakResponse(nextQuestion);
      }
      
      // After both messages are spoken, set the interview state back to idle
      setInterviewState('idle');
      setIsUserTurn(true);
      
      // Check if we've asked enough questions (changed from 10 to 2 for testing)
      if (questions.length >= 2 && currentQuestion >= questions.length - 1) {
        // Interview complete
        const completionMessage = "That concludes our interview. Thank you for your responses! I'll now generate your detailed feedback report.";
        
        // Add completion message
        const completionMsg: Message = {
          id: Date.now().toString() + '-complete',
          text: completionMessage,
          sender: 'ai',
          timestamp: new Date()
        };
        
        setMessages(prev => [...prev, completionMsg]);
        
        // Update conversation history
        setConversationHistory(prev => [
          ...prev,
          { role: "assistant", content: completionMessage }
        ]);
        
        // Speak the completion message
        await speakResponse(completionMessage);
        
        // After speaking, navigate to results
        setInterviewState('idle');
        
        // Navigate to results after a delay
        setTimeout(() => {
          navigate('/results');
        }, 1000);
      }
    } catch (error) {
      console.error('Error processing message:', error);
      setIsThinking(false);
      setInterviewState('idle');
      setIsUserTurn(true);
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

  const progress = ((currentQuestion + 1) / questions.length) * 100;

  // Determine if recording button should be disabled
  const isRecordingDisabled = interviewState === 'ai-speaking' || interviewState === 'ai-thinking';
  
  // Determine if send button should be disabled
  const isSendDisabled = !userInput.trim() || isThinking || isSpeaking;

  // Update the processUserAnswer function to handle the introduction specially
  const processUserAnswer = async (answer: string): Promise<string> => {
    try {
      // Get the Azure OpenAI API key from environment variables
      const azureOpenAIKey = import.meta.env.VITE_APP_AZURE_OPENAI_API_KEY;
      
      // Check if this is the first response (introduction)
      const isIntroduction = messages.length <= 1;
      
      // If this is the introduction, use a special prompt
      const prompt = isIntroduction 
        ? `
          The candidate has just introduced themselves: "${answer}"
          
          Acknowledge their introduction briefly (1 sentence) and then ask the first technical question.
          Be professional and direct. Don't provide any feedback on their introduction.
          `
        : `
          You are an AI technical interviewer conducting a serious job interview.
          
          Candidate's answer: "${answer}"
          
          Provide a very brief response (1 sentence maximum) that:
          1. Acknowledges their answer without detailed feedback
          2. Is professional and direct
          3. Only corrects them if they're technically incorrect
          
          Your response should mimic a serious technical interviewer who is evaluating their knowledge.
          Avoid generic phrases and focus on technical accuracy.
          `;
      
      // Create messages array that includes recent conversation history for context
      const recentMessages = conversationHistory.slice(-4); // Last 4 messages for context
      const messagesForAPI = [
        { 
          role: "system", 
          content: "You are an AI technical interviewer conducting a serious job interview. Be concise, professional, and technically focused." 
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
            max_tokens: isIntroduction ? 150 : 60
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
      return "I see. Let's continue.";
    }
  };

  // Update the initializeInterview function to generate fewer questions
  const initializeInterview = async (resumeText: string): Promise<string[]> => {
    try {
      // Get the Azure OpenAI API key from environment variables
      const azureOpenAIKey = import.meta.env.VITE_APP_AZURE_OPENAI_API_KEY;
      
      // Create a system prompt that focuses on serious technical questions
      // Modified to request only 2 questions for testing
      const systemPrompt = `
        You are an AI technical interviewer conducting a professional job interview.
        
        IMPORTANT: The interview will start with you asking the candidate to introduce themselves.
        Wait for their introduction before asking technical questions.
        
        Based on the candidate's resume below, generate 2 challenging technical interview questions.
        Include a mix of:
        - Technical knowledge questions specific to their skills/experience
        - Algorithmic problems with time/space complexity considerations
        
        Make questions industry-level, challenging, and specific - not generic.
        Focus on fundamentals (Big-O, data structures) and applied problems.
        
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
              { role: "user", content: "Generate challenging technical interview questions based on this resume." }
            ],
            temperature: 0.7,
            max_tokens: 1000
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
      return getMockQuestions().slice(0, 2); // Return only 2 mock questions
    }
  };

  // Helper function to get default questions if API fails
  const getMockQuestions = (): string[] => {
    return mockQuestions.map(q => q.text).slice(0, 2); // Return only 2 mock questions
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
  const storeAnswerWithEmotions = (question: string, answer: string, emotions: any[] = []) => {
    // Get existing data or initialize new array
    const existingData = localStorage.getItem('interviewData') || '[]';
    let interviewData = [];
    
    try {
      interviewData = JSON.parse(existingData);
    } catch (e) {
      console.error("Error parsing interview data:", e);
      interviewData = [];
    }
    
    // Add new entry
    interviewData.push({
      question,
      answer,
      emotions,
      timestamp: new Date().toISOString()
    });
    
    // Store updated data
    localStorage.setItem('interviewData', JSON.stringify(interviewData));
    
    console.log("Stored answer with emotions:", { question, answer, emotions: emotions.length });
  };

  // Update the generateNextQuestion function to potentially include transition phrases
  const generateNextQuestion = async (): Promise<string> => {
    try {
      // Get the Azure OpenAI API key from environment variables
      const azureOpenAIKey = import.meta.env.VITE_APP_AZURE_OPENAI_API_KEY;
      
      // Increment follow-up counter
      const newFollowUpCount = followUpCount + 1;
      setFollowUpCount(newFollowUpCount);
      
      // If we've asked enough follow-ups, move to the next main question
      const shouldMoveToNextMainQuestion = newFollowUpCount >= 2 || Math.random() < 0.4;
      
      let prompt;
      
      if (shouldMoveToNextMainQuestion && currentQuestion < questions.length - 1) {
        // We want to move to the next main question
        // Instead of generating a transition phrase with the next question,
        // just return a simple transition phrase
        return "Let's move on to the next question.";
      } else {
        // Generate a follow-up to the current question
        prompt = `
          You are an AI technical interviewer.
          
          Based on the conversation so far, generate a follow-up question related to the current topic.
          
          Make your question specific, technical, and challenging. Keep it concise (1-2 sentences).
          
          If the candidate seems to have fully addressed the topic, include a phrase like "let's move on to the next question".
        `;
      }
      
      // Create messages array that includes recent conversation history for context
      const recentMessages = conversationHistory.slice(-6);
      const messagesForAPI = [
        { 
          role: "system", 
          content: "You are an AI technical interviewer. Keep responses concise and focused." 
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
            max_tokens: 150
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
    } catch (error) {
      console.error("Error generating next question:", error);
      
      // Fallback to a simple follow-up or next question
      if (currentQuestion < questions.length - 1 && Math.random() < 0.5) {
        return "Let's move on to the next question.";
      } else {
        return "Could you elaborate more on that point?";
      }
    }
  };

  // Update the generateInterviewSummary function to store emotions with questions
  const generateInterviewSummary = async (): Promise<string> => {
    try {
      // Get the Azure OpenAI API key from environment variables
      const azureOpenAIKey = import.meta.env.VITE_APP_AZURE_OPENAI_API_KEY;
      
      // Get stored interview data with emotions
      const interviewData = JSON.parse(localStorage.getItem('interviewData') || '[]');
      
      // Store the full interview results for the results page
      const interviewResults = {
        summary: "", // Will be filled in below
        emotionsData: interviewData,
        transcriptions: interviewData.map((item: any) => item.answer),
        timestamp: new Date().toISOString()
      };
      
      // Create a prompt for generating the summary
      const prompt = `
        You are an AI technical interviewer who has just completed an interview with a candidate.
        
        Based on the conversation history, generate a comprehensive interview summary that includes:
        
        1. An overall assessment of the candidate's technical skills and knowledge
        2. Strengths demonstrated during the interview
        3. Areas for improvement
        4. Specific technical competencies evaluated
        5. Recommendations for next steps
        
        Format the summary in markdown with clear sections and bullet points where appropriate.
        Be honest but constructive in your feedback.
      `;
      
      // Create messages array from conversation history
      const messagesForAPI = [
        { 
          role: "system", 
          content: "You are an AI technical interviewer generating a comprehensive interview summary." 
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
            max_tokens: 1000
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

  // Modify your handleEndInterview function to increment the interview count
  const handleEndInterview = async () => {
    setIsThinking(true);
    
    try {
      // Get all stored interview data
      const interviewDataString = localStorage.getItem('interviewData') || '[]';
      let interviewData: EmotionItem[] = [];
      
      try {
        interviewData = JSON.parse(interviewDataString);
      } catch (e) {
        console.error("Error parsing interview data:", e);
      }
      
      // Get all user messages for transcriptions
      const transcriptions = messages
        .filter(msg => msg.sender === 'user')
        .map(msg => msg.text);
      
      // Create interview result object with unique ID
      const interviewId = Date.now().toString();
      const interviewResults = {
        id: interviewId,
        emotionsData: interviewData,
        transcriptions,
        timestamp: new Date().toISOString()
      };
      
      // Store current interview results
      localStorage.setItem('interviewResults', JSON.stringify(interviewResults));
      
      // Store in interview history
      const interviewHistory = JSON.parse(localStorage.getItem('interviewHistory') || '[]');
      interviewHistory.push(interviewResults);
      localStorage.setItem('interviewHistory', JSON.stringify(interviewHistory));
      
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
          
          console.log("Updated interview count in database");
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

        {/* Interview header - fixed */}
        <div className="bg-black/80 py-4 px-6 border-b border-white/20 sticky top-0 z-10 backdrop-blur-sm">
          <div className="max-w-6xl mx-auto flex justify-between items-center">
            <div>
              <h1 className="text-xl font-semibold">Technical Interview</h1>
              <p className="text-sm text-gray-400">Question {currentQuestion + 1} of {questions.length}</p>
            </div>
            <div className="flex items-center gap-4">
              <button
                onClick={toggleSpeech}
                className={`p-2 rounded-full ${
                  isSpeaking ? 'bg-white text-black' : 'bg-black/50 text-gray-400 border border-white/30'
                }`}
                disabled={isRecording || isThinking}
              >
                {isSpeaking ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
              </button>
              <div className="md:hidden">
                <button
                  onClick={() => setViewMode(viewMode === 'camera' ? 'chat' : 'camera')}
                  className="p-2 rounded-full bg-white text-black"
                >
                  {viewMode === 'camera' ? <MessageSquare className="h-5 w-5" /> : <Camera className="h-5 w-5" />}
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
            <div className="flex flex-col md:flex-row h-full gap-4">
              {/* AI Avatar Section */}
              <div className="md:w-1/4 md:h-full hidden md:block">
                <div className="bg-white/5 border border-white/20 rounded-xl h-full flex flex-col shadow-lg">
                  <div className="p-4 border-b border-white/20 bg-white/10 rounded-t-xl">
                    <h2 className="font-medium">NERV Interviewer</h2>
                  </div>
                  
                  <div className="flex-1 flex flex-col items-center justify-center p-6">
                    <div className="w-32 h-32 bg-gradient-to-br from-white/20 to-white/5 rounded-full flex items-center justify-center mb-6 border border-white/10">
                      <Bot className="h-16 w-16 text-white/80" />
                    </div>
                    
                    {isThinking ? (
                      <div className="text-center">
                        <div className="flex items-center justify-center gap-2 mb-3">
                          <div className="w-2 h-2 bg-white rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                          <div className="w-2 h-2 bg-white rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                          <div className="w-2 h-2 bg-white rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                        </div>
                        <p className="text-gray-400">Thinking...</p>
                      </div>
                    ) : isSpeaking ? (
                      <div className="relative">
                        <div className="absolute inset-0 bg-white/5 rounded-full animate-ping opacity-75"></div>
                        <div className="relative bg-white/10 p-3 rounded-full">
                          <Volume2 className="h-6 w-6 text-white" />
                        </div>
                        <p className="text-center mt-3 text-gray-400">Speaking...</p>
                      </div>
                    ) : (
                      <div className="text-center">
                        <p className="text-gray-400">
                          {isUserTurn ? "Waiting for your response..." : "Listening..."}
                        </p>
                      </div>
                    )}
                    
                    <div className="mt-8 space-y-3 w-full">
                      <div className="bg-white/5 p-3 rounded-lg">
                        <p className="text-xs text-gray-400 mb-1">Current Topic</p>
                        <p className="text-sm">{questions && questions[currentQuestion] ? questions[currentQuestion].text.length > 60 ? 
                          questions[currentQuestion].text.substring(0, 60) + '...' : 
                          questions[currentQuestion].text : "Loading question..."}
                        </p>
                      </div>
                      
                      <div className="bg-white/5 p-3 rounded-lg">
                        <p className="text-xs text-gray-400 mb-1">Interview Progress</p>
                        <div className="w-full bg-black/50 rounded-full h-2.5">
                          <div className="bg-white h-2.5 rounded-full" style={{ width: `${progress}%` }}></div>
                        </div>
                        <p className="text-xs text-right mt-1 text-gray-400">
                          {currentQuestion + 1} of {questions.length} questions
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* AI chat section - scrollable content */}
              <div className={`md:w-2/4 h-full md:block ${viewMode === 'camera' ? 'hidden' : 'block'}`}>
                <div className="bg-white/5 border border-white/20 rounded-xl h-full flex flex-col shadow-lg">
                  <div className="p-4 border-b border-white/20 flex-shrink-0 bg-white/10 rounded-t-xl">
                    <div className="flex items-center">
                      <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center mr-2">
                        <Bot className="h-4 w-4 text-white" />
                      </div>
                      <h2 className="font-medium">NERV Interviewer</h2>
                    </div>
                  </div>
                  
                  {/* This div is scrollable */}
                  <div className="flex-1 overflow-y-auto p-4 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                    <div className="space-y-6">
                      {messages.map((message, index) => (
                        <div
                          key={message.id}
                          className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'} mb-4`}
                          ref={index === messages.length - 1 ? lastMessageRef : null}
                        >
                          <div
                            className={`max-w-[80%] rounded-lg p-3 ${
                              message.sender === 'user'
                                ? 'bg-blue-600 text-white rounded-br-none'
                                : 'bg-white/10 text-white rounded-bl-none'
                            }`}
                          >
                            <div className="flex items-start">
                              <div className="flex-shrink-0 mr-2">
                                {message.sender === 'user' ? (
                                  <User className="h-5 w-5 text-white/70" />
                                ) : (
                                  <Bot className="h-5 w-5 text-white/70" />
                                )}
                              </div>
                              <div>
                                <p className="text-sm whitespace-pre-wrap">{message.text}</p>
                                <p className="text-xs text-white/50 mt-1">
                                  {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                      
                      {isThinking && (
                        <div className="flex justify-start">
                          <div className="bg-white/5 text-white rounded-2xl rounded-tl-none p-4 max-w-[80%]">
                            <div className="flex items-center mb-2">
                              <div className="w-6 h-6 rounded-full bg-white/5 flex items-center justify-center mr-2">
                                <Bot className="h-3 w-3" />
                              </div>
                              <span className="text-sm font-medium">NERV Interview chat</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                            </div>
                          </div>
                        </div>
                      )}
                      
                      {isRecording && (
                        <div className="flex justify-end">
                          <div className="bg-white/10 text-white rounded-2xl rounded-tr-none p-4 max-w-[80%]">
                            <div className="flex items-center mb-2">
                              <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center mr-2">
                                <User className="h-3 w-3" />
                              </div>
                              <span className="text-sm font-medium">You</span>
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
                        <div className="flex items-center justify-center gap-2 text-sm text-gray-400 mt-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>Transcribing...</span>
                        </div>
                      )}
                      
                      {isThinking && !isTranscribing && !isSpeaking && (
                        <div className="flex items-center justify-center gap-2 text-sm text-gray-400 mt-2">
                          <Brain className="h-4 w-4 animate-pulse" />
                          <span>Thinking...</span>
                        </div>
                      )}
                      
                      {isSpeaking && !isTranscribing && !isThinking && (
                        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-blue-500 text-white px-4 py-2 rounded-full text-sm z-50 flex items-center gap-2">
                          <Volume2 className="h-4 w-4 animate-pulse" />
                          <span>Speaking...</span>
                        </div>
                      )}
                      
                      <div ref={messagesEndRef} />
                    </div>
                  </div>
                  
                  {/* Input area - fixed at bottom */}
                  <div className="p-4 border-t border-white/20 flex-shrink-0 bg-white/5">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={toggleRecording}
                        disabled={isRecordingDisabled || isTranscribing}
                        className={`p-4 rounded-full flex items-center justify-center transition-all ${
                          isRecording 
                            ? 'bg-red-500 text-white pulsate-recording' 
                            : isTranscribing
                              ? 'bg-blue-500 text-white'
                              : isRecordingDisabled
                                ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                                : 'bg-white text-black hover:bg-white/80'
                        }`}
                        style={{ minWidth: '48px', minHeight: '48px' }}
                      >
                        {isRecording ? <MicOff className="h-6 w-6" /> : 
                         isTranscribing ? <Loader2 className="h-6 w-6 animate-spin" /> : 
                         <Mic className="h-6 w-6" />}
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
                          className="w-full py-3 px-4 bg-black/30 border border-white/10 rounded-lg focus:ring-2 focus:ring-white/30 focus:outline-none pr-12"
                        />
                        <button
                          onClick={() => handleSendMessage()}
                          disabled={isSendDisabled}
                          className={`absolute right-2 top-1/2 transform -translate-y-1/2 p-2 ${
                            isSendDisabled ? 'text-gray-600 cursor-not-allowed' : 'text-white hover:text-white/80'
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
              <div className={`md:w-1/4 md:h-full md:block ${viewMode === 'chat' ? 'hidden' : 'block'}`}>
                <div className="bg-white/5 border border-white/20 rounded-xl h-full flex flex-col shadow-lg">
                  <div className="p-4 border-b border-white/20 flex justify-between items-center bg-white/10 rounded-t-xl">
                    <h2 className="font-medium">Your Camera</h2>
                    <div className="flex gap-2">
                      <button
                        onClick={toggleCamera}
                        className={`p-2 rounded-full ${
                          isCameraOn ? 'bg-white/20 text-white' : 'bg-black/50 text-gray-400 border border-white/30'
                        }`}
                      >
                        {isCameraOn ? <Camera className="h-4 w-4" /> : <CameraOff className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  
                  <div className="relative flex-1 flex items-center justify-center bg-black/50 rounded-b-xl overflow-hidden">
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