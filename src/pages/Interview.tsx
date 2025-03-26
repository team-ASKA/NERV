import { useState, useEffect, useRef } from 'react';
import { motion} from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Mic, MicOff, Camera, CameraOff, Volume2, VolumeX, Loader2, Send, User, Bot, MessageSquare } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { transcribeAudio } from '../services/whisperService';


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
      setTranscriptionError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm', // Specify the MIME type explicitly
      });
      const audioChunks: BlobPart[] = [];
      
      recorder.ondataavailable = (e) => {
        audioChunks.push(e.data);
      };
      
      recorder.onstop = async () => {
        try {
          const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
          console.log('Recording stopped, blob created:', audioBlob.size, 'bytes');
          
          setIsTranscribing(true);
          const text = await transcribeAudio(audioBlob);
          setIsTranscribing(false);
          
          if (text) {
            setUserInput(text);
            handleSendMessage(text);
          } else {
            setTranscriptionError("Received empty transcription. Please try again or type your response.");
          }
        } catch (error) {
          console.error("Transcription error:", error);
          setIsTranscribing(false);
          setTranscriptionError(error instanceof Error ? error.message : "Error transcribing audio. Please try again.");
        } finally {
          // Always clean up the stream
          stream.getTracks().forEach(track => track.stop());
        }
      };
      
      setMediaRecorder(recorder);
      recorder.start();
      setIsRecording(true);
      setInterviewState('user-speaking');
    } catch (err) {
      console.error("Error starting recording:", err);
      setTranscriptionError("Couldn't access microphone. Please check permissions and try again.");
    }
  };
  
  const stopRecording = () => {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
      setIsRecording(false);
      setInterviewState('idle');
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

  const toggleCamera = async () => {
    if (isCameraOn) {
      // Turn off camera
      if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        setVideoStream(null);
      }
      setIsCameraOn(false);
    } else {
      // Turn on camera
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setVideoStream(stream);
        setIsCameraOn(true);
        setHasVideoPermission(true);
      } catch (err) {
        console.error("Error accessing camera:", err);
        setHasVideoPermission(false);
      }
    }
  };

  // Initialize camera when component mounts
  useEffect(() => {
    const initCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setVideoStream(stream);
        setIsCameraOn(true);
        setHasVideoPermission(true);
      } catch (err) {
        console.error("Error accessing camera:", err);
        setHasVideoPermission(false);
      }
    };
    
    initCamera();
    
    // Cleanup function to stop all tracks when component unmounts
    return () => {
      if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const handleSendMessage = (text = userInput) => {
    if (!text.trim()) return;
    
    // Add user message
    const newUserMessage: Message = {
      id: Date.now().toString(),
      text: text.trim(),
      sender: 'user',
      timestamp: new Date()
    };
    
    setMessages(prev => [...prev, newUserMessage]);
    setUserInput('');
    setTranscription('');
    setIsUserTurn(false);
    
    // AI starts thinking
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
        
        // Simulate AI finishing speaking after a delay proportional to message length
        const speakingTime = (feedback.length + nextQuestion.length) * 30;
        setTimeout(() => {
          setIsSpeaking(false);
          setInterviewState('idle');
          setIsUserTurn(true);
        }, Math.min(speakingTime, 5000)); // Cap at 5 seconds max
        
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
        
        // Simulate AI finishing speaking
        setTimeout(() => {
          setIsSpeaking(false);
          setInterviewState('idle');
          
          // Navigate to results after a delay
          setTimeout(() => {
            navigate('/results');
          }, 2000);
        }, 4000);
      }
    }, 2000);
  };

  // Generate random feedback (in a real app, this would be AI-generated)
  const generateFeedback = () => {
    const feedbacks = [
      "That's a good point. I like how you provided specific examples.",
      "Your answer demonstrates good technical knowledge. Consider adding more details about the implementation challenges.",
      "Great response! You clearly explained the concepts and your approach.",
      "That's a solid answer. You might want to also mention how you handle edge cases.",
      "Good explanation. It would be even better if you could quantify the impact of your solution."
    ];
    
    return feedbacks[Math.floor(Math.random() * feedbacks.length)];
  };

  const progress = ((currentQuestion + 1) / questions.length) * 100;

  // Determine if recording button should be disabled
  const isRecordingDisabled = interviewState === 'ai-speaking' || interviewState === 'ai-thinking';
  
  // Determine if send button should be disabled
  const isSendDisabled = !userInput.trim() || isThinking || isSpeaking;

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
          </div>
        </div>
      </div>

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
                    {messages.map((message) => (
                      <div
                        key={message.id}
                        className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[80%] rounded-2xl p-4 ${
                            message.sender === 'user'
                              ? 'bg-white/10 text-white rounded-tr-none'
                              : 'bg-white/5 text-white rounded-tl-none'
                          }`}
                        >
                          <div className="flex items-center mb-2">
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center mr-2 ${
                              message.sender === 'user' ? 'bg-white/10' : 'bg-white/5'
                            }`}>
                              {message.sender === 'user' ? 
                                <User className="h-3 w-3" /> : 
                                <Bot className="h-3 w-3" />
                              }
                            </div>
                            <span className="text-sm font-medium">
                              {message.sender === 'user' ? 'You' : 'AI Interviewer'}
                            </span>
                            <span className="text-xs opacity-70 ml-2">
                              {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <p className="whitespace-pre-wrap text-sm">{message.text}</p>
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
                  {isCameraOn ? (
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover rounded-lg"
                      style={{ transform: 'scaleX(-1)' }} // Mirror effect for selfie view
                    />
                  ) : (
                    <div className="text-center">
                      {hasVideoPermission ? (
                        <div>
                          <div className="w-20 h-20 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-4">
                            <User className="h-10 w-10 text-gray-400" />
                          </div>
                          <p className="text-gray-400">Camera is turned off</p>
                          <button
                            onClick={toggleCamera}
                            className="mt-4 px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-colors"
                          >
                            Turn on camera
                          </button>
                        </div>
                      ) : (
                        <div>
                          <div className="w-20 h-20 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Camera className="h-10 w-10 text-gray-400" />
                          </div>
                          <p className="text-gray-400">Camera access required</p>
                          <button
                            onClick={toggleCamera}
                            className="mt-4 px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-colors"
                          >
                            Allow camera access
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  
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
    </div>
  );
};

export default Interview;