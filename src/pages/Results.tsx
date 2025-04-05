import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ArrowLeft, Download, Brain, MessageSquare, Bot, User, ChevronLeft, ChevronRight, ArrowRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { FaVideo } from 'react-icons/fa';
import { motion } from 'framer-motion';

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

interface InterviewResults {
  id: string;
  summary?: string;
  emotionsData: EmotionItem[];
  transcriptions: string[];
  timestamp: string;
}

const Results = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [results, setResults] = useState<InterviewResults | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(0);
  const tabs = ["Summary", "Transcription", "Emotional Analysis"];

  useEffect(() => {
    // Get results from localStorage
    const loadResults = () => {
      try {
        setIsLoading(true);
        
        // Get the most recent interview results
        const storedResults = localStorage.getItem('interviewResults');
        
        if (storedResults) {
          const parsedResults = JSON.parse(storedResults);
          console.log("Loaded interview results:", parsedResults);
          
          // Ensure the emotionsData array contains the correct emotion values
          if (parsedResults.emotionsData && Array.isArray(parsedResults.emotionsData)) {
            // Remove duplicate question-answer pairs
            const uniqueQuestions = new Set<string>();
            parsedResults.emotionsData = parsedResults.emotionsData.filter((item: any) => {
              // If we've seen this question before, skip it
              if (uniqueQuestions.has(item.question)) {
                return false;
              }
              // Otherwise, add it to our set and keep it
              uniqueQuestions.add(item.question);
              return true;
            });
            
            // Make sure each emotion item has the correct structure
            parsedResults.emotionsData = parsedResults.emotionsData.map((item: any) => {
              // Ensure emotions array exists and has valid data
              if (!item.emotions || !Array.isArray(item.emotions) || item.emotions.length === 0) {
                // If no emotions data, try to get from currentEmotions
                const currentEmotionsStr = localStorage.getItem('currentEmotions');
                let currentEmotions: EmotionData[] = [];
                
                try {
                  if (currentEmotionsStr) {
                    currentEmotions = JSON.parse(currentEmotionsStr);
                  }
                } catch (e) {
                  console.error("Error parsing currentEmotions:", e);
                }
                
                if (currentEmotions.length > 0) {
                  item.emotions = currentEmotions;
                  console.log("Using emotions from currentEmotions");
                } else {
                  // If no emotions data, create a placeholder
                  console.log("No emotions data found for item, using placeholder");
                  item.emotions = [
                    { name: "No emotion data", score: 0 }
                  ];
                }
              } else {
                // Filter out any invalid emotion entries
                item.emotions = item.emotions.filter((emotion: any) => 
                  emotion && typeof emotion === 'object' && 
                  emotion.name && typeof emotion.name === 'string' &&
                  emotion.score !== undefined && typeof emotion.score === 'number'
                );
                
                // Sort emotions by score (highest first)
                item.emotions.sort((a: EmotionData, b: EmotionData) => b.score - a.score);
              }
              
              return {
                question: item.question || "Question not recorded",
                answer: item.answer || "Answer not recorded",
                emotions: item.emotions,
                timestamp: item.timestamp || new Date().toISOString()
              };
            });
          } else {
            console.log("No emotions data array found, creating empty array");
            parsedResults.emotionsData = [];
          }
          
          // Ensure we have unique transcriptions
          if (parsedResults.transcriptions && Array.isArray(parsedResults.transcriptions)) {
            // Remove duplicate transcriptions 
            const uniqueTranscriptions = new Set<string>();
            parsedResults.transcriptions = parsedResults.transcriptions.filter((text: string) => {
              if (uniqueTranscriptions.has(text)) {
                return false;
              }
              uniqueTranscriptions.add(text);
              return true;
            });
          }
          
          setResults(parsedResults);
        } else {
          console.log("No stored interview results found");
          
          // Try to build results from messages in localStorage
          const messagesString = localStorage.getItem('interviewMessages');
          if (messagesString) {
            try {
              const messages = JSON.parse(messagesString);
              
              if (Array.isArray(messages) && messages.length > 0) {
                console.log("Building results from messages:", messages.length, "messages found");
                
                // Extract questions and answers
                const questionAnswerPairs: EmotionItem[] = [];
                let currentQuestion = "";
                
                messages.forEach((msg, index) => {
                  if (msg.sender === 'ai' && messages[index + 1] && messages[index + 1].sender === 'user') {
                    currentQuestion = msg.text;
                    const answer = messages[index + 1].text;
                    
                    questionAnswerPairs.push({
                      question: currentQuestion,
                      answer: answer,
                      emotions: [], // Will be populated from emotionsData if available
                      timestamp: new Date(msg.timestamp).toISOString()
                    });
                  }
                });
                
                // Try to get emotions data
                const emotionsDataString = localStorage.getItem('currentEmotions');
                let emotionsData: EmotionData[] = [];
                
                if (emotionsDataString) {
                  try {
                    const parsedEmotions = JSON.parse(emotionsDataString);
                    if (Array.isArray(parsedEmotions)) {
                      emotionsData = parsedEmotions;
                      console.log("Found emotions data:", emotionsData.length, "emotions");
                    }
                  } catch (e) {
                    console.error("Error parsing emotions data:", e);
                  }
                }
                
                // Apply emotions to each question-answer pair
                if (emotionsData.length > 0) {
                  questionAnswerPairs.forEach(pair => {
                    pair.emotions = emotionsData;
                  });
                }
                
                // Create a basic results object
                const basicResults: InterviewResults = {
                  id: Date.now().toString(),
                  emotionsData: questionAnswerPairs,
                  transcriptions: questionAnswerPairs.map(item => item.answer),
                  timestamp: new Date().toISOString()
                };
                
                console.log("Created basic results:", basicResults);
                setResults(basicResults);
                
                // Store this as the current interview results
                localStorage.setItem('interviewResults', JSON.stringify(basicResults));
                
                // Also store in interview history
                const interviewHistory = JSON.parse(localStorage.getItem('interviewHistory') || '[]');
                interviewHistory.push(basicResults);
                localStorage.setItem('interviewHistory', JSON.stringify(interviewHistory));
              } else {
                setError("No valid interview messages found. Please complete an interview first.");
              }
            } catch (e) {
              console.error("Error parsing messages:", e);
              setError("Failed to parse interview messages.");
            }
          } else {
            setError("No interview results found. Please complete an interview first.");
          }
        }
      } catch (err) {
        console.error("Error loading interview results:", err);
        setError("Failed to load interview results.");
      } finally {
        setIsLoading(false);
      }
    };

    loadResults();
  }, []);

  const handleDownloadResults = () => {
    if (!results) return;
    
    // Create a text version of the results
    const emotionsText = results.emotionsData && results.emotionsData.length > 0 
      ? results.emotionsData.map(item => 
          `Question: ${item.question}\nAnswer: ${item.answer}\nEmotions: ${
            item.emotions && Array.isArray(item.emotions) && item.emotions.length > 0
              ? item.emotions.slice(0, 5).map(e => `${e.name || 'Unknown'} (${((e.score || 0) * 100).toFixed(0)}%)`).join(', ')
              : 'No emotions detected'
          }`
        ).join('\n\n')
      : "No emotional data recorded";
    
    const transcriptionsText = results.transcriptions && results.transcriptions.length > 0
      ? results.transcriptions.join('\n\n')
      : "No transcriptions available";
    
    const resultsText = `
# NERV AI Interview Results
Date: ${new Date(results.timestamp).toLocaleString()}

## Summary
${results.summary || "No summary available"}

## Transcriptions
${transcriptionsText}

## Emotional Analysis
${emotionsText}
    `;
    
    // Create and download the file
    const blob = new Blob([resultsText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `interview-results-${new Date().toLocaleDateString().replace(/\//g, '-')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const nextTab = () => {
    setActiveTab((prev) => (prev === tabs.length - 1 ? 0 : prev + 1));
  };

  const prevTab = () => {
    setActiveTab((prev) => (prev === 0 ? tabs.length - 1 : prev - 1));
  };

  // Helper function to get emotion color
  const getEmotionColor = (name: string) => {
    const emotionColors: {[key: string]: string} = {
      happy: 'bg-green-500',
      happiness: 'bg-green-500',
      joy: 'bg-green-500',
      sad: 'bg-blue-500',
      sadness: 'bg-blue-500',
      angry: 'bg-red-500',
      anger: 'bg-red-500',
      surprised: 'bg-yellow-500',
      surprise: 'bg-yellow-500',
      fearful: 'bg-purple-500',
      fear: 'bg-purple-500',
      disgusted: 'bg-orange-500',
      disgust: 'bg-orange-500',
      neutral: 'bg-gray-500',
      contempt: 'bg-pink-500',
      confusion: 'bg-indigo-500',
      interest: 'bg-cyan-500',
      concentration: 'bg-teal-500',
      default: 'bg-white/50'
    };
    
    const lowerName = name.toLowerCase();
    return emotionColors[lowerName] || emotionColors.default;
  };

  return (
    <div className="min-h-screen bg-black text-white relative overflow-hidden">
      {/* Background gradient effect similar to landing page */}
      <div className="absolute inset-0 bg-gradient-to-b from-black via-black/90 to-black/80 z-0"></div>
      
      <div className="container mx-auto px-4 py-8 max-w-6xl relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex items-center mb-8"
        >
          <button 
            onClick={() => navigate('/dashboard')} 
            className="mr-4 p-2 rounded-full hover:bg-white/10 transition-colors"
          >
            <ArrowLeft className="h-6 w-6" />
          </button>
          <h1 className="font-montserrat font-bold text-3xl bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
            Interview Results
          </h1>
        </motion.div>
        
        {isLoading ? (
          <div className="flex flex-col justify-center items-center h-64 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-white mb-4"></div>
            <h3 className="text-xl font-semibold mb-2">Generating Interview Analysis</h3>
            <p className="text-gray-400 max-w-md">
              We're analyzing your responses and emotional cues to create a comprehensive interview summary with critical feedback.
            </p>
          </div>
        ) : error ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="p-8 rounded-xl bg-black/80 backdrop-blur-sm border border-white/10 mb-6"
          >
            <p className="text-red-300">{error}</p>
            <motion.button 
              whileHover={{ scale: 1.05 }}
              transition={{ duration: 0.2 }}
              onClick={() => navigate('/interview')} 
              className="mt-4 bg-white text-black px-6 py-3 rounded-lg hover:bg-black hover:text-white hover:border hover:border-white transition-all font-semibold"
            >
              Start New Interview
            </motion.button>
          </motion.div>
        ) : results ? (
          <div className="space-y-8">
            {/* Tab Navigation */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="flex justify-between items-center"
            >
              <div className="flex space-x-2">
                <button 
                  onClick={prevTab}
                  className="p-2 rounded-full hover:bg-white/10 transition-colors"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <div className="flex bg-black/30 backdrop-blur-sm rounded-lg border border-white/10 overflow-hidden">
                  {tabs.map((tab, index) => (
                    <button
                      key={index}
                      onClick={() => setActiveTab(index)}
                      className={`px-4 py-2 font-medium transition-colors ${
                        activeTab === index 
                          ? "bg-white text-black" 
                          : "text-white hover:bg-white/10"
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
                <button 
                  onClick={nextTab}
                  className="p-2 rounded-full hover:bg-white/10 transition-colors"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>
              
              <motion.button
                whileHover={{ scale: 1.05 }}
                transition={{ duration: 0.2 }}
                onClick={handleDownloadResults}
                className="flex items-center px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
              >
                <Download className="h-5 w-5 mr-2" />
                Download
              </motion.button>
            </motion.div>
            
            {/* Tab Content with Swipe Animation */}
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
              className="min-h-[60vh]"
            >
              {/* Summary Tab */}
              {activeTab === 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.5 }}
                  className="p-8 rounded-xl bg-black/80 backdrop-blur-sm border border-white/10 hover:border-white/30 transition-all"
                >
                  <div className="flex items-center mb-6">
                    <Brain className="h-6 w-6 text-white mr-3" />
                    <h2 className="font-montserrat font-semibold text-2xl">Interview Summary</h2>
                  </div>
                  <div className="prose prose-invert max-w-none prose-headings:text-white/90 prose-a:text-white">
                    {results.summary ? (
                      <ReactMarkdown>{results.summary}</ReactMarkdown>
                    ) : (
                      <div>
                        <h3>Interview Completed</h3>
                        <p>You've successfully completed your interview with NERV AI.</p>
                        <p>Check the Transcription tab to review your conversation, and the Emotional Analysis tab to see insights about your emotional expressions during the interview.</p>
                        <p>To start a new interview, click the "Start New Interview" button below.</p>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
              
              {/* Transcription Tab */}
              {activeTab === 1 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.5 }}
                  className="p-8 rounded-xl bg-black/80 backdrop-blur-sm border border-white/10 hover:border-white/30 transition-all"
                >
                  <div className="flex items-center mb-6">
                    <MessageSquare className="h-6 w-6 text-white mr-3" />
                    <h2 className="font-montserrat font-semibold text-2xl">Conversation Transcript</h2>
                  </div>
                  {results.emotionsData && results.emotionsData.length > 0 ? (
                    <div className="space-y-6">
                      {results.emotionsData.map((item, index) => (
                        <motion.div
                          key={index}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.3, delay: index * 0.1 }}
                          className="bg-black/30 p-6 rounded-lg border border-white/10 hover:border-white/30 transition-colors"
                        >
                          <div className="flex items-start mb-4">
                            <div className="bg-white/10 rounded-full p-2 mr-3">
                              <Bot className="h-5 w-5 text-white" />
                            </div>
                            <div className="flex-1">
                              <p className="text-white/90">{item.question}</p>
                            </div>
                          </div>
                          
                          <div className="flex items-start ml-6">
                            <div className="bg-white/10 rounded-full p-2 mr-3">
                              <User className="h-5 w-5 text-white" />
                            </div>
                            <div className="flex-1">
                              <p className="text-white/80">{item.answer}</p>
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-white/60">No transcriptions available</p>
                  )}
                </motion.div>
              )}
              
              {/* Emotional Analysis Tab */}
              {activeTab === 2 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.5 }}
                  className="p-8 rounded-xl bg-black/80 backdrop-blur-sm border border-white/10 hover:border-white/30 transition-all"
                >
                  <div className="flex items-center mb-6">
                    <FaVideo className="h-6 w-6 text-white mr-3" />
                    <h2 className="font-montserrat font-semibold text-2xl">Emotional Analysis</h2>
                  </div>
                  {results.emotionsData && results.emotionsData.length > 0 ? (
                    <div className="space-y-8">
                      {results.emotionsData.map((item, index) => (
                        <motion.div
                          key={index}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.3, delay: index * 0.1 }}
                          className="border-b border-white/10 pb-6 last:border-0"
                        >
                          <div className="flex flex-col md:flex-row md:items-start gap-6">
                            <div className="flex-1">
                              <h3 className="font-medium text-white/90 mb-2 text-lg">Question {index + 1}</h3>
                              <p className="text-white/70 mb-3 italic">"{item.question}"</p>
                              <div className="bg-black/30 p-4 rounded-lg border border-white/10 mb-4">
                                <p className="text-white/80">{item.answer}</p>
                              </div>
                            </div>
                            
                            <div className="md:w-1/3">
                              <h4 className="text-sm text-white/90 mb-3 uppercase tracking-wider font-semibold">Detected Emotions</h4>
                              <div className="space-y-2">
                                {item.emotions && Array.isArray(item.emotions) && item.emotions.length > 0 ? 
                                  item.emotions.slice(0, 5).map((emotion, idx) => {
                                    const score = (emotion.score || 0) * 100;
                                    
                                    return (
                                      <motion.div
                                        key={idx}
                                        initial={{ width: 0 }}
                                        animate={{ width: "100%" }}
                                        transition={{ duration: 0.5, delay: idx * 0.1 }}
                                        className="bg-black/50 rounded-lg p-3"
                                      >
                                        <div className="flex justify-between items-center mb-1">
                                          <span className="capitalize font-medium text-white/90">{emotion.name || 'Unknown'}</span>
                                          <span className="text-white/80 font-semibold">{score.toFixed(0)}%</span>
                                        </div>
                                        <div className="w-full bg-white/10 rounded-full h-2">
                                          <motion.div 
                                            initial={{ width: 0 }}
                                            animate={{ width: `${score}%` }}
                                            transition={{ duration: 0.8, delay: idx * 0.1 }}
                                            className={`${getEmotionColor(emotion.name || '')} h-2 rounded-full`}
                                          ></motion.div>
                                        </div>
                                      </motion.div>
                                    );
                                  }) : (
                                    <div className="bg-black/30 p-4 rounded-lg text-white/60">No emotion data available</div>
                                  )
                                }
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-white/60">No emotional data recorded</p>
                  )}
                </motion.div>
              )}
            </motion.div>
            
            {/* Actions */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="flex flex-col sm:flex-row justify-center gap-4 mt-10"
            >
              <motion.button 
                whileHover={{ scale: 1.05 }}
                transition={{ duration: 0.2 }}
                onClick={() => navigate('/interview')} 
                className="inline-flex items-center px-8 py-4 bg-white text-black rounded-lg hover:bg-black hover:text-white hover:border hover:border-white transition-all font-semibold text-lg"
              >
                Start New Interview
                <ArrowRight className="ml-2 h-5 w-5" />
              </motion.button>
            </motion.div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default Results;