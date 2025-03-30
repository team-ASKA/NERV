import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Mic, MicOff, Camera, CameraOff, Volume2, VolumeX, 
  Loader2, Send, User, Bot, MessageSquare, Brain, 
  Menu, Edit, LogOut, Linkedin, Globe, X, FileText, ArrowLeft
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { transcribeAudio } from '../services/whisperService';
import { FaVideo } from 'react-icons/fa';
import { HumeClient } from "hume";
import { auth, db, storage } from '../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';

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

const mockQuestions: Question[] = [
  {
    id: 1,
    text: "Can you tell me about your experience with React and how you've used it in your projects?",
    isAsked: false
  },
  {
    id: 2,
    text: "What's your approach to handling state management in large applications?",
    isAsked: false
  },
  {
    id: 3,
    text: "How do you ensure your code is maintainable and scalable?",
    isAsked: false
  },
  {
    id: 4,
    text: "Can you describe a challenging technical problem you've solved recently?",
    isAsked: false
  },
  {
    id: 5,
    text: "How do you stay updated with the latest developments in web technologies?",
    isAsked: false
  }
];

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

const Interview = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [userInput, setUserInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [questions] = useState<Question[]>(mockQuestions);
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
  const [userDetails, setUserDetails] = useState<any>(null);

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
    if (!currentUser) {
      navigate('/login');
      return;
    }
    
    // Start the interview with AI speaking
    setInterviewState('ai-speaking');
    setIsSpeaking(true);
    
    // Add initial AI message with first question
    setMessages([
      {
        id: '1',
        text: "Hello! I'm your AI interviewer today. Let's start with the first question.",
        sender: 'ai',
        timestamp: new Date()
      },
      {
        id: '2',
        text: questions[0].text,
        sender: 'ai',
        timestamp: new Date()
      }
    ]);
    
    // Simulate AI finishing speaking after 3 seconds
    const timer = setTimeout(() => {
      setIsSpeaking(false);
      setInterviewState('idle');
      setIsUserTurn(true);
    }, 3000);
    
    return () => clearTimeout(timer);
  }, [currentUser, navigate, questions]);

  // Scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
      
      recorder.onstop = async () => {
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
            
            setIsThinking(true);
            setInterviewState('ai-thinking');
            
            // Simulate AI processing
            setTimeout(() => {
              // Move to next question if available
              if (currentQuestion < questions.length - 1) {
                setCurrentQuestion(prev => prev + 1);
                
                // AI stops thinking and starts speaking
                setIsThinking(false);
                setIsSpeaking(true);
                setInterviewState('ai-speaking');
                
                // Add AI response and next question
                const feedback = generateFeedback();
                const nextQuestion = questions[currentQuestion + 1].text;
                
                setMessages(prev => [
                  ...prev,
                  {
                    id: Date.now().toString() + '-feedback',
                    text: feedback,
                    sender: 'ai',
                    timestamp: new Date()
                  },
                  {
                    id: Date.now().toString() + '-question',
                    text: nextQuestion,
                    sender: 'ai',
                    timestamp: new Date(Date.now() + 1000)
                  }
                ]);
                
                // Speak the messages sequentially
                speakResponse(feedback).then(() => {
                  return speakResponse(nextQuestion);
                }).then(() => {
                  setIsSpeaking(false);
                  setInterviewState('idle');
                  setIsUserTurn(true);
                });
                
              } else {
                // Interview complete
                setIsThinking(false);
                setIsSpeaking(true);
                setInterviewState('ai-speaking');
                
                const feedback = generateFeedback();
                const completionMessage = "That concludes our interview. Thank you for your responses! I'll now generate your detailed feedback report.";
                
                setMessages(prev => [
                  ...prev,
                  {
                    id: Date.now().toString() + '-feedback',
                    text: feedback,
                    sender: 'ai',
                    timestamp: new Date()
                  },
                  {
                    id: Date.now().toString() + '-complete',
                    text: completionMessage,
                    sender: 'ai',
                    timestamp: new Date(Date.now() + 1000)
                  }
                ]);
                
                // Speak the messages sequentially
                speakResponse(feedback).then(() => {
                  return speakResponse(completionMessage);
                }).then(() => {
                  setIsSpeaking(false);
                  setInterviewState('idle');
                  
                  // Navigate to results after a delay
                  setTimeout(() => {
                    navigate('/results');
                  }, 2000);
                });
              }
            }, 2000);
          } else {
            setTranscriptionError('No transcription returned');
          }
        } catch (error) {
          console.error('Transcription error:', error);
          setTranscriptionError(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
                    predictionsFound = true;
                  } else {
                    console.log("No emotions array in the prediction");
                  }
                  
                  break;
                } else {
                  console.log("No grouped_predictions in face model results");
                }
              } else {
                console.log("No predictions array in results");
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
    setUserInput('');
    setIsThinking(true);
    setInterviewState('ai-thinking');
    setIsUserTurn(false);
    
    try {
      // Process the user's answer
      await processUserAnswer(userInput);
      
      // Short delay before AI response
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      setIsThinking(false);
      setIsSpeaking(true);
      setInterviewState('ai-speaking');
      
      // Generate feedback for the current question
      const feedback = generateFeedback();
      
      // Add feedback message
      const feedbackMessage: Message = {
        id: Date.now().toString() + '-feedback',
        text: feedback,
        sender: 'ai',
        timestamp: new Date()
      };
      
      setMessages(prev => [...prev, feedbackMessage]);
      
      // Speak the feedback first
      await speakResponse(feedback);
      
      // Check if there are more questions
      if (currentQuestion < questions.length - 1) {
        // Move to the next question
        setCurrentQuestion(prev => prev + 1);
        
        // Get the next question
        const nextQuestion = questions[currentQuestion + 1];
        
        // Add question message
        const questionMessage: Message = {
          id: Date.now().toString() + '-question',
          text: nextQuestion,
          sender: 'ai',
          timestamp: new Date()
        };
        
        setMessages(prev => [...prev, questionMessage]);
        
        // Speak the next question
        await speakResponse(nextQuestion);
        
        // After both messages are spoken, set the interview state back to idle
        setInterviewState('idle');
        setIsUserTurn(true);
        
      } else {
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

  // Update the speakResponse function to handle sequential TTS
  const speakResponse = async (text: string) => {
    try {
      setIsSpeaking(true);
      
      // Get the Azure TTS API key from environment variables
      const ttsApiKey = import.meta.env.VITE_APP_AZURE_TTS_API_KEY || '';
      const endpoint = "https://kusha-m8t3pks8-swedencentral.cognitiveservices.azure.com";
      const deploymentName = "tts";
      
      console.log("Converting text to speech...");
      
      // Ensure we have text to convert
      if (!text || text.trim() === '') {
        console.error("Empty text provided for TTS");
        setIsSpeaking(false);
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
        console.error("Text-to-speech error response:", errorText);
        throw new Error(`Text-to-speech failed: ${response.status}`);
      }
      
      // Get the audio blob
      const audioBlob = await response.blob();
      
      // Create a URL for the audio blob
      const audioUrl = URL.createObjectURL(audioBlob);
      
      // Play the audio
      if (audioRef.current) {
        audioRef.current.src = audioUrl;
        
        // Return a promise that resolves when the audio finishes playing
        return new Promise((resolve) => {
          audioRef.current.onloadedmetadata = () => {
            try {
              const playPromise = audioRef.current?.play();
              if (playPromise) {
                playPromise.catch(error => {
                  console.error("Error playing audio:", error);
                  setIsSpeaking(false);
                  resolve(false);
                });
              }
            } catch (playError) {
              console.error("Error playing audio:", playError);
              setIsSpeaking(false);
              resolve(false);
            }
          };
          
          audioRef.current.onended = () => {
            setIsSpeaking(false);
            URL.revokeObjectURL(audioUrl);
            resolve(true);
          };
          
          audioRef.current.onerror = () => {
            setIsSpeaking(false);
            URL.revokeObjectURL(audioUrl);
            resolve(false);
          };
        });
      } else {
        setIsSpeaking(false);
        return Promise.resolve(false);
      }
      
    } catch (error) {
      console.error('Text-to-speech error:', error);
      setIsSpeaking(false);
      return Promise.resolve(false);
    }
  };

  const toggleMenu = () => {
    setIsMenuOpen(!isMenuOpen);
  };

  useEffect(() => {
    const fetchUserDetails = async () => {
      try {
        // Get current user
        const user = auth.currentUser;
        
        if (!user) {
          console.log('No user logged in');
          return;
        }
        
        // Get user document from Firestore
        const userDocRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);
        
        if (!userDoc.exists()) {
          console.log('User document not found');
          return;
        }
        
        const userData = userDoc.data();
        
        // Get resume download URL if resumePath exists
        let resumeURL = null;
        let resumeName = null;
        
        if (userData.resumePath) {
          try {
            const resumeRef = ref(storage, userData.resumePath);
            resumeURL = await getDownloadURL(resumeRef);
            // Extract filename from path
            resumeName = userData.resumePath.split('/').pop();
          } catch (error) {
            console.error('Error getting resume URL:', error);
          }
        }
        
        // Set user details with all available information
        setUserDetails({
          name: userData.name || user.displayName || 'User',
          email: user.email || 'No email provided',
          resumeURL,
          resumeName,
          linkedinURL: userData.linkedinURL || null,
          portfolioURL: userData.portfolioURL || null,
          // Add any other fields you need
        });
        
      } catch (error) {
        console.error('Error fetching user details:', error);
      }
    };

    fetchUserDetails();
  }, []);

  return (
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
              onClick={toggleMenu}
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
              onClick={toggleMenu}
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
                    onClick={toggleMenu}
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
                  <h2 className="font-medium">AI Interviewer</h2>
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
                      <p className="text-sm">{questions[currentQuestion].text.length > 60 ? 
                        questions[currentQuestion].text.substring(0, 60) + '...' : 
                        questions[currentQuestion].text}
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
                    <h2 className="font-medium">AI Interviewer</h2>
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
                            <span className="text-sm font-medium">AI Interviewer</span>
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
                    
                    {isTranscribing && !isRecording && (
                      <div className="flex justify-end">
                        <div className="bg-white/10 text-white rounded-2xl rounded-tr-none p-4 max-w-[80%]">
                          <div className="flex items-center mb-2">
                            <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center mr-2">
                              <User className="h-3 w-3" />
                            </div>
                            <span className="text-sm font-medium">You</span>
                            <div className="ml-2 flex items-center">
                              <div className="w-2 h-2 rounded-full bg-blue-500 mr-1 animate-pulse"></div>
                              <span className="text-xs text-blue-400">Transcribing...</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                          </div>
                        </div>
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
                
                <div className="flex-1 flex items-center justify-center p-4 relative">
                  <div className="relative w-full h-48 md:h-64 bg-gray-800 rounded-lg overflow-hidden">
                    {isCameraOn ? (
                      <>
                        <video
                          ref={videoRef}
                          autoPlay
                          playsInline
                          muted
                          className="w-full h-full object-cover rounded-lg"
                          style={{ transform: 'scaleX(-1)' }}
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
        <div className="fixed bottom-24 right-4 bg-blue-500 text-white px-3 py-1 rounded-full text-xs animate-pulse">
          Speaking...
        </div>
      )}
    </div>
  );
};

export default Interview;