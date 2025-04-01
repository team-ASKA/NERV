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
  summary: string;
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
        const storedResults = localStorage.getItem('interviewResults');
        if (storedResults) {
          setResults(JSON.parse(storedResults));
        } else {
          // Try to build results from interviewData if interviewResults doesn't exist
          const interviewData = localStorage.getItem('interviewData');
          if (interviewData) {
            const parsedData = JSON.parse(interviewData);
            if (Array.isArray(parsedData) && parsedData.length > 0) {
              // Create a basic results object from the interview data
              const basicResults: InterviewResults = {
                id: Date.now().toString(),
                summary: "Interview completed. Here are your responses and emotional analysis.",
                emotionsData: parsedData,
                transcriptions: parsedData.map(item => item.answer),
                timestamp: new Date().toISOString()
              };
              setResults(basicResults);
              
              // Store this in interview history as well
              const interviewHistory = JSON.parse(localStorage.getItem('interviewHistory') || '[]');
              interviewHistory.push(basicResults);
              localStorage.setItem('interviewHistory', JSON.stringify(interviewHistory));
            } else {
              setError("No interview results found. Please complete an interview first.");
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
              ? item.emotions.slice(0, 3).map(e => `${e.name || 'Unknown'} (${((e.score || 0) * 100).toFixed(0)}%)`).join(', ')
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
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-white"></div>
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
                    <ReactMarkdown>{results.summary || "No summary available"}</ReactMarkdown>
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
                                  item.emotions.slice(0, 6).map((emotion, idx) => {
                                    const score = (emotion.score || 0) * 100;
                                    const getEmotionColor = (name: string) => {
                                      const emotionColors: {[key: string]: string} = {
                                        happy: 'bg-green-500',
                                        sad: 'bg-blue-500',
                                        angry: 'bg-red-500',
                                        surprised: 'bg-yellow-500',
                                        fearful: 'bg-purple-500',
                                        disgusted: 'bg-orange-500',
                                        neutral: 'bg-gray-500',
                                        default: 'bg-white'
                                      };
                                      return emotionColors[name.toLowerCase()] || emotionColors.default;
                                    };
                                    
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