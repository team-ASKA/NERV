import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mic, MicOff, Camera, CameraOff, Volume2, VolumeX,
  Loader2, Send, User, Bot, MessageSquare, Brain,
  ArrowLeft, Download, ChevronLeft, ChevronRight
} from 'lucide-react';
import { useInterview } from '../contexts/InterviewContext';
import ReactMarkdown from 'react-markdown';

/**
 * Main Interview interface component that uses InterviewContext
 */
const InterviewInterface: React.FC = () => {
  const {
    state,
    addMessage,
    setUserInput,
    toggleRecording,
    toggleCamera,
    toggleSpeech,
    handleSendMessage,
    startInterview,
    endInterview,
    videoRef,
    messagesEndRef,
  } = useInterview();

  // Start the interview when the component loads
  useEffect(() => {
    startInterview();
    
    // Cleanup function
    return () => {
      // This will be called when the component unmounts
    };
  }, [startInterview]);
  
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };
  
  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 p-4 flex items-center justify-between">
        <div className="flex items-center">
          <button
            onClick={() => window.history.back()}
            className="mr-4 text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-semibold">AI Interview Session</h1>
        </div>
        
        <div className="flex items-center space-x-3">
          <button
            onClick={toggleSpeech}
            className={`p-2 rounded-full ${
              state.isSpeaking
                ? 'bg-blue-100 text-blue-600'
                : 'bg-gray-100 text-gray-600'
            } hover:bg-blue-50`}
            aria-label={state.isSpeaking ? 'Disable speech' : 'Enable speech'}
          >
            {state.isSpeaking ? <Volume2 size={20} /> : <VolumeX size={20} />}
          </button>
          
          <button
            onClick={toggleCamera}
            className={`p-2 rounded-full ${
              state.isCameraOn
                ? 'bg-blue-100 text-blue-600'
                : 'bg-gray-100 text-gray-600'
            } hover:bg-blue-50`}
            aria-label={state.isCameraOn ? 'Turn camera off' : 'Turn camera on'}
          >
            {state.isCameraOn ? <Camera size={20} /> : <CameraOff size={20} />}
          </button>
          
          <button
            onClick={endInterview}
            className="ml-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            End Interview
          </button>
        </div>
      </header>
      
      <div className="flex flex-1 overflow-hidden">
        {/* Main content area with flexible layout */}
        <div className="flex flex-1">
          {/* Chat panel - always visible */}
          <div className="flex flex-col flex-1 border-r border-gray-200 bg-white">
            {/* Chat messages */}
            <div className="flex-1 overflow-y-auto p-4">
              <AnimatePresence>
                {state.messages.map((message) => (
                  <motion.div
                    key={message.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className={`mb-4 flex ${
                      message.sender === 'user' ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    <div
                      className={`max-w-3/4 rounded-lg p-3 ${
                        message.sender === 'user'
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      <div className="flex items-center mb-1">
                        {message.sender === 'user' ? (
                          <User size={16} className="mr-1" />
                        ) : (
                          <Bot size={16} className="mr-1" />
                        )}
                        <span className="font-medium">
                          {message.sender === 'user' ? 'You' : 'AI Interviewer'}
                        </span>
                      </div>
                      <ReactMarkdown className="prose prose-sm">
                        {message.text}
                      </ReactMarkdown>
                    </div>
                  </motion.div>
                ))}
                <div ref={messagesEndRef} />
              </AnimatePresence>
              
              {/* Thinking indicator */}
              {state.isThinking && (
                <div className="flex items-center text-gray-500 mb-4">
                  <Loader2 size={16} className="mr-2 animate-spin" />
                  <span>AI is thinking...</span>
                </div>
              )}
            </div>
            
            {/* Chat input */}
            <div className="border-t border-gray-200 p-4 bg-white">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage();
                }}
                className="flex items-end"
              >
                <div className="flex-1 relative">
                  <textarea
                    value={state.userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="Type your answer..."
                    className="w-full p-3 bg-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
                    rows={2}
                    disabled={state.interviewState === 'ai-speaking' || state.isThinking}
                  />
                  <button
                    type="button"
                    onClick={toggleRecording}
                    className={`absolute bottom-2 right-16 p-2 rounded-full ${
                      state.isRecording
                        ? 'bg-red-100 text-red-600 pulsate-recording'
                        : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                    }`}
                  >
                    {state.isRecording ? <MicOff size={20} /> : <Mic size={20} />}
                  </button>
                </div>
                <button
                  type="submit"
                  className="ml-2 p-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  disabled={!state.userInput.trim() || state.interviewState === 'ai-speaking' || state.isThinking}
                >
                  <Send size={20} />
                </button>
              </form>
              
              {state.isTranscribing && (
                <div className="mt-2 text-sm text-gray-500 flex items-center">
                  <Loader2 size={14} className="mr-1 animate-spin" />
                  Transcribing audio...
                </div>
              )}
              
              {state.transcriptionError && (
                <div className="mt-2 text-sm text-red-500">
                  {state.transcriptionError}
                </div>
              )}
            </div>
          </div>
          
          {/* Camera panel - conditionally visible */}
          {state.isCameraOn && (
            <div className="w-1/3 bg-gray-900 flex flex-col">
              <div className="flex-1 relative">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="absolute inset-0 w-full h-full object-cover"
                />
                
                {/* Emotion display */}
                {state.facialExpressions.length > 0 && (
                  <div className="absolute bottom-4 left-4 right-4 bg-black bg-opacity-70 text-white p-3 rounded-lg">
                    <h3 className="text-sm font-semibold mb-1 flex items-center">
                      <Brain size={14} className="mr-1" /> Detected Emotions
                    </h3>
                    <div className="text-xs space-y-1">
                      {state.facialExpressions.slice(0, 3).map((emotion, index) => (
                        <div key={index} className="flex items-center justify-between">
                          <span>{emotion.name}</span>
                          <div className="w-24 bg-gray-700 rounded-full h-1.5">
                            <div
                              className="bg-blue-400 h-1.5 rounded-full"
                              style={{ width: `${emotion.score * 100}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                {state.cameraError && (
                  <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-80 text-white p-4">
                    <div className="text-center">
                      <p className="mb-2">{state.cameraError}</p>
                      <button
                        onClick={toggleCamera}
                        className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                      >
                        Try Again
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* CSS for pulsating recording effect */}
      <style jsx>{`
        @keyframes pulsate {
          0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
          70% { box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); }
          100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
        }
        
        .pulsate-recording {
          animation: pulsate 1.5s infinite;
        }
      `}</style>
    </div>
  );
};

export default InterviewInterface; 