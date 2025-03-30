import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, BarChart, Brain, MessageSquare, User } from 'lucide-react';
import { generateResultsAnalysis, getEmotionData } from '../services/geminiService';

const Results = () => {
  const navigate = useNavigate();
  const [analysis, setAnalysis] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'summary' | 'emotions' | 'transcript'>('summary');
  const emotionData = getEmotionData();

  useEffect(() => {
    const fetchAnalysis = async () => {
      try {
        const results = await generateResultsAnalysis();
        setAnalysis(results);
      } catch (error) {
        console.error('Error generating results analysis:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchAnalysis();
  }, []);

  const renderEmotionChart = (emotions: any[]) => {
    if (!emotions || emotions.length === 0) {
      return <p className="text-gray-400">No emotion data available</p>;
    }

    // Sort emotions by score
    const sortedEmotions = [...emotions].sort((a, b) => b.score - a.score).slice(0, 5);

    return (
      <div className="space-y-2">
        {sortedEmotions.map((emotion, index) => (
          <div key={index} className="flex items-center gap-2">
            <span className="text-sm w-24 capitalize">{emotion.name}:</span>
            <div className="flex-1 bg-black/30 rounded-full h-2">
              <div 
                className="bg-white h-2 rounded-full" 
                style={{ width: `${emotion.score * 100}%` }}
              ></div>
            </div>
            <span className="text-sm w-12 text-right">{(emotion.score * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center mb-8">
          <button 
            onClick={() => navigate('/dashboard')}
            className="mr-4 p-2 rounded-full hover:bg-white/10"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-2xl font-bold">Interview Results</h1>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-white"></div>
          </div>
        ) : (
          <>
            <div className="bg-white/5 border border-white/10 rounded-xl p-6 mb-6">
              <h2 className="text-xl font-semibold mb-4">Overall Assessment</h2>
              <p className="text-gray-300">{analysis?.overallAssessment || "Analysis not available"}</p>
            </div>

            <div className="flex border-b border-white/10 mb-6">
              <button 
                className={`px-4 py-2 ${activeTab === 'summary' ? 'border-b-2 border-white' : 'text-gray-400'}`}
                onClick={() => setActiveTab('summary')}
              >
                <div className="flex items-center gap-2">
                  <BarChart className="h-4 w-4" />
                  <span>Detailed Analysis</span>
                </div>
              </button>
              <button 
                className={`px-4 py-2 ${activeTab === 'emotions' ? 'border-b-2 border-white' : 'text-gray-400'}`}
                onClick={() => setActiveTab('emotions')}
              >
                <div className="flex items-center gap-2">
                  <Brain className="h-4 w-4" />
                  <span>Emotional Analysis</span>
                </div>
              </button>
              <button 
                className={`px-4 py-2 ${activeTab === 'transcript' ? 'border-b-2 border-white' : 'text-gray-400'}`}
                onClick={() => setActiveTab('transcript')}
              >
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  <span>Transcript</span>
                </div>
              </button>
            </div>

            {activeTab === 'summary' && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="space-y-6"
              >
                <div className="bg-white/5 border border-white/10 rounded-xl p-6">
                  <h3 className="text-lg font-medium mb-3">Technical Strengths</h3>
                  <ul className="list-disc list-inside space-y-2 text-gray-300">
                    {analysis?.technicalStrengths?.map((strength: string, index: number) => (
                      <li key={index}>{strength}</li>
                    )) || <li>No data available</li>}
                  </ul>
                </div>

                <div className="bg-white/5 border border-white/10 rounded-xl p-6">
                  <h3 className="text-lg font-medium mb-3">Communication Skills</h3>
                  <p className="text-gray-300">{analysis?.communicationSkills || "No data available"}</p>
                </div>

                <div className="bg-white/5 border border-white/10 rounded-xl p-6">
                  <h3 className="text-lg font-medium mb-3">Areas for Improvement</h3>
                  <ul className="list-disc list-inside space-y-2 text-gray-300">
                    {analysis?.areasForImprovement?.map((area: string, index: number) => (
                      <li key={index}>{area}</li>
                    )) || <li>No data available</li>}
                  </ul>
                </div>

                <div className="bg-white/5 border border-white/10 rounded-xl p-6">
                  <h3 className="text-lg font-medium mb-3">Emotional Intelligence</h3>
                  <p className="text-gray-300">{analysis?.emotionalIntelligenceObservations || "No data available"}</p>
                </div>
              </motion.div>
            )}

            {activeTab === 'emotions' && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="space-y-6"
              >
                {emotionData.length > 0 ? (
                  emotionData.map((data, index) => (
                    <div key={index} className="bg-white/5 border border-white/10 rounded-xl p-6">
                      <h3 className="text-lg font-medium mb-3">Question {index + 1}</h3>
                      <p className="text-gray-300 mb-4">{data.question}</p>
                      <h4 className="text-sm font-medium mb-2 text-gray-400">Emotional Response:</h4>
                      {renderEmotionChart(data.emotions)}
                    </div>
                  ))
                ) : (
                  <div className="bg-white/5 border border-white/10 rounded-xl p-6">
                    <p className="text-gray-400">No emotion data available</p>
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'transcript' && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="bg-white/5 border border-white/10 rounded-xl p-6"
              >
                <h3 className="text-lg font-medium mb-3">Interview Transcript</h3>
                <div className="space-y-4 mt-4">
                  {/* This would ideally come from stored messages in a context or service */}
                  <p className="text-gray-400 italic">
                    Transcript feature coming soon. This will show the full conversation between you and the AI interviewer.
                  </p>
                  
                  {/* Example of what the transcript would look like */}
                  <div className="opacity-50">
                    <div className="flex items-start gap-3 mb-4">
                      <div className="bg-white/10 rounded-full p-2 mt-1">
                        <User className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm text-gray-400">You</p>
                        <p className="text-gray-300">Sample candidate response would appear here.</p>
                      </div>
                    </div>
                    
                    <div className="flex items-start gap-3">
                      <div className="bg-white/10 rounded-full p-2 mt-1">
                        <MessageSquare className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm text-gray-400">NERV</p>
                        <p className="text-gray-300">Sample interviewer question or feedback would appear here.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            <div className="mt-8 flex justify-end">
              <button 
                className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
                onClick={() => {
                  // This would generate and download a PDF report in a real implementation
                  alert('Report download feature coming soon!');
                }}
              >
                <Download className="h-4 w-4" />
                <span>Download Report</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Results;