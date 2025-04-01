import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ArrowLeft, Download, Brain, MessageSquare, Bot, User } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { FaVideo } from 'react-icons/fa';

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
                summary: "Interview completed. Here are your responses and emotional analysis.",
                emotionsData: parsedData,
                transcriptions: parsedData.map(item => item.answer),
                timestamp: new Date().toISOString()
              };
              setResults(basicResults);
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

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="flex items-center mb-8">
          <button 
            onClick={() => navigate('/dashboard')} 
            className="mr-4 p-2 rounded-full hover:bg-gray-800 transition-colors"
          >
            <ArrowLeft className="h-6 w-6" />
          </button>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-500">Interview Results</h1>
        </div>
        
        {isLoading ? (
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
          </div>
        ) : error ? (
          <div className="bg-red-900/30 border border-red-500/50 rounded-lg p-6 mb-6">
            <p className="text-red-300">{error}</p>
            <button 
              onClick={() => navigate('/interview')} 
              className="mt-4 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition-colors"
            >
              Start New Interview
            </button>
          </div>
        ) : results ? (
          <div className="space-y-8">
            {/* Summary Section */}
            <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl p-8 shadow-xl border border-gray-700/50">
              <div className="flex items-center mb-4">
                <Brain className="h-6 w-6 text-blue-400 mr-3" />
                <h2 className="text-2xl font-semibold text-blue-400">Interview Summary</h2>
              </div>
              <div className="prose prose-invert max-w-none prose-headings:text-blue-300 prose-a:text-blue-400">
                <ReactMarkdown>{results.summary || "No summary available"}</ReactMarkdown>
              </div>
            </div>
            
            {/* Transcriptions Section */}
            <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl p-8 shadow-xl border border-gray-700/50">
              <div className="flex items-center mb-6">
                <MessageSquare className="h-6 w-6 text-green-400 mr-3" />
                <h2 className="text-2xl font-semibold text-green-400">Your Responses</h2>
              </div>
              {results.emotionsData && results.emotionsData.length > 0 ? (
                <div className="space-y-6">
                  {results.emotionsData.map((item, index) => (
                    <div key={index} className="bg-gray-800/50 p-6 rounded-lg border border-gray-700/30 hover:border-gray-600/50 transition-colors">
                      <div className="flex items-start mb-3">
                        <div className="bg-gray-700 rounded-full p-2 mr-3">
                          <Bot className="h-5 w-5 text-blue-400" />
                        </div>
                        <div className="flex-1">
                          <h3 className="font-medium text-blue-300 mb-2">{item.question}</h3>
                        </div>
                        <div className="text-xs text-gray-500">
                          {new Date(item.timestamp).toLocaleTimeString()}
                        </div>
                      </div>
                      
                      <div className="flex items-start ml-12">
                        <div className="bg-gray-700 rounded-full p-2 mr-3">
                          <User className="h-5 w-5 text-green-400" />
                        </div>
                        <div className="flex-1">
                          <p className="text-gray-300">{item.answer}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-400">No transcriptions available</p>
              )}
            </div>
            
            {/* Emotional Analysis Section */}
            <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl p-8 shadow-xl border border-gray-700/50">
              <div className="flex items-center mb-6">
                <FaVideo className="h-6 w-6 text-purple-400 mr-3" />
                <h2 className="text-2xl font-semibold text-purple-400">Emotional Analysis</h2>
              </div>
              {results.emotionsData && results.emotionsData.length > 0 ? (
                <div className="space-y-8">
                  {results.emotionsData.map((item, index) => (
                    <div key={index} className="border-b border-gray-700 pb-6 last:border-0">
                      <div className="flex flex-col md:flex-row md:items-start gap-6">
                        <div className="flex-1">
                          <h3 className="font-medium text-gray-300 mb-2 text-lg">Question {index + 1}</h3>
                          <p className="text-gray-400 mb-3 italic">"{item.question}"</p>
                          <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700/30 mb-4">
                            <p className="text-gray-300">{item.answer}</p>
                          </div>
                        </div>
                        
                        <div className="md:w-1/3">
                          <h4 className="text-sm text-purple-300 mb-3 uppercase tracking-wider font-semibold">Detected Emotions</h4>
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
                                    default: 'bg-indigo-500'
                                  };
                                  return emotionColors[name.toLowerCase()] || emotionColors.default;
                                };
                                
                                return (
                                  <div key={idx} className="bg-gray-800/70 rounded-lg p-3">
                                    <div className="flex justify-between items-center mb-1">
                                      <span className="capitalize font-medium text-gray-200">{emotion.name || 'Unknown'}</span>
                                      <span className="text-gray-300 font-semibold">{score.toFixed(0)}%</span>
                                    </div>
                                    <div className="w-full bg-gray-700 rounded-full h-2">
                                      <div 
                                        className={`${getEmotionColor(emotion.name || '')} h-2 rounded-full`} 
                                        style={{ width: `${score}%` }}
                                      ></div>
                                    </div>
                                  </div>
                                );
                              }) : (
                                <div className="bg-gray-800/50 p-4 rounded-lg text-gray-400">No emotion data available</div>
                              )
                            }
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-400">No emotional data recorded</p>
              )}
            </div>
            
            {/* Actions */}
            <div className="flex flex-col sm:flex-row justify-between gap-4 mt-10">
              <button 
                onClick={() => navigate('/interview')} 
                className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 px-6 py-3 rounded-lg transition-colors flex items-center justify-center"
              >
                <ArrowLeft className="h-5 w-5 mr-2" />
                New Interview
              </button>
              
              <button 
                onClick={handleDownloadResults} 
                className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 px-6 py-3 rounded-lg transition-colors flex items-center justify-center"
              >
                <Download className="h-5 w-5 mr-2" />
                Download Results
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default Results;