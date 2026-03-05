import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Download, X, BarChart3, TrendingUp, Brain, Eye, MessageSquare } from 'lucide-react';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'ai';
  timestamp: Date;
}

interface UserExpression {
  isConfident: boolean;
  isNervous: boolean;
  isStruggling: boolean;
  dominantEmotion: string;
  confidenceScore: number;
}

interface ResumeData {
  skills: string[];
  projects: string[];
  achievements: string[];
  experience: string[];
  education: string[];
}

const EnhancedInterviewSummary: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const summary = (location.state as any)?.summary || '';
  const messages = ((location.state as any)?.messages || []) as Message[];
  const questionExpressions = ((location.state as any)?.questionExpressions || new Map()) as Map<string, UserExpression>;
  const resumeData = (location.state as any)?.resumeData as ResumeData | null;
  const roundDuration = (location.state as any)?.roundDuration || 3;

  const [activeTab, setActiveTab] = useState<'overview' | 'transcript' | 'emotions' | 'skills'>('overview');

  // Calculate statistics
  const totalQuestions = messages.filter((m: Message) => m.sender === 'ai').length;
  const totalResponses = messages.filter((m: Message) => m.sender === 'user').length;
  const avgConfidence = Array.from(questionExpressions.values())
    .reduce((sum: number, expr: UserExpression) => sum + expr.confidenceScore, 0) / questionExpressions.size || 0;

  const confidentQuestions = Array.from(questionExpressions.values())
    .filter((expr: UserExpression) => expr.isConfident).length;
  const nervousQuestions = Array.from(questionExpressions.values())
    .filter((expr: UserExpression) => expr.isNervous).length;

  // Emotion distribution
  const emotionCounts = Array.from(questionExpressions.values())
    .reduce((acc: Record<string, number>, expr: UserExpression) => {
      acc[expr.dominantEmotion] = (acc[expr.dominantEmotion] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

  const downloadSummary = () => {
    const summaryText = `
ENHANCED INTERVIEW SUMMARY REPORT
================================

${summary}

EXPRESSION ANALYSIS BY QUESTION
===============================
${Array.from(questionExpressions.entries()).map(([questionId, expression]: [string, UserExpression]) => `
Question ID: ${questionId}
- Confident: ${expression.isConfident ? 'Yes' : 'No'}
- Nervous: ${expression.isNervous ? 'Yes' : 'No'}
- Struggling: ${expression.isStruggling ? 'Yes' : 'No'}
- Dominant Emotion: ${expression.dominantEmotion}
- Confidence Score: ${expression.confidenceScore}
`).join('\n')}

RESUME ANALYSIS
===============
Skills: ${resumeData?.skills?.join(', ') || 'Not available'}
Projects: ${resumeData?.projects?.join(', ') || 'Not available'}
Achievements: ${resumeData?.achievements?.join(', ') || 'Not available'}

INTERVIEW STATISTICS
====================
Total Questions: ${totalQuestions}
Total Responses: ${totalResponses}
Average Confidence: ${avgConfidence.toFixed(2)}
Confident Questions: ${confidentQuestions}
Nervous Questions: ${nervousQuestions}
Round Duration: ${roundDuration} minutes per round
    `;

    const blob = new Blob([summaryText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `interview-summary-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const tabs = [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'transcript', label: 'Transcript', icon: MessageSquare },
    { id: 'emotions', label: 'Emotions', icon: Eye },
    { id: 'skills', label: 'Skills', icon: Brain }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 text-white">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => navigate('/dashboard')}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              <ArrowLeft className="h-6 w-6" />
            </button>
            <div>
              <h1 className="text-3xl font-bold">Interview Summary</h1>
              <p className="text-gray-300">Comprehensive analysis of your interview performance</p>
            </div>
          </div>
          <button
            onClick={downloadSummary}
            className="flex items-center space-x-2 bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg transition-colors"
          >
            <Download className="h-5 w-5" />
            <span>Download Report</span>
          </button>
        </div>

        {/* Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-300 text-sm">Total Questions</p>
                <p className="text-2xl font-bold">{totalQuestions}</p>
              </div>
              <MessageSquare className="h-8 w-8 text-blue-400" />
            </div>
          </div>

          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-300 text-sm">Avg Confidence</p>
                <p className="text-2xl font-bold">{(avgConfidence * 100).toFixed(0)}%</p>
              </div>
              <TrendingUp className="h-8 w-8 text-green-400" />
            </div>
          </div>

          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-300 text-sm">Confident Responses</p>
                <p className="text-2xl font-bold">{confidentQuestions}</p>
              </div>
              <Brain className="h-8 w-8 text-purple-400" />
            </div>
          </div>

          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-300 text-sm">Duration</p>
                <p className="text-2xl font-bold">{roundDuration * 3}m</p>
              </div>
              <BarChart3 className="h-8 w-8 text-orange-400" />
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 mb-8">
          <div className="flex space-x-1 mb-6">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors ${activeTab === tab.id
                    ? 'bg-white/20 text-white'
                    : 'text-gray-300 hover:text-white hover:bg-white/10'
                    }`}
                >
                  <Icon className="h-5 w-5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Tab Content */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="prose prose-invert max-w-none">
                <div dangerouslySetInnerHTML={{ __html: summary.replace(/\n/g, '<br>') }} />
              </div>

              {/* Emotion Distribution Chart */}
              <div className="mt-8">
                <h3 className="text-xl font-semibold mb-4">Emotion Distribution</h3>
                <div className="space-y-2">
                  {Object.entries(emotionCounts).map(([emotion, count]: [string, number]) => (
                    <div key={emotion} className="flex items-center justify-between">
                      <span className="capitalize">{emotion}</span>
                      <div className="flex items-center space-x-2">
                        <div className="w-32 bg-gray-700 rounded-full h-2">
                          <div
                            className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full"
                            style={{ width: `${(count / totalQuestions) * 100}%` }}
                          />
                        </div>
                        <span className="text-sm text-gray-300">{count}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'transcript' && (
            <div className="space-y-4 max-h-96 overflow-y-auto">
              {messages.map((message: Message) => (
                <div
                  key={message.id}
                  className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] p-4 rounded-lg ${message.sender === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white/10 text-white'
                      }`}
                  >
                    <div className="prose prose-invert max-w-none">
                      <div dangerouslySetInnerHTML={{ __html: message.text.replace(/\n/g, '<br>') }} />
                    </div>
                    <div className="text-xs opacity-70 mt-2">
                      {message.timestamp.toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'emotions' && (
            <div className="space-y-6">
              <h3 className="text-xl font-semibold">Question-by-Question Emotion Analysis</h3>
              <div className="space-y-4">
                {Array.from(questionExpressions.entries()).map(([questionId, expression]: [string, UserExpression], index: number) => (
                  <div key={questionId} className="bg-white/5 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium">Question {index + 1}</span>
                      <span className="text-sm text-gray-400">{questionId}</span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div className="flex items-center space-x-2">
                        <div className={`w-3 h-3 rounded-full ${expression.isConfident ? 'bg-green-500' : 'bg-red-500'}`} />
                        <span>Confident: {expression.isConfident ? 'Yes' : 'No'}</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <div className={`w-3 h-3 rounded-full ${expression.isNervous ? 'bg-yellow-500' : 'bg-gray-500'}`} />
                        <span>Nervous: {expression.isNervous ? 'Yes' : 'No'}</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <div className={`w-3 h-3 rounded-full ${expression.isStruggling ? 'bg-orange-500' : 'bg-gray-500'}`} />
                        <span>Struggling: {expression.isStruggling ? 'Yes' : 'No'}</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <span className="capitalize">{expression.dominantEmotion}</span>
                        <span className="text-gray-400">({(expression.confidenceScore * 100).toFixed(0)}%)</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'skills' && resumeData && (
            <div className="space-y-6">
              <h3 className="text-xl font-semibold">Resume Skills Analysis</h3>

              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h4 className="text-lg font-medium mb-4">Your Skills</h4>
                  <div className="flex flex-wrap gap-2">
                    {resumeData.skills.map((skill: any, index: number) => (
                      <span key={index} className="bg-blue-600 text-white px-3 py-1 rounded-full text-sm">
                        {typeof skill === 'string' ? skill : JSON.stringify(skill)}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="text-lg font-medium mb-4">Your Projects</h4>
                  <div className="space-y-2">
                    {resumeData.projects.map((project: any, index: number) => (
                      <div key={index} className="text-sm text-gray-300 bg-white/5 p-3 rounded-lg">
                        • {typeof project === 'string' ? project : JSON.stringify(project)}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {resumeData.achievements.length > 0 && (
                <div className="mt-6">
                  <h4 className="text-lg font-medium mb-4">Your Achievements</h4>
                  <div className="space-y-2">
                    {resumeData.achievements.map((achievement: any, index: number) => (
                      <div key={index} className="text-sm text-gray-300 bg-white/5 p-3 rounded-lg">
                        • {typeof achievement === 'string' ? achievement : JSON.stringify(achievement)}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Skill Gap Analysis */}
              <div className="mt-8">
                <h4 className="text-lg font-medium mb-4">Skill Gap Analysis</h4>
                <div className="bg-white/5 rounded-lg p-6">
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <h5 className="font-medium mb-3 text-green-400">Strengths</h5>
                      <ul className="space-y-2 text-sm">
                        <li>• Strong technical foundation</li>
                        <li>• Good problem-solving approach</li>
                        <li>• Effective communication skills</li>
                        <li>• Adaptable to different question types</li>
                      </ul>
                    </div>
                    <div>
                      <h5 className="font-medium mb-3 text-orange-400">Areas for Improvement</h5>
                      <ul className="space-y-2 text-sm">
                        <li>• Practice more complex algorithms</li>
                        <li>• Improve time management</li>
                        <li>• Work on system design concepts</li>
                        <li>• Enhance confidence in technical discussions</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EnhancedInterviewSummary;



