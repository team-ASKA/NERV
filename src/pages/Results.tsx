import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ArrowLeft, Download } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

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
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center mb-8">
          <button 
            onClick={() => navigate('/dashboard')} 
            className="mr-4 p-2 rounded-full hover:bg-gray-800 transition-colors"
          >
            <ArrowLeft className="h-6 w-6" />
          </button>
          <h1 className="text-2xl font-bold">Interview Results</h1>
        </div>
        
        {isLoading ? (
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
          </div>
        ) : error ? (
          <div className="bg-red-900/30 border border-red-500/50 rounded-lg p-4 mb-6">
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
            <div className="bg-gray-800 rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4 text-blue-400">Interview Summary</h2>
              <div className="prose prose-invert max-w-none">
                <ReactMarkdown>{results.summary || "No summary available"}</ReactMarkdown>
              </div>
            </div>
            
            {/* Transcriptions Section */}
            <div className="bg-gray-800 rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4 text-blue-400">Your Responses</h2>
              {results.transcriptions && results.transcriptions.length > 0 ? (
                <div className="space-y-4">
                  {results.transcriptions.map((text, index) => (
                    <div key={index} className="bg-gray-700/50 p-4 rounded-lg">
                      <p className="text-gray-300">{text}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-400">No transcriptions available</p>
              )}
            </div>
            
            {/* Emotional Analysis Section */}
            <div className="bg-gray-800 rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4 text-blue-400">Emotional Analysis</h2>
              {results.emotionsData && results.emotionsData.length > 0 ? (
                <div className="space-y-6">
                  {results.emotionsData.map((item, index) => (
                    <div key={index} className="border-b border-gray-700 pb-4 last:border-0">
                      <h3 className="font-medium text-gray-300 mb-2">Question: {item.question}</h3>
                      <p className="text-gray-400 mb-3">Your answer: {item.answer}</p>
                      
                      <div className="mt-2">
                        <h4 className="text-sm text-gray-400 mb-2">Top Emotions:</h4>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                          {item.emotions && Array.isArray(item.emotions) && item.emotions.length > 0 ? 
                            item.emotions.slice(0, 6).map((emotion, idx) => (
                              <div key={idx} className="bg-gray-700/30 rounded p-2 flex justify-between">
                                <span className="capitalize">{emotion.name || 'Unknown'}</span>
                                <span className="text-blue-400">{((emotion.score || 0) * 100).toFixed(0)}%</span>
                              </div>
                            )) : (
                              <div className="col-span-3 text-gray-400">No emotion data available</div>
                            )
                          }
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
            <div className="flex justify-between">
              <button 
                onClick={() => navigate('/interview')} 
                className="bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg transition-colors flex items-center"
              >
                <ArrowLeft className="h-5 w-5 mr-2" />
                New Interview
              </button>
              
              <button 
                onClick={handleDownloadResults} 
                className="bg-green-600 hover:bg-green-700 px-6 py-3 rounded-lg transition-colors flex items-center"
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