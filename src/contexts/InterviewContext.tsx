import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { HumeClient } from 'hume';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { StorageKey, loadData, saveData, deleteData } from '../services/storageService';
import { textToSpeech } from '../services/audioService';
import { initializeHumeClient, startOptimizedEmotionAnalysis } from '../services/emotionAnalysisService';
import {
  initializeInterview,
  processAnswer,
  generateNextQuestion,
  generateInterviewSummary,
  createInterviewResults,
} from '../services/interviewService';

// Define message interface
interface Message {
  id: string;
  text: string;
  sender: 'user' | 'ai';
  timestamp: Date;
}

// Define the interview state
interface InterviewState {
  messages: Message[];
  isRecording: boolean;
  isSpeaking: boolean;
  isCameraOn: boolean;
  currentQuestion: number;
  userInput: string;
  isThinking: boolean;
  questions: string[];
  transcription: string;
  isUserTurn: boolean;
  interviewState: 'idle' | 'ai-speaking' | 'ai-thinking' | 'user-speaking';
  videoStream: MediaStream | null;
  hasVideoPermission: boolean;
  viewMode: 'chat' | 'camera';
  mediaRecorder: MediaRecorder | null;
  audioChunks: Blob[];
  isTranscribing: boolean;
  transcriptionError: string | null;
  cameraError: string | null;
  facialExpressions: any[];
  isAnalyzing: boolean;
  humeApiKey: string;
  humeSecretKey: string;
  humeClient: HumeClient | null;
  ttsApiKey: string;
  userDetails: any;
  resumeText: string;
}

// Define context interface
interface InterviewContextType {
  // State
  state: InterviewState;
  
  // Actions
  addMessage: (text: string, sender: 'user' | 'ai') => void;
  setUserInput: (input: string) => void;
  toggleRecording: () => void;
  toggleCamera: () => void;
  toggleSpeech: () => void;
  handleSendMessage: () => Promise<void>;
  startInterview: () => Promise<void>;
  endInterview: () => Promise<void>;
  processUserInput: (input: string) => Promise<void>;
  
  // Refs
  videoRef: React.RefObject<HTMLVideoElement>;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  
  // Media handling
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  cleanupResources: () => void;
}

// Create the context
const InterviewContext = createContext<InterviewContextType | undefined>(undefined);

// Define provider props
interface InterviewProviderProps {
  children: ReactNode;
}

// Provider component
export const InterviewProvider = ({ children }: InterviewProviderProps) => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  
  // Create refs
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  
  // Initialize state
  const [state, setState] = useState<InterviewState>({
    messages: [],
    isRecording: false,
    isSpeaking: false,
    isCameraOn: false,
    currentQuestion: 0,
    userInput: '',
    isThinking: false,
    questions: [],
    transcription: '',
    isUserTurn: false,
    interviewState: 'idle',
    videoStream: null,
    hasVideoPermission: false,
    viewMode: 'chat',
    mediaRecorder: null,
    audioChunks: [],
    isTranscribing: false,
    transcriptionError: null,
    cameraError: null,
    facialExpressions: [],
    isAnalyzing: false,
    humeApiKey: import.meta.env.VITE_HUME_API_KEY || '',
    humeSecretKey: import.meta.env.VITE_HUME_SECRET_KEY || '',
    humeClient: null,
    ttsApiKey: import.meta.env.VITE_APP_AZURE_TTS_API_KEY || '',
    userDetails: null,
    resumeText: '',
  });
  
  // Update state helper function
  const updateState = useCallback((updates: Partial<InterviewState>) => {
    setState(prev => ({ ...prev, ...updates }));
  }, []);
  
  // Initialize Hume client when API keys are available
  useEffect(() => {
    if (state.humeApiKey && state.humeSecretKey && !state.humeClient) {
      try {
        const client = initializeHumeClient(state.humeApiKey, state.humeSecretKey);
        updateState({ humeClient: client });
      } catch (error) {
        console.error('Failed to initialize Hume client:', error);
      }
    }
  }, [state.humeApiKey, state.humeSecretKey, state.humeClient, updateState]);
  
  // Clean up resources on unmount
  useEffect(() => {
    return () => {
      cleanupResources();
    };
  }, []);
  
  // Add a message to the conversation
  const addMessage = useCallback((text: string, sender: 'user' | 'ai') => {
    updateState({
      messages: [
        ...state.messages,
        {
          id: uuidv4(),
          text,
          sender,
          timestamp: new Date(),
        },
      ],
    });
    
    // Save messages to storage
    saveData(StorageKey.InterviewMessages, [
      ...state.messages,
      {
        id: uuidv4(),
        text,
        sender,
        timestamp: new Date(),
      },
    ]);
    
    // Scroll to bottom
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  }, [state.messages, updateState]);
  
  // Set user input
  const setUserInput = useCallback((input: string) => {
    updateState({ userInput: input });
  }, [updateState]);
  
  // Start recording audio
  const startRecording = useCallback(async () => {
    try {
      // Request audio permissions
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      
      // Create a MediaRecorder instance
      const recorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm',
      });
      
      // Clear any previous chunks
      updateState({
        mediaRecorder: recorder,
        audioChunks: [],
        isRecording: true,
        interviewState: 'user-speaking',
      });
      
      // Start recording
      recorder.start();
      
      // Handle data available event
      recorder.addEventListener('dataavailable', (e) => {
        updateState({
          audioChunks: [...state.audioChunks, e.data],
        });
      });
    } catch (error) {
      console.error('Error starting recording:', error);
      updateState({
        transcriptionError: `Could not start recording: ${error instanceof Error ? error.message : 'Unknown error'}`,
        isRecording: false,
      });
    }
  }, [state.audioChunks, updateState]);
  
  // Stop recording
  const stopRecording = useCallback(() => {
    if (state.mediaRecorder && state.isRecording) {
      state.mediaRecorder.stop();
      updateState({ isRecording: false, isTranscribing: true });
      
      // When recording stops, process the audio
      setTimeout(async () => {
        try {
          // Create audio blob
          const audioBlob = new Blob(state.audioChunks, { type: 'audio/webm' });
          
          // TODO: Implement audio transcription logic here
          // For now, just using a placeholder transcription
          const transcription = "This is a placeholder transcription. Replace with actual transcription service.";
          
          // Process the transcription
          await processUserInput(transcription);
          
          updateState({
            transcription,
            isTranscribing: false,
            audioChunks: [],
          });
        } catch (error) {
          console.error('Error processing audio:', error);
          updateState({
            transcriptionError: `Failed to process audio: ${error instanceof Error ? error.message : 'Unknown error'}`,
            isTranscribing: false,
          });
        }
      }, 500);
    }
  }, [state.mediaRecorder, state.isRecording, state.audioChunks, updateState]);
  
  // Toggle recording state
  const toggleRecording = useCallback(() => {
    if (state.isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [state.isRecording, startRecording, stopRecording]);
  
  // Toggle camera
  const toggleCamera = useCallback(async () => {
    try {
      if (state.isCameraOn && state.videoStream) {
        // Turn off camera
        state.videoStream.getTracks().forEach(track => track.stop());
        updateState({ isCameraOn: false, videoStream: null });
      } else {
        // Request camera permissions
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
        });
        
        // Set video stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        
        updateState({
          isCameraOn: true,
          videoStream: stream,
          hasVideoPermission: true,
          cameraError: null,
        });
        
        // Start emotion analysis if client is available
        if (state.humeClient && state.isCameraOn) {
          const stopAnalysis = startOptimizedEmotionAnalysis(
            state.humeClient,
            videoRef.current,
            2000, // Capture every 2 seconds
            (emotions) => {
              updateState({ facialExpressions: emotions });
              // Save emotions to storage
              saveData(StorageKey.CurrentEmotions, emotions);
            }
          );
          
          // Store the function to stop analysis
          return () => {
            stopAnalysis();
          };
        }
      }
    } catch (error) {
      console.error('Error toggling camera:', error);
      updateState({
        cameraError: `Could not access camera: ${error instanceof Error ? error.message : 'Unknown error'}`,
        isCameraOn: false,
      });
    }
  }, [state.isCameraOn, state.videoStream, state.humeClient, updateState]);
  
  // Toggle speech
  const toggleSpeech = useCallback(() => {
    updateState({ isSpeaking: !state.isSpeaking });
  }, [state.isSpeaking, updateState]);
  
  // Process user input
  const processUserInput = useCallback(async (input: string) => {
    if (!input.trim()) return;
    
    // Add user message
    addMessage(input, 'user');
    updateState({ userInput: '', isThinking: true, interviewState: 'ai-thinking' });
    
    try {
      // Get current question
      const currentQuestionText = state.questions[state.currentQuestion];
      
      // Process the answer
      const response = await processAnswer(
        currentQuestionText,
        input,
        state.facialExpressions,
        import.meta.env.VITE_APP_AZURE_OPENAI_KEY || ''
      );
      
      // Add AI response
      addMessage(response, 'ai');
      
      // Speak the response if speech is enabled
      if (state.isSpeaking) {
        updateState({ interviewState: 'ai-speaking' });
        await textToSpeech(response, state.ttsApiKey);
      }
      
      // Move to next question
      updateState({
        currentQuestion: state.currentQuestion + 1,
        isThinking: false,
        interviewState: 'idle',
      });
      
      // Generate next question if available
      if (state.currentQuestion < state.questions.length - 1) {
        // Use the next question in the list
        // No action needed as we already incremented currentQuestion
      } else {
        // Generate a new question
        try {
          const nextQuestion = await generateNextQuestion(
            import.meta.env.VITE_APP_AZURE_OPENAI_KEY || ''
          );
          
          // Add the new question to the list
          updateState({
            questions: [...state.questions, nextQuestion],
          });
        } catch (error) {
          console.error('Error generating next question:', error);
        }
      }
    } catch (error) {
      console.error('Error processing user input:', error);
      updateState({
        isThinking: false,
        interviewState: 'idle',
      });
      
      // Add error message
      addMessage(
        "I'm sorry, I couldn't process your response. Let's continue with the next question.",
        'ai'
      );
    }
  }, [
    state.questions,
    state.currentQuestion,
    state.facialExpressions,
    state.isSpeaking,
    state.ttsApiKey,
    addMessage,
    updateState,
  ]);
  
  // Handle sending message from input field
  const handleSendMessage = useCallback(async () => {
    if (!state.userInput.trim()) return;
    await processUserInput(state.userInput);
  }, [state.userInput, processUserInput]);
  
  // Start the interview
  const startInterview = useCallback(async () => {
    try {
      // Clear previous interview data
      await deleteData(StorageKey.InterviewData);
      await deleteData(StorageKey.CurrentEmotions);
      
      // Reset state
      updateState({
        messages: [],
        currentQuestion: 0,
        userInput: '',
        isThinking: true,
        interviewState: 'ai-thinking',
      });
      
      // Load resume text if available
      const resumeText = await loadData<string>(StorageKey.ResumeText, '');
      
      // Initialize interview with resume text
      const questions = await initializeInterview(
        resumeText,
        import.meta.env.VITE_APP_AZURE_OPENAI_KEY || ''
      );
      
      // Set questions
      updateState({
        questions,
        resumeText,
        isThinking: false,
      });
      
      // Add welcome message
      const welcomeMessage = "Hello! I'm your AI interviewer. I'll be asking you a series of questions to learn more about your skills and experience. Let's begin with the first question.";
      addMessage(welcomeMessage, 'ai');
      
      // Speak welcome message if speech is enabled
      if (state.isSpeaking) {
        updateState({ interviewState: 'ai-speaking' });
        await textToSpeech(welcomeMessage, state.ttsApiKey);
        updateState({ interviewState: 'idle' });
      }
      
      // Add first question
      const firstQuestion = questions[0];
      addMessage(firstQuestion, 'ai');
      
      // Speak first question if speech is enabled
      if (state.isSpeaking) {
        updateState({ interviewState: 'ai-speaking' });
        await textToSpeech(firstQuestion, state.ttsApiKey);
        updateState({ interviewState: 'idle' });
      }
    } catch (error) {
      console.error('Error starting interview:', error);
      updateState({
        isThinking: false,
        interviewState: 'idle',
      });
      
      // Add error message
      addMessage(
        "I'm sorry, I couldn't start the interview. Please try again later.",
        'ai'
      );
    }
  }, [state.isSpeaking, state.ttsApiKey, addMessage, updateState]);
  
  // End the interview
  const endInterview = useCallback(async () => {
    try {
      updateState({ isThinking: true });
      
      // Generate interview summary
      const summary = await generateInterviewSummary(
        import.meta.env.VITE_APP_AZURE_OPENAI_KEY || ''
      );
      
      // Create interview results
      const interviewResults = await createInterviewResults(summary);
      
      // Save interview results
      await saveData(StorageKey.InterviewResults, interviewResults);
      
      // Update interview history
      const interviewHistory = await loadData<any[]>(StorageKey.InterviewHistory, []);
      await saveData(
        StorageKey.InterviewHistory,
        [...interviewHistory, interviewResults]
      );
      
      // Cleanup
      cleanupResources();
      
      // Navigate to results page
      navigate('/results');
    } catch (error) {
      console.error('Error ending interview:', error);
      updateState({ isThinking: false });
      
      // Add error message
      addMessage(
        "I'm sorry, I couldn't generate your interview results. Please try again later.",
        'ai'
      );
    }
  }, [navigate, addMessage, updateState]);
  
  // Clean up resources
  const cleanupResources = useCallback(() => {
    // Stop recording if active
    if (state.mediaRecorder && state.isRecording) {
      state.mediaRecorder.stop();
    }
    
    // Stop video stream if active
    if (state.videoStream) {
      state.videoStream.getTracks().forEach(track => track.stop());
    }
    
    // Reset state
    updateState({
      isRecording: false,
      isCameraOn: false,
      videoStream: null,
      mediaRecorder: null,
      audioChunks: [],
    });
  }, [state.mediaRecorder, state.isRecording, state.videoStream, updateState]);
  
  // Context value
  const contextValue: InterviewContextType = {
    state,
    addMessage,
    setUserInput,
    toggleRecording,
    toggleCamera,
    toggleSpeech,
    handleSendMessage,
    startInterview,
    endInterview,
    processUserInput,
    videoRef,
    messagesEndRef,
    startRecording,
    stopRecording,
    cleanupResources,
  };
  
  return (
    <InterviewContext.Provider value={contextValue}>
      {children}
    </InterviewContext.Provider>
  );
};

// Hook to use the interview context
export const useInterview = () => {
  const context = useContext(InterviewContext);
  if (context === undefined) {
    throw new Error('useInterview must be used within an InterviewProvider');
  }
  return context;
}; 