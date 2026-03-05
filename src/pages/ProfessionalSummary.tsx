import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import { 
  TrendingUp, TrendingDown, Brain, Target, BookOpen, 
  Award, Users, Clock, Download, ArrowLeft, Star,
  CheckCircle, AlertCircle, Lightbulb, BarChart3
} from 'lucide-react';
import { apiService } from '../services/apiService';

interface EmotionData {
  questionId: string;
  emotion: string;
  confidence: number;
  isConfident: boolean;
  isStruggling: boolean;
}

interface ResumeData {
  skills: string[];
  projects: any[];
  achievements: string[];
  experience: string[];
  education: string[];
}

interface SummaryData {
  technicalHistory: any;
  projectHistory: any;
  hrHistory: any;
  resumeData: ResumeData;
  questionExpressions: Map<string, any>;
  roundDuration: number;
}

const ProfessionalSummary: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [summary, setSummary] = useState<string>('');
  const [emotionData, setEmotionData] = useState<EmotionData[]>([]);
  const [skillGaps, setSkillGaps] = useState<any[]>([]);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [resources, setResources] = useState<any[]>([]);

  const data: SummaryData = location.state;

  useEffect(() => {
    if (data) {
      generateSummary();
    }
  }, [data]);

  const generateSummary = async () => {
    try {
      setIsLoading(true);
      
      // Convert Map to array for emotion data
      const emotions = Array.from(data.questionExpressions.entries()).map(([qId, expr]) => ({
        questionId: qId,
        emotion: expr.dominantEmotion,
        confidence: expr.confidenceScore,
        isConfident: expr.isConfident,
        isStruggling: expr.isStruggling
      }));
      
      setEmotionData(emotions);
      
      // Generate skill gaps analysis
      const gaps = analyzeSkillGaps(data.resumeData, emotions);
      setSkillGaps(gaps);
      
      // Generate recommendations
      const recs = generateRecommendations(emotions, gaps);
      setRecommendations(recs);
      
      // Generate resources
      const res = generateResources(gaps);
      setResources(res);
      
      // Generate comprehensive summary
      const summaryText = await generateComprehensiveSummary();
      setSummary(summaryText);
      
    } catch (error) {
      console.error('Error generating summary:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const analyzeSkillGaps = (resume: ResumeData, emotions: EmotionData[]) => {
    const gaps = [];
    const avgConfidence = emotions.reduce((sum, e) => sum + e.confidence, 0) / emotions.length;
    
    // Technical skills gap
    if (avgConfidence < 0.6) {
      gaps.push({
        category: 'Technical Problem Solving',
        level: 'Needs Improvement',
        description: 'Confidence in technical discussions was below average',
        impact: 'High',
        color: 'red'
      });
    }
    
    // Communication gap
    const strugglingQuestions = emotions.filter(e => e.isStruggling).length;
    if (strugglingQuestions > emotions.length * 0.3) {
      gaps.push({
        category: 'Communication',
        level: 'Needs Improvement',
        description: 'Difficulty expressing technical concepts clearly',
        impact: 'Medium',
        color: 'orange'
      });
    }
    
    // Project experience gap
    if (!resume.projects || resume.projects.length < 2) {
      gaps.push({
        category: 'Project Experience',
        level: 'Needs Improvement',
        description: 'Limited project portfolio demonstrated',
        impact: 'High',
        color: 'red'
      });
    }
    
    return gaps;
  };

  const generateRecommendations = (emotions: EmotionData[], gaps: any[]) => {
    const recs = [];
    
    // Technical recommendations
    if (gaps.some(g => g.category === 'Technical Problem Solving')) {
      recs.push({
        title: 'Improve Technical Problem Solving',
        description: 'Practice DSA problems and system design concepts',
        priority: 'High',
        icon: Brain
      });
    }
    
    // Communication recommendations
    if (gaps.some(g => g.category === 'Communication')) {
      recs.push({
        title: 'Enhance Communication Skills',
        description: 'Practice explaining technical concepts to non-technical audiences',
        priority: 'Medium',
        icon: Users
      });
    }
    
    // Project recommendations
    if (gaps.some(g => g.category === 'Project Experience')) {
      recs.push({
        title: 'Build More Projects',
        description: 'Create diverse projects showcasing different technologies',
        priority: 'High',
        icon: Target
      });
    }
    
    return recs;
  };

  const generateResources = (gaps: any[]) => {
    const resources = [];
    
    if (gaps.some(g => g.category === 'Technical Problem Solving')) {
      resources.push({
        title: 'LeetCode',
        description: 'Practice coding problems',
        url: 'https://leetcode.com',
        type: 'Platform'
      });
      resources.push({
        title: 'System Design Interview',
        description: 'Learn system design concepts',
        url: 'https://www.educative.io/courses/grokking-the-system-design-interview',
        type: 'Course'
      });
    }
    
    if (gaps.some(g => g.category === 'Communication')) {
      resources.push({
        title: 'Toastmasters',
        description: 'Improve public speaking skills',
        url: 'https://www.toastmasters.org',
        type: 'Community'
      });
    }
    
    resources.push({
      title: 'GitHub',
      description: 'Showcase your projects',
      url: 'https://github.com',
      type: 'Platform'
    });
    
    return resources;
  };

  const generateComprehensiveSummary = async () => {
    try {
      // Try to get conversation histories (this would need conversation IDs)
      // For now, generate a local comprehensive summary
      const emotions = Array.from(data.questionExpressions.values());
      const avgConfidence = emotions.length > 0 ? 
        emotions.reduce((sum, expr) => sum + expr.confidenceScore, 0) / emotions.length : 0;
      
      const totalQuestions = emotions.length;
      const confidentQuestions = emotions.filter(e => e.isConfident).length;
      const strugglingQuestions = emotions.filter(e => e.isStruggling).length;
      
      return `
# 🎯 Interview Performance Report

## 📊 Executive Summary
- **Overall Performance**: ${avgConfidence > 0.7 ? 'Excellent' : avgConfidence > 0.5 ? 'Good' : 'Needs Improvement'}
- **Confidence Score**: ${(avgConfidence * 100).toFixed(1)}%
- **Total Questions**: ${totalQuestions}
- **Confident Responses**: ${confidentQuestions} (${((confidentQuestions/totalQuestions)*100).toFixed(1)}%)
- **Struggling Responses**: ${strugglingQuestions} (${((strugglingQuestions/totalQuestions)*100).toFixed(1)}%)

## 🧠 Technical Performance
- **DSA Knowledge**: ${avgConfidence > 0.6 ? 'Strong' : 'Needs Practice'}
- **Problem Solving**: ${avgConfidence > 0.5 ? 'Good' : 'Requires Improvement'}
- **Communication**: ${strugglingQuestions < totalQuestions * 0.3 ? 'Clear' : 'Needs Work'}

## 🎯 Key Strengths
${avgConfidence > 0.6 ? '- Strong technical foundation' : ''}
${confidentQuestions > strugglingQuestions ? '- Good confidence in responses' : ''}
${data.resumeData?.projects?.length > 2 ? '- Solid project portfolio' : ''}

## 🔧 Areas for Improvement
${avgConfidence < 0.6 ? '- Technical problem-solving skills' : ''}
${strugglingQuestions > totalQuestions * 0.3 ? '- Communication clarity' : ''}
${!data.resumeData?.projects || data.resumeData.projects.length < 2 ? '- Project experience' : ''}

## 📈 Recommendations
1. **Practice DSA Problems**: Focus on arrays, strings, and dynamic programming
2. **System Design**: Learn about scalability and distributed systems
3. **Communication**: Practice explaining technical concepts clearly
4. **Projects**: Build diverse projects showcasing different technologies

## 🎓 Next Steps
- Complete 50+ LeetCode problems
- Build 2-3 full-stack projects
- Practice mock interviews
- Join technical communities
      `.trim();
    } catch (error) {
      console.error('Error generating summary:', error);
      return 'Summary generation failed. Please try again.';
    }
  };

  const getEmotionColor = (emotion: string) => {
    const colors: { [key: string]: string } = {
      'Confidence': 'text-green-400',
      'Concentration': 'text-blue-400',
      'Calmness': 'text-blue-300',
      'Interest': 'text-purple-400',
      'Doubt': 'text-yellow-400',
      'Confusion': 'text-orange-400',
      'Frustration': 'text-red-400',
      'Boredom': 'text-gray-400'
    };
    return colors[emotion] || 'text-gray-400';
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'High': return 'text-red-400 bg-red-900/20';
      case 'Medium': return 'text-yellow-400 bg-yellow-900/20';
      case 'Low': return 'text-green-400 bg-green-900/20';
      default: return 'text-gray-400 bg-gray-900/20';
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-white mx-auto mb-4"></div>
          <h2 className="text-2xl font-bold text-white mb-2">Generating Your Report</h2>
          <p className="text-gray-300">Analyzing your interview performance...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Header */}
      <div className="bg-black/20 backdrop-blur-sm border-b border-white/10 p-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => navigate('/dashboard')}
              className="flex items-center space-x-2 text-white/70 hover:text-white transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
              <span>Back to Dashboard</span>
            </button>
          </div>
          <div className="flex items-center space-x-4">
            <button
              onClick={() => {
                const element = document.createElement('a');
                const file = new Blob([summary], { type: 'text/markdown' });
                element.href = URL.createObjectURL(file);
                element.download = 'interview-summary.md';
                element.click();
              }}
              className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              <Download className="h-4 w-4" />
              <span>Download Report</span>
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6">
        {/* Performance Overview */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8"
        >
          <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <Brain className="h-8 w-8 text-blue-400" />
              <TrendingUp className="h-5 w-5 text-green-400" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Overall Performance</h3>
            <p className="text-3xl font-bold text-white">
              {emotionData.length > 0 ? 
                ((emotionData.reduce((sum, e) => sum + e.confidence, 0) / emotionData.length) * 100).toFixed(1) + '%' : 
                'N/A'
              }
            </p>
            <p className="text-sm text-gray-400 mt-2">Confidence Score</p>
          </div>

          <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <Target className="h-8 w-8 text-purple-400" />
              <CheckCircle className="h-5 w-5 text-green-400" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Questions Answered</h3>
            <p className="text-3xl font-bold text-white">{emotionData.length}</p>
            <p className="text-sm text-gray-400 mt-2">Total Questions</p>
          </div>

          <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <Star className="h-8 w-8 text-yellow-400" />
              <TrendingUp className="h-5 w-5 text-green-400" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Confident Responses</h3>
            <p className="text-3xl font-bold text-white">
              {emotionData.filter(e => e.isConfident).length}
            </p>
            <p className="text-sm text-gray-400 mt-2">High Confidence</p>
          </div>

          <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <AlertCircle className="h-8 w-8 text-orange-400" />
              <TrendingDown className="h-5 w-5 text-red-400" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Struggling Areas</h3>
            <p className="text-3xl font-bold text-white">
              {emotionData.filter(e => e.isStruggling).length}
            </p>
            <p className="text-sm text-gray-400 mt-2">Need Improvement</p>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Emotion Analysis */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10"
          >
            <h3 className="text-xl font-semibold text-white mb-6 flex items-center">
              <Brain className="h-6 w-6 mr-3 text-blue-400" />
              Emotion Analysis
            </h3>
            
            <div className="space-y-4">
              {emotionData.map((emotion, index) => (
                <div key={index} className="flex items-center justify-between p-4 bg-white/5 rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className={`w-3 h-3 rounded-full ${
                      emotion.isConfident ? 'bg-green-400' : 
                      emotion.isStruggling ? 'bg-red-400' : 'bg-yellow-400'
                    }`} />
                    <span className="text-white font-medium">Q{index + 1}</span>
                  </div>
                  <div className="flex items-center space-x-4">
                    <span className={`text-sm ${getEmotionColor(emotion.emotion)}`}>
                      {emotion.emotion}
                    </span>
                    <div className="w-20 bg-gray-700 rounded-full h-2">
                      <div 
                        className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${emotion.confidence * 100}%` }}
                      />
                    </div>
                    <span className="text-white text-sm w-12 text-right">
                      {(emotion.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Skill Gaps */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10"
          >
            <h3 className="text-xl font-semibold text-white mb-6 flex items-center">
              <BarChart3 className="h-6 w-6 mr-3 text-purple-400" />
              Skill Gap Analysis
            </h3>
            
            <div className="space-y-4">
              {skillGaps.map((gap, index) => (
                <div key={index} className="p-4 bg-white/5 rounded-lg border-l-4 border-red-400">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-white font-semibold">{gap.category}</h4>
                    <span className={`px-2 py-1 rounded-full text-xs ${getPriorityColor(gap.level)}`}>
                      {gap.level}
                    </span>
                  </div>
                  <p className="text-gray-300 text-sm mb-2">{gap.description}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">Impact: {gap.impact}</span>
                    <div className="flex space-x-1">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <div
                          key={i}
                          className={`w-2 h-2 rounded-full ${
                            i < (gap.impact === 'High' ? 3 : gap.impact === 'Medium' ? 2 : 1) 
                              ? 'bg-red-400' : 'bg-gray-600'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Recommendations */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10"
          >
            <h3 className="text-xl font-semibold text-white mb-6 flex items-center">
              <Lightbulb className="h-6 w-6 mr-3 text-yellow-400" />
              Recommendations
            </h3>
            
            <div className="space-y-4">
              {recommendations.map((rec, index) => {
                const IconComponent = rec.icon;
                return (
                  <div key={index} className="flex items-start space-x-4 p-4 bg-white/5 rounded-lg">
                    <IconComponent className="h-6 w-6 text-blue-400 mt-1 flex-shrink-0" />
                    <div className="flex-1">
                      <h4 className="text-white font-semibold mb-1">{rec.title}</h4>
                      <p className="text-gray-300 text-sm mb-2">{rec.description}</p>
                      <span className={`px-2 py-1 rounded-full text-xs ${getPriorityColor(rec.priority)}`}>
                        {rec.priority} Priority
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>

          {/* Resources */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10"
          >
            <h3 className="text-xl font-semibold text-white mb-6 flex items-center">
              <BookOpen className="h-6 w-6 mr-3 text-green-400" />
              Learning Resources
            </h3>
            
            <div className="space-y-4">
              {resources.map((resource, index) => (
                <div key={index} className="p-4 bg-white/5 rounded-lg hover:bg-white/10 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-white font-semibold">{resource.title}</h4>
                    <span className="px-2 py-1 bg-blue-900/30 text-blue-300 rounded-full text-xs">
                      {resource.type}
                    </span>
                  </div>
                  <p className="text-gray-300 text-sm mb-3">{resource.description}</p>
                  <a
                    href={resource.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center text-blue-400 hover:text-blue-300 text-sm transition-colors"
                  >
                    Visit Resource →
                  </a>
                </div>
              ))}
            </div>
          </motion.div>
        </div>

        {/* Detailed Summary */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-8 bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10"
        >
          <h3 className="text-xl font-semibold text-white mb-6 flex items-center">
            <Award className="h-6 w-6 mr-3 text-yellow-400" />
            Detailed Performance Report
          </h3>
          
          <div className="prose prose-invert max-w-none">
            <pre className="whitespace-pre-wrap text-gray-300 text-sm leading-relaxed">
              {summary}
            </pre>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default ProfessionalSummary;



