import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Mic, MicOff, Volume2, VolumeX, Loader2, ArrowRight, Send, User, Bot } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

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

const Interview = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [userInput, setUserInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [questions] = useState<Question[]>(mockQuestions);
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!currentUser) {
      navigate('/login');
      return;
    }
    
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
  }, [currentUser, navigate, questions]);

  // Scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const toggleRecording = () => {
    setIsRecording(!isRecording);
    if (!isRecording) {
      // Start recording logic here
      setUserInput('');
    } else {
      // Stop recording logic here
    }
  };

  const toggleSpeech = () => {
    setIsSpeaking(!isSpeaking);
  };

  const handleSendMessage = () => {
    if (!userInput.trim()) return;
    
    // Add user message
    const newUserMessage: Message = {
      id: Date.now().toString(),
      text: userInput,
      sender: 'user',
      timestamp: new Date()
    };
    
    setMessages(prev => [...prev, newUserMessage]);
    setUserInput('');
    setIsThinking(true);
    
    // Simulate AI processing
    setTimeout(() => {
      // Move to next question if available
      if (currentQuestion < questions.length - 1) {
        setCurrentQuestion(prev => prev + 1);
        
        // Add AI response and next question
        setMessages(prev => [
          ...prev,
          {
            id: Date.now().toString() + '-feedback',
            text: generateFeedback(),
            sender: 'ai',
            timestamp: new Date()
          },
          {
            id: Date.now().toString() + '-question',
            text: questions[currentQuestion + 1].text,
            sender: 'ai',
            timestamp: new Date(Date.now() + 1000)
          }
        ]);
      } else {
        // Interview complete
        setMessages(prev => [
          ...prev,
          {
            id: Date.now().toString() + '-feedback',
            text: generateFeedback(),
            sender: 'ai',
            timestamp: new Date()
          },
          {
            id: Date.now().toString() + '-complete',
            text: "That concludes our interview. Thank you for your responses! I'll now generate your detailed feedback report.",
            sender: 'ai',
            timestamp: new Date(Date.now() + 1000)
          }
        ]);
        
        // Navigate to results after a delay
        setTimeout(() => {
          navigate('/results');
        }, 3000);
      }
      
      setIsThinking(false);
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

  return (
    <div className="min-h-screen bg-primary flex flex-col">
      {/* Progress bar */}
      <div className="fixed top-0 left-0 w-full h-1 bg-secondary z-10">
        <motion.div
          className="h-full bg-accent"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>

      {/* Interview header */}
      <div className="bg-secondary py-4 px-6 border-b border-gray-700">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <div>
            <h1 className="text-xl font-semibold">Technical Interview</h1>
            <p className="text-sm text-gray-400">Question {currentQuestion + 1} of {questions.length}</p>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={toggleSpeech}
              className={`p-2 rounded-full ${
                isSpeaking ? 'bg-accent/20 text-accent' : 'bg-gray-700/20 text-gray-400'
              }`}
            >
              {isSpeaking ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Chat container */}
      <div className="flex-1 overflow-y-auto py-6 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="space-y-6">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl p-4 ${
                    message.sender === 'user'
                      ? 'bg-accent text-white rounded-tr-none'
                      : 'bg-secondary text-white rounded-tl-none'
                  }`}
                >
                  <div className="flex items-center mb-2">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center mr-2 ${
                      message.sender === 'user' ? 'bg-accent/30' : 'bg-secondary/50'
                    }`}>
                      {message.sender === 'user' ? 
                        <User className="h-4 w-4" /> : 
                        <Bot className="h-4 w-4" />
                      }
                    </div>
                    <span className="font-medium">
                      {message.sender === 'user' ? 'You' : 'AI Interviewer'}
                    </span>
                    <span className="text-xs opacity-70 ml-2">
                      {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap">{message.text}</p>
                </div>
              </div>
            ))}
            
            {isThinking && (
              <div className="flex justify-start">
                <div className="bg-secondary text-white rounded-2xl rounded-tl-none p-4 max-w-[80%]">
                  <div className="flex items-center mb-2">
                    <div className="w-8 h-8 rounded-full bg-secondary/50 flex items-center justify-center mr-2">
                      <Bot className="h-4 w-4" />
                    </div>
                    <span className="font-medium">AI Interviewer</span>
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
      </div>

      {/* Input area */}
      <div className="bg-secondary border-t border-gray-700 py-4 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-2">
            <button
              onClick={toggleRecording}
              className={`p-3 rounded-full ${
                isRecording ? 'bg-red-500/20 text-red-500' : 'bg-accent/20 text-accent'
              }`}
            >
              {isRecording ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </button>
            
            <div className="flex-1 relative">
              <input
                type="text"
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder={isRecording ? "Listening..." : "Type your response..."}
                disabled={isThinking || isRecording}
                className="w-full py-3 px-4 bg-input-bg rounded-lg focus:ring-2 focus:ring-accent focus:outline-none pr-12"
              />
              <button
                onClick={handleSendMessage}
                disabled={!userInput.trim() || isThinking}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 p-2 text-accent disabled:text-gray-600"
              >
                <Send className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Interview;