import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Download, X } from 'lucide-react';

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

const InterviewSummary: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  
  const summary = location.state?.summary || '';
  const messages = location.state?.messages || [];
  const questionExpressions = location.state?.questionExpressions || new Map();
  const resumeData = location.state?.resumeData || null;
  const roundDuration = location.state?.roundDuration || 3;

  const downloadSummary = () => {
    const summaryText = `
INTERVIEW SUMMARY REPORT
========================

${summary}

EXPRESSION ANALYSIS BY QUESTION
===============================
${Array.from(questionExpressions.entries()).map(([questionId, expression]) => `
Question ID: ${questionId}
- Confident: ${expression.isConfident ? 'Yes' : 'No'}
- Nervous: ${expression.isNervous ? 'Yes' : 'No'}
- Struggling: ${expression.isStruggling ? 'Yes' : 'No'}
- Dominant Emotion: ${expression.dominantEmotion}
- Confidence Score: ${expression.confidenceScore}
`).join('\n')}

RESUME SKILLS ANALYSIS
=====================
Skills: ${resumeData?.skills.join(', ') || 'N/A'}
Projects: ${resumeData?.projects.join(', ') || 'N/A'}
Achievements: ${resumeData?.achievements.join(', ') || 'N/A'}

INTERVIEW TRANSCRIPT
===================
${messages.map(msg => `${msg.sender.toUpperCase()}: ${msg.text}`).join('\n\n')}
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

  return (
    <div className="min-h-screen bg-primary text-white p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => navigate('/dashboard')}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
              title="Back to dashboard"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <h1 className="text-3xl font-bold">Interview Summary Report</h1>
          </div>
          
          <button
            onClick={downloadSummary}
            className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
          >
            <Download className="h-4 w-4" />
            <span>Download Report</span>
          </button>
        </div>

        {/* Summary Content */}
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-8 mb-8">
          <h2 className="text-2xl font-semibold mb-6">Complete Interview Analysis</h2>
          
          <div className="prose prose-invert max-w-none">
            <div className="whitespace-pre-wrap text-gray-300 leading-relaxed">
              {summary || 'Generating summary...'}
            </div>
          </div>
        </div>

        {/* Expression Analysis */}
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-8 mb-8">
          <h3 className="text-xl font-semibold mb-6">Expression Analysis by Question</h3>
          
          <div className="space-y-4">
            {Array.from(questionExpressions.entries()).map(([questionId, expression]) => (
              <div key={questionId} className="bg-white/5 rounded-lg p-4">
                <div className="text-sm text-gray-400 mb-3">Question ID: {questionId}</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div className="flex justify-between">
                    <span className="font-medium">Confident:</span>
                    <span className={expression.isConfident ? 'text-green-400' : 'text-red-400'}>
                      {expression.isConfident ? 'Yes' : 'No'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium">Nervous:</span>
                    <span className={expression.isNervous ? 'text-yellow-400' : 'text-green-400'}>
                      {expression.isNervous ? 'Yes' : 'No'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium">Struggling:</span>
                    <span className={expression.isStruggling ? 'text-red-400' : 'text-green-400'}>
                      {expression.isStruggling ? 'Yes' : 'No'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium">Dominant Emotion:</span>
                    <span className="capitalize text-blue-400">{expression.dominantEmotion}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Resume Skills Analysis & Skill Gap */}
        {resumeData && (
          <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-8 mb-8">
            <h3 className="text-xl font-semibold mb-6">Resume Skills Analysis & Skill Gap</h3>
            
            <div className="grid md:grid-cols-2 gap-8">
              <div>
                <h4 className="text-lg font-medium mb-4">Your Current Skills</h4>
                <div className="flex flex-wrap gap-2">
                  {resumeData.skills.map((skill, index) => (
                    <span key={index} className="bg-blue-600 text-white px-3 py-1 rounded-full text-sm">
                      {typeof skill === 'string' ? skill : JSON.stringify(skill)}
                    </span>
                  ))}
                </div>
              </div>
              
              <div>
                <h4 className="text-lg font-medium mb-4">Your Projects</h4>
                <div className="space-y-2">
                  {resumeData.projects.map((project, index) => (
                    <div key={index} className="text-sm text-gray-300 bg-white/5 p-3 rounded-lg">
                      • {typeof project === 'string' ? project : JSON.stringify(project)}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Skill Gap Analysis */}
            <div className="mt-8 p-6 bg-gradient-to-r from-yellow-500/20 to-orange-500/20 rounded-lg border border-yellow-500/30">
              <h4 className="text-lg font-semibold mb-4 text-yellow-300">Skill Gap Analysis</h4>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                  <span className="font-medium">Technical Skills (DSA)</span>
                  <span className="text-yellow-400">Needs Improvement</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                  <span className="font-medium">Core Subjects (DBMS, OOPS, OS)</span>
                  <span className="text-yellow-400">Basic Understanding</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                  <span className="font-medium">Communication Skills</span>
                  <span className="text-green-400">Good</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                  <span className="font-medium">Problem Solving</span>
                  <span className="text-yellow-400">Needs Practice</span>
                </div>
              </div>
              
              <div className="mt-4 p-4 bg-blue-500/20 rounded-lg">
                <h5 className="font-semibold text-blue-300 mb-2">Recommendations:</h5>
                <ul className="text-sm text-gray-300 space-y-1">
                  <li>• Practice more DSA problems on platforms like LeetCode</li>
                  <li>• Study database normalization and indexing concepts</li>
                  <li>• Review object-oriented programming principles</li>
                  <li>• Learn about system design patterns and scalability</li>
                </ul>
              </div>
            </div>

            {resumeData.achievements.length > 0 && (
              <div className="mt-6">
                <h4 className="text-lg font-medium mb-4">Your Achievements</h4>
                <div className="space-y-2">
                  {resumeData.achievements.map((achievement, index) => (
                    <div key={index} className="text-sm text-gray-300 bg-white/5 p-3 rounded-lg">
                      • {typeof achievement === 'string' ? achievement : JSON.stringify(achievement)}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Interview Transcript */}
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-8 mb-8">
          <h3 className="text-xl font-semibold mb-6">Interview Transcript</h3>
          
          <div className="space-y-4 max-h-96 overflow-y-auto">
            {messages.map((message) => (
              <div key={message.id} className="bg-white/5 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className={`font-medium ${message.sender === 'user' ? 'text-blue-400' : 'text-green-400'}`}>
                    {message.sender === 'user' ? 'You' : 'Interviewer'}
                  </span>
                  <span className="text-xs text-gray-400">
                    {message.timestamp.toLocaleTimeString()}
                  </span>
                </div>
                <div className="text-sm text-gray-300 whitespace-pre-wrap">
                  {message.text}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-center space-x-4">
          <button
            onClick={() => navigate('/multi-round-interview')}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
          >
            Start New Interview
          </button>
          
          <button
            onClick={() => navigate('/dashboard')}
            className="bg-gray-600 hover:bg-gray-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
};

export default InterviewSummary;
