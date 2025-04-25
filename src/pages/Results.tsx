import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ArrowLeft, Download, Brain, MessageSquare, Bot, User, ChevronLeft, ChevronRight, ArrowRight, BarChart2, AlertTriangle, CheckCircle2, ArrowUpRight, List, FileText, ExternalLink, Smile } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { FaVideo } from 'react-icons/fa';
import { motion } from 'framer-motion';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Bar } from 'react-chartjs-2';
import 'chart.js/auto';

// Define the interview type enum since the original file was deleted
enum InterviewRoundType {
  TECHNICAL = 'TECHNICAL',
  BEHAVIORAL = 'BEHAVIORAL',
  HR = 'HR'
}

interface EmotionData {
  name: string;
  score: number;
}

interface EmotionItem {
  question: string;
  answer: string;
  emotions: EmotionData[];
  timestamp: string;
  roundType?: InterviewRoundType;
  responseTime?: number;
  isFollowUp: boolean;
}

interface InterviewResults {
  id: string;
  summary?: string;
  emotionsData: EmotionItem[];
  transcriptions: string[];
  timestamp: string;
  roundType?: InterviewRoundType;
  rounds?: Record<InterviewRoundType, {
    summary?: string;
    emotionsData: EmotionItem[];
    transcriptions: string[];
  }>;
}

interface UserSkills {
  skills: string[];
  expertise: string[];
}

// New interfaces for the improvement plan agent
interface Resource {
  title: string;
  type: 'course' | 'book' | 'project' | 'article' | 'video';
  url?: string;
  description: string;
}

interface TimelineItem {
  duration: string;
  task: string;
  priority: 'high' | 'medium' | 'low';
}

interface CareerPath {
  role: string;
  level: 'entry' | 'mid' | 'senior';
  matchPercentage: number;
  requiredSkills: string[];
  description: string;
}

interface ImprovementPlan {
  skillGaps: string[];
  resources: Resource[];
  timeline: TimelineItem[];
  careerPaths: CareerPath[];
  summary: string;
  generatedAt: string;
}

// Helper function to group emotions data by interview round
const groupEmotionsByRound = (emotionsData: EmotionItem[]) => {
  // Initialize with the enum values as keys
  const grouped: Record<string, EmotionItem[]> = {
    [InterviewRoundType.TECHNICAL]: [],
    [InterviewRoundType.BEHAVIORAL]: [],
    [InterviewRoundType.HR]: [],
    'unspecified': []
  };
  
  emotionsData.forEach(item => {
    if (item.roundType) {
      grouped[item.roundType].push(item);
    } else {
      grouped['unspecified'].push(item);
    }
  });
  
  return grouped;
};

const Results = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [results, setResults] = useState<InterviewResults | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('summary');
  const [userSkills, setUserSkills] = useState<UserSkills>({ skills: [], expertise: [] });
  const [skillAnalysis, setSkillAnalysis] = useState<{
    matchedSkills: string[];
    missingSkills: string[];
    recommendedSkills: string[];
    overallScore: number;
    detailedSkillScores?: Record<string, {
      mentioned: boolean,
      confidenceScore: number,
      depthScore: number,
      overallScore: number,
      examples: boolean,
      technicalDetail: boolean
    }>;
    communicationMetrics?: {
      clarity: number;
      conciseness: number;
      complexity: number;
      structure: number;
    };
  }>({
    matchedSkills: [],
    missingSkills: [],
    recommendedSkills: [],
    overallScore: 0
  });
  // New state for the improvement plan
  const [improvementPlan, setImprovementPlan] = useState<ImprovementPlan | null>(null);
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [currentTranscriptPage, setCurrentTranscriptPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(5);
  const tabs = ["summary", "emotions", "transcript", "skills", "improvement"];
  const [selectedRound, setSelectedRound] = useState<InterviewRoundType | 'overall'>('overall');
  const [hasMultipleRounds, setHasMultipleRounds] = useState<boolean>(false);
  // Add a state variable for expanded items
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

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
            // DO NOT filter out answers to the same question - we want to see all interactions
            // Including follow-up questions and multiple responses
            
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
                timestamp: item.timestamp || new Date().toISOString(),
                responseTime: item.responseTime || 0,
                isFollowUp: item.isFollowUp || false
              };
            });
          } else {
            console.log("No emotions data array found, creating empty array");
            parsedResults.emotionsData = [];
          }
          
          // Ensure we have unique transcriptions but preserve order
          if (parsedResults.transcriptions && Array.isArray(parsedResults.transcriptions)) {
            // We want to keep all transcriptions for full history  
            // Just make sure they're valid strings
            parsedResults.transcriptions = parsedResults.transcriptions.filter((text: any) => 
              typeof text === 'string' && text.trim() !== ''
            );
          }
          
          setResults(parsedResults);
          
          // Check if this is a multi-round interview
          if (parsedResults.rounds && Object.keys(parsedResults.rounds).length > 0) {
            setHasMultipleRounds(true);
          }
        } else {
          console.log("No stored interview results found");
          
          // Try to build results from messages in localStorage
          const messagesString = localStorage.getItem('interviewMessages');
          if (messagesString) {
            try {
              const messages = JSON.parse(messagesString);
              
              if (Array.isArray(messages) && messages.length > 0) {
                console.log("Building results from messages:", messages.length, "messages found");
                
                // Extract questions and answers, including all follow-up questions
                const questionAnswerPairs: EmotionItem[] = [];
                let currentQuestion = "";
                
                messages.forEach((msg, index) => {
                  if (msg.sender === 'ai') {
                    currentQuestion = msg.text;
                  } else if (msg.sender === 'user' && currentQuestion && index > 0) {
                    const answer = msg.text;
                    
                    // Add all interactions, including follow-up responses
                    questionAnswerPairs.push({
                      question: currentQuestion,
                      answer: answer,
                      emotions: [], // Will be populated from emotionsData if available
                      timestamp: new Date(msg.timestamp).toISOString(),
                      responseTime: msg.responseTime || 0,
                      isFollowUp: index > 2 // Mark as follow-up if not the first interaction
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

  // New useEffect to fetch user skills from Firebase
  useEffect(() => {
    const fetchUserSkills = async () => {
      if (!currentUser) return;
      
      try {
        const userDocRef = doc(db, 'users', currentUser.uid);
        const userDoc = await getDoc(userDocRef);
        
        if (userDoc.exists()) {
          const userData = userDoc.data();
          setUserSkills({
            skills: userData.skills || [],
            expertise: userData.expertise || []
          });
        }
      } catch (error) {
        console.error('Error fetching user skills:', error);
      }
    };
    
    fetchUserSkills();
  }, [currentUser]);
  
  // New useEffect to analyze skill gaps when results and user skills are loaded
  useEffect(() => {
    if (!results || !results.emotionsData || !userSkills.skills.length) return;
    
    analyzeSkillGaps();
  }, [results, userSkills]);
  
  // New useEffect to generate improvement plan when skill analysis is completed
  useEffect(() => {
    if (skillAnalysis.missingSkills.length > 0 || skillAnalysis.recommendedSkills.length > 0) {
      generateImprovementPlan();
    }
  }, [skillAnalysis]);
  
  // Function to analyze skill gaps
  const analyzeSkillGaps = () => {
    if (!results || !results.emotionsData || !userSkills.skills.length) return;
    
    // Extract all text from answers for analysis
    const allAnswersText = results.emotionsData
      .map(item => item.answer?.toLowerCase() || '')
      .join(' ');
    
    // Analyze the depth of knowledge, not just mentions
    const skillAnalysisResults: Record<string, {
      mentioned: boolean,
      confidenceScore: number,
      depthScore: number,
      overallScore: number,
      examples: boolean,
      technicalDetail: boolean
    }> = {};
    
    // Keywords that indicate deeper knowledge
    const depthIndicators = [
      'architecture', 'implemented', 'designed', 'optimized', 'improved',
      'developed', 'built', 'created', 'managed', 'led', 'researched',
      'analyzed', 'debugged', 'solved', 'integrated', 'deployed',
      'maintained', 'tested', 'documented'
    ];
    
    // Technical detail indicators
    const technicalDetailIndicators = [
      'algorithm', 'efficiency', 'performance', 'complexity', 'approach',
      'pattern', 'framework', 'library', 'module', 'component', 'function',
      'method', 'class', 'interface', 'api', 'database', 'schema', 'query',
      'index', 'cache', 'asynchronous', 'concurrent', 'parallel', 'event',
      'callback', 'promise', 'stream', 'buffer', 'middleware', 'authentication',
      'authorization', 'encryption', 'security', 'validation', 'sanitization'
    ];
    
    // Example indicators
    const exampleIndicators = [
      'for example', 'such as', 'specifically', 'instance', 'case study', 
      'scenario', 'implementation', 'project', 'experience with', 'worked on'
    ];
    
    // Check each skill for depth of knowledge
    userSkills.skills.forEach(skill => {
      const skillLower = skill.toLowerCase();
      
      // Check if skill is mentioned
      const isMentioned = allAnswersText.includes(skillLower) || 
                        (skillLower.split(' ').length > 1 && 
                          skillLower.split(' ').every(word => 
                            word.length > 3 && allAnswersText.includes(word)
                          ));
      
      // Find answers that mention this skill
      const relevantAnswers = results.emotionsData.filter(item => 
        item.answer?.toLowerCase().includes(skillLower) ||
        (skillLower.split(' ').length > 1 && 
          skillLower.split(' ').every(word => 
            word.length > 3 && item.answer?.toLowerCase().includes(word)
          ))
      );
      
      // Calculate confidence score based on emotions
      let confidenceScore = 0;
      const confidenceEmotions = ['confidence', 'joy', 'satisfaction', 'concentration'];
      const uncertaintyEmotions = ['confusion', 'fear', 'nervousness', 'anxiety'];
      
      if (relevantAnswers.length > 0) {
        let confidenceCount = 0;
        let uncertaintyCount = 0;
        
        relevantAnswers.forEach(answer => {
          if (answer.emotions && answer.emotions.length > 0) {
            // Check for confidence-related emotions
            answer.emotions.forEach(emotion => {
              if (confidenceEmotions.includes(emotion.name.toLowerCase())) {
                confidenceCount += emotion.score;
              }
              if (uncertaintyEmotions.includes(emotion.name.toLowerCase())) {
                uncertaintyCount += emotion.score;
              }
            });
          }
        });
        
        // Calculate confidence score (0-100)
        confidenceScore = confidenceCount > 0 ? 
          Math.min(100, Math.round((confidenceCount / (confidenceCount + uncertaintyCount + 0.1)) * 100)) : 40;
      }
      
      // Calculate depth score
      let depthScore = 0;
      if (isMentioned) {
        // Base score for mentioning
        depthScore = 30;
        
        // Check for depth indicators
        depthIndicators.forEach(indicator => {
          const pattern = new RegExp(`\\b${indicator}\\b.{0,50}\\b${skillLower}\\b|\\b${skillLower}\\b.{0,50}\\b${indicator}\\b`, 'i');
          if (pattern.test(allAnswersText)) {
            depthScore += 10;
          }
        });
        
        // Check for technical details
        let technicalDetailCount = 0;
        technicalDetailIndicators.forEach(indicator => {
          const pattern = new RegExp(`\\b${indicator}\\b.{0,70}\\b${skillLower}\\b|\\b${skillLower}\\b.{0,70}\\b${indicator}\\b`, 'i');
          if (pattern.test(allAnswersText)) {
            technicalDetailCount++;
          }
        });
        
        depthScore += Math.min(30, technicalDetailCount * 5);
        
        // Check for examples
        let hasExamples = false;
        exampleIndicators.forEach(indicator => {
          const pattern = new RegExp(`\\b${indicator}\\b.{0,100}\\b${skillLower}\\b|\\b${skillLower}\\b.{0,100}\\b${indicator}\\b`, 'i');
          if (pattern.test(allAnswersText)) {
            hasExamples = true;
          }
        });
        
        if (hasExamples) {
          depthScore += 20;
        }
        
        // Cap the score at 100
        depthScore = Math.min(100, depthScore);
      }
      
      // Calculate overall score using weighted components
      const overallScore = isMentioned ? 
        Math.round((depthScore * 0.6) + (confidenceScore * 0.4)) : 0;
      
      // Store the analysis
      skillAnalysisResults[skill] = {
        mentioned: isMentioned,
        confidenceScore,
        depthScore,
        overallScore,
        examples: exampleIndicators.some(indicator => 
          new RegExp(`\\b${indicator}\\b.{0,100}\\b${skillLower}\\b|\\b${skillLower}\\b.{0,100}\\b${indicator}\\b`, 'i').test(allAnswersText)
        ),
        technicalDetail: technicalDetailIndicators.some(indicator => 
          new RegExp(`\\b${indicator}\\b.{0,70}\\b${skillLower}\\b|\\b${skillLower}\\b.{0,70}\\b${indicator}\\b`, 'i').test(allAnswersText)
        )
      };
    });
    
    console.log("Detailed skill analysis:", skillAnalysisResults);
    
    // Determine matched and missing skills based on threshold
    const matchedSkills = userSkills.skills.filter(skill => 
      skillAnalysisResults[skill]?.overallScore >= 40
    );
    
    const missingSkills = userSkills.skills.filter(skill => 
      !skillAnalysisResults[skill] || skillAnalysisResults[skill].overallScore < 40
    );
    
    // Get common technical skills to recommend
    const commonTechSkills: string[] = [
      'javascript', 'react', 'typescript', 'node.js', 'python', 
      'java', 'sql', 'aws', 'git', 'css', 'html', 'docker',
      'kubernetes', 'c#', 'c++', 'ruby', 'php', 'golang', 'swift',
      'vue.js', 'angular', 'devops', 'graphql', 'rest api',
      'machine learning', 'data analysis', 'cloud computing', 
      'system design', 'agile methodology', 'test-driven development'
    ];
    
    // Analyze communication quality
    const analyseCommunication = () => {
      // Count words in answers
      const totalWords = allAnswersText.split(/\s+/).filter(word => word.length > 1).length;
      const averageWordsPerAnswer = totalWords / Math.max(1, results.emotionsData.length);
      
      // Check for filler words
      const fillerWords = ['um', 'uh', 'like', 'you know', 'actually', 'basically', 'literally'];
      let fillerCount = 0;
      fillerWords.forEach(word => {
        const regex = new RegExp(`\\b${word}\\b`, 'gi');
        const matches = allAnswersText.match(regex);
        if (matches) fillerCount += matches.length;
      });
      
      // Check for complexity of language
      const complexityIndicators = ['therefore', 'however', 'consequently', 'furthermore', 'nevertheless', 
                                   'although', 'whereas', 'despite', 'while', 'moreover', 'specifically'];
      let complexityScore = 0;
      complexityIndicators.forEach(word => {
        const regex = new RegExp(`\\b${word}\\b`, 'gi');
        const matches = allAnswersText.match(regex);
        if (matches) complexityScore += matches.length;
      });
      
      // Analyze sentence structure
      const sentences = allAnswersText.split(/[.!?]+/).filter(s => s.trim().length > 0);
      const averageSentenceLength = totalWords / Math.max(1, sentences.length);
      
      return {
        clarity: Math.min(100, Math.max(0, 100 - (fillerCount / totalWords * 200))),
        conciseness: Math.min(100, Math.max(0, 100 - Math.abs(averageWordsPerAnswer - 50) * 1.5)),
        complexity: Math.min(100, Math.max(0, 40 + (complexityScore / sentences.length * 200))),
        structure: Math.min(100, Math.max(0, 100 - Math.abs(averageSentenceLength - 15) * 3))
      };
    };
    
    const communicationMetrics = analyseCommunication();
    
    // Create an overall communication score
    const communicationScore = Math.round(
      (communicationMetrics.clarity * 0.3) +
      (communicationMetrics.conciseness * 0.2) +
      (communicationMetrics.complexity * 0.3) +
      (communicationMetrics.structure * 0.2)
    );
    
    // Check for technical terms mentioned in answers
    const techTermsInAnswers: string[] = [];
    commonTechSkills.forEach(skill => {
      if (allAnswersText.includes(skill.toLowerCase())) {
        techTermsInAnswers.push(skill);
      }
    });
    
    // Create recommendations by prioritizing:
    // 1. Skills mentioned but not in profile
    // 2. Related skills to the user's existing skills
    const mentionedButNotInProfile = techTermsInAnswers.filter(
      skill => !userSkills.skills.some(userSkill => 
        userSkill.toLowerCase() === skill.toLowerCase()
      )
    );
    
    // Add related skills based on what's in the profile
    const relatedSkillsMap: Record<string, string[]> = {
      'javascript': ['typescript', 'react', 'node.js', 'vue.js'],
      'react': ['javascript', 'redux', 'typescript', 'nextjs'],
      'python': ['django', 'flask', 'machine learning', 'data analysis'],
      'java': ['spring', 'hibernate', 'microservices'],
      'c#': ['.net', 'asp.net', 'xamarin'],
      'aws': ['cloud computing', 'devops', 'terraform'],
      'sql': ['postgres', 'mysql', 'database design'],
      'html': ['css', 'javascript', 'web development'],
      'css': ['html', 'sass', 'tailwind']
    };
    
    const relatedRecommendations: string[] = [];
    userSkills.skills.forEach(skill => {
      const skillLower = skill.toLowerCase();
      const related = relatedSkillsMap[skillLower];
      if (related) {
        relatedRecommendations.push(...related.filter(
          (relSkill: string) => !userSkills.skills.some(userSkill => 
            userSkill.toLowerCase() === relSkill.toLowerCase()
          )
        ));
      }
    });
    
    // Combine recommendations and remove duplicates
    const recommendedSkills = [...new Set([
      ...mentionedButNotInProfile,
      ...relatedRecommendations
    ])].slice(0, 5); // Limit to 5 recommendations
    
    // Calculate an adjusted overall score based on both skill coverage and communication
    // This provides a more accurate assessment that goes beyond just mentioning technologies
    const overallSkillScore = userSkills.skills.length > 0 
      ? Math.round(userSkills.skills.reduce((sum, skill) => 
          sum + (skillAnalysisResults[skill]?.overallScore || 0), 0) / userSkills.skills.length)
      : 0;
    
    // Combine skill and communication scores for a more complete assessment
    const finalScore = Math.round((overallSkillScore * 0.7) + (communicationScore * 0.3));
    
    setSkillAnalysis({
      matchedSkills,
      missingSkills,
      recommendedSkills,
      overallScore: finalScore,
      detailedSkillScores: skillAnalysisResults,
      communicationMetrics
    });
    
    console.log("Skills analysis:", {
      userSkills: userSkills.skills,
      matched: matchedSkills,
      missing: missingSkills,
      recommendations: recommendedSkills,
      communicationMetrics,
      finalScore
    });
  };

  // Function to generate improvement plan
  const generateImprovementPlan = () => {
    if (!results || !skillAnalysis) return;
    
    setIsGeneratingPlan(true);
    
    try {
      // Analyze interview transcripts to identify communication patterns and topics
      const analyzeTranscripts = (): string[] => {
        const patterns: string[] = [];
        
        if (results.transcriptions && results.transcriptions.length > 0) {
          // Check for short answers (potential sign of lack of depth)
          const shortAnswers = results.emotionsData.filter(item => 
            item.answer.split(' ').length < 15
          ).length;
          
          if (shortAnswers > 2) {
            patterns.push('communication-brevity');
          }
          
          // Check for filler words
          const fillerWords = ['um', 'uh', 'like', 'you know', 'actually', 'basically'];
          const fillerCount = results.transcriptions.reduce((count, trans) => {
            fillerWords.forEach(word => {
              const regex = new RegExp(`\\b${word}\\b`, 'gi');
              const matches = trans.match(regex);
              if (matches) count += matches.length;
            });
            return count;
          }, 0);
          
          if (fillerCount > 5) {
            patterns.push('communication-fillers');
          }
          
          // Check for technical language
          const techTerms = ['algorithm', 'framework', 'architecture', 'database', 'api', 'implementation', 'deployment'];
          const techTermCount = results.transcriptions.reduce((count, trans) => {
            techTerms.forEach(term => {
              const regex = new RegExp(`\\b${term}\\b`, 'gi');
              const matches = trans.match(regex);
              if (matches) count += matches.length;
            });
            return count;
          }, 0);
          
          if (techTermCount < 3) {
            patterns.push('communication-technical');
          }
        }
        
        return patterns;
      };
      
      // Analyze emotional data to identify behavioral patterns
      const analyzeEmotions = (): string[] => {
        const patterns: string[] = [];
        
        if (results.emotionsData && results.emotionsData.length > 0) {
          // Check for predominant nervousness
          const nervousCount = results.emotionsData.filter(item => 
            item.emotions && 
            item.emotions.length > 0 && 
            ['fear', 'nervousness', 'anxiety'].includes(item.emotions[0].name?.toLowerCase() || '')
          ).length;
          
          if (nervousCount >= Math.floor(results.emotionsData.length / 3)) {
            patterns.push('emotion-nervousness');
          }
          
          // Check for confidence
          const confidenceCount = results.emotionsData.filter(item => 
            item.emotions && 
            item.emotions.length > 0 && 
            ['confidence', 'joy', 'pride'].includes(item.emotions[0].name?.toLowerCase() || '')
          ).length;
          
          if (confidenceCount < Math.floor(results.emotionsData.length / 3)) {
            patterns.push('emotion-confidence');
          }
        }
        
        return patterns;
      };
      
      // Define resources based on skill gaps and behavioral patterns
      const generateResources = (skills: string[], patterns: string[]): Resource[] => {
        const resources: Resource[] = [];
        
        // Add resources based on communication patterns
        if (patterns.includes('communication-brevity')) {
          resources.push({
            title: 'STAR Method for Interview Responses',
            type: 'article',
            url: 'https://www.indeed.com/career-advice/interviewing/how-to-use-the-star-interview-response-technique',
            description: 'Learn how to structure detailed answers using the Situation, Task, Action, Result framework.'
          });
        }
        
        if (patterns.includes('communication-fillers')) {
          resources.push({
            title: 'Eliminating Filler Words in Speech',
            type: 'video',
            url: 'https://www.youtube.com/results?search_query=eliminate+filler+words',
            description: 'Techniques to reduce filler words and speak more confidently during interviews.'
          });
        }
        
        if (patterns.includes('communication-technical')) {
          resources.push({
            title: 'Technical Communication for Interviews',
            type: 'course',
            url: 'https://www.coursera.org/search?query=technical%20communication',
            description: 'Improve your ability to communicate technical concepts clearly and effectively.'
          });
        }
        
        // Add resources based on emotional patterns
        if (patterns.includes('emotion-nervousness')) {
          resources.push({
            title: 'Managing Interview Anxiety',
            type: 'article',
            url: 'https://www.themuse.com/advice/interview-anxiety-tips',
            description: 'Practical techniques to reduce nervousness and anxiety during interviews.'
          });
        }
        
        if (patterns.includes('emotion-confidence')) {
          resources.push({
            title: 'Building Confidence for Interviews',
            type: 'course',
            url: 'https://www.linkedin.com/learning/search?keywords=confidence',
            description: 'Learn strategies to boost your confidence and project assurance during interviews.'
          });
        }
        
        // Generate resources for each skill gap
        skills.forEach((skill, index) => {
          // Course resource
          if (index % 5 === 0 || index === 0) {
            resources.push({
              title: `Complete ${skill} Fundamentals`,
              type: 'course',
              url: `https://www.coursera.org/search?query=${encodeURIComponent(skill)}`,
              description: `A comprehensive course covering ${skill} fundamentals and best practices.`
            });
          }
          
          // Book resource
          if (index % 5 === 1 || skills.length < 3) {
            resources.push({
              title: `${skill} in Practice`,
              type: 'book',
              description: `A practical guide to mastering ${skill} with real-world examples and case studies.`
            });
          }
          
          // Project resource
          if (index % 5 === 2 || skills.length < 4) {
            resources.push({
              title: `Build a ${skill} Portfolio Project`,
              type: 'project',
              description: `Create a portfolio-worthy project that demonstrates your ${skill} abilities.`
            });
          }
          
          // Video tutorial
          if (index % 5 === 3 || skills.length < 2) {
            resources.push({
              title: `${skill} Video Tutorial Series`,
              type: 'video',
              url: `https://www.youtube.com/results?search_query=${encodeURIComponent(skill)}+tutorial`,
              description: `Watch comprehensive video tutorials on ${skill} to improve your understanding.`
            });
          }
          
          // Article
          if (index % 5 === 4 || skills.length < 5) {
            resources.push({
              title: `Latest ${skill} Trends and Best Practices`,
              type: 'article',
              url: `https://medium.com/search?q=${encodeURIComponent(skill)}`,
              description: `Stay updated with the latest trends and best practices in ${skill}.`
            });
          }
        });
        
        // Limit to 12 resources, prioritizing communication and emotional resources
        return resources.slice(0, 12);
      };
      
      // Generate timeline for skill development, incorporating behavioral improvements
      const generateTimeline = (skills: string[], patterns: string[]): TimelineItem[] => {
        const timeline: TimelineItem[] = [];
        
        // Add timeline items based on communication patterns
        if (patterns.includes('communication-brevity') || patterns.includes('communication-fillers') || patterns.includes('communication-technical')) {
          timeline.push({
            duration: '1-2 weeks',
            task: 'Practice structured interview responses using the STAR method, recording yourself to identify areas for improvement.',
            priority: 'high'
          });
        }
        
        // Add timeline items based on emotional patterns
        if (patterns.includes('emotion-nervousness') || patterns.includes('emotion-confidence')) {
          timeline.push({
            duration: '2-3 weeks',
            task: 'Practice mock interviews with friends or mentors to build confidence and reduce anxiety.',
            priority: 'high'
          });
        }
        
        // Add standard timeline items
        timeline.push(
          {
            duration: '1-2 weeks',
            task: 'Assessment and planning: Identify specific areas within your skill gaps to focus on',
            priority: 'high'
          },
          {
            duration: '2-4 weeks',
            task: `Complete introductory courses on ${skills.slice(0, 2).join(' and ')}`,
            priority: skills.length > 0 ? 'high' : 'medium'
          },
          {
            duration: '1 month',
            task: `Build a small project using ${skills[0] || 'your target skill'}`,
            priority: 'medium'
          },
          {
            duration: '2-3 months',
            task: 'Join communities and forums related to your target skills for networking',
            priority: 'medium'
          },
          {
            duration: '3-6 months',
            task: `Complete advanced courses and certifications in ${skills.slice(0, 3).join(', ')}`,
            priority: skills.length > 0 ? 'high' : 'medium'
          },
          {
            duration: '6 months',
            task: 'Build a comprehensive portfolio project showcasing all your improved skills',
            priority: 'high'
          }
        );
        
        return timeline;
      };
      
      // Generate career paths based on skills and emotional profile
      const generateCareerPaths = (matchedSkills: string[], missingSkills: string[], patterns: string[]): CareerPath[] => {
        const allSkills = [...new Set([...matchedSkills, ...missingSkills])]; // resume skills
        
        // Define some common career paths and their required skills
        const commonPaths: {[key: string]: {level: 'entry' | 'mid' | 'senior', skills: string[], description: string}} = {
          'Frontend Developer': {
            level: matchedSkills.filter(s => ['javascript', 'react', 'vue.js', 'angular', 'html', 'css'].includes(s.toLowerCase())).length > 3 ? 'mid' : 'entry',
            skills: ['JavaScript', 'HTML', 'CSS', 'React', 'TypeScript'],
            description: 'Build user interfaces and client-side applications using modern web technologies.'
          },
          'Backend Developer': {
            level: matchedSkills.filter(s => ['node.js', 'python', 'java', 'c#', 'php', 'golang', 'sql'].includes(s.toLowerCase())).length > 3 ? 'mid' : 'entry',
            skills: ['Node.js', 'Python', 'SQL', 'REST API', 'Java'],
            description: 'Develop server-side logic, databases, and APIs that power web applications.'
          },
          'Full Stack Developer': {
            level: matchedSkills.filter(s => ['javascript', 'react', 'node.js', 'python', 'sql'].includes(s.toLowerCase())).length > 4 ? 'mid' : 'entry',
            skills: ['JavaScript', 'React', 'Node.js', 'SQL', 'HTML/CSS'],
            description: 'Work on both client and server sides, handling everything from user interfaces to databases.'
          },
          'DevOps Engineer': {
            level: matchedSkills.filter(s => ['docker', 'kubernetes', 'aws', 'git', 'devops'].includes(s.toLowerCase())).length > 3 ? 'mid' : 'entry',
            skills: ['Docker', 'Kubernetes', 'AWS', 'CI/CD', 'Linux'],
            description: 'Implement and manage continuous delivery systems and methodologies.'
          },
          'Data Scientist': {
            level: matchedSkills.filter(s => ['python', 'sql', 'r', 'machine learning', 'statistics'].includes(s.toLowerCase())).length > 3 ? 'mid' : 'entry',
            skills: ['Python', 'SQL', 'Machine Learning', 'Statistics', 'Data Visualization'],
            description: 'Analyze and interpret complex data to help organizations make better decisions.'
          },
          'Mobile Developer': {
            level: matchedSkills.filter(s => ['swift', 'kotlin', 'react native', 'flutter', 'java'].includes(s.toLowerCase())).length > 2 ? 'mid' : 'entry',
            skills: ['Swift', 'Kotlin', 'React Native', 'Flutter', 'Mobile UI Design'],
            description: 'Create applications for mobile devices across various platforms.'
          },
          'UX/UI Designer': {
            level: matchedSkills.filter(s => ['ui design', 'ux design', 'figma', 'sketch', 'adobe xd'].includes(s.toLowerCase())).length > 2 ? 'mid' : 'entry',
            skills: ['UX Research', 'UI Design', 'Figma', 'User Testing', 'Wireframing'],
            description: 'Design user interfaces and experiences that are intuitive, accessible, and visually appealing.'
          },
          'Product Manager': {
            level: matchedSkills.filter(s => ['product management', 'agile', 'scrum', 'user stories', 'roadmap'].includes(s.toLowerCase())).length > 2 ? 'mid' : 'entry',
            skills: ['Product Strategy', 'Agile', 'User Research', 'Roadmapping', 'Stakeholder Management'],
            description: 'Lead the development of products from conception to launch, balancing business needs with user requirements.'
          }
        };
        
        // Consider communication comfort when suggesting client-facing roles
        if (patterns.includes('emotion-nervousness') || patterns.includes('communication-fillers')) {
          // Lower ranking for roles that require more client interaction
          delete commonPaths['Product Manager'];
        }
        
        // Calculate match percentage for each career path
        const careerPaths: CareerPath[] = Object.entries(commonPaths).map(([role, details]) => {
          const requiredSkills = details.skills;
          const matchCount = requiredSkills.filter(skill => 
            allSkills.some(userSkill => userSkill.toLowerCase() === skill.toLowerCase())
          ).length;
          
          const matchPercentage = Math.round((matchCount / requiredSkills.length) * 100);
          
          // Adjust match percentage based on communication patterns
          let adjustedPercentage = matchPercentage;
          
          // For client-facing roles, consider communication skills
          if (['UX/UI Designer', 'Product Manager'].includes(role)) {
            if (patterns.includes('communication-brevity') || patterns.includes('communication-fillers')) {
              adjustedPercentage = Math.max(0, adjustedPercentage - 10);
            }
          }
          
          // For technical roles, consider technical communication
          if (['Backend Developer', 'Data Scientist', 'DevOps Engineer'].includes(role)) {
            if (patterns.includes('communication-technical')) {
              adjustedPercentage = Math.max(0, adjustedPercentage - 5);
            }
          }
          
          return {
            role,
            level: details.level,
            matchPercentage: adjustedPercentage,
            requiredSkills,
            description: details.description
          };
        });
        
        // Sort by match percentage and return top 3
        return careerPaths.sort((a, b) => b.matchPercentage - a.matchPercentage).slice(0, 3);
      };
      
      // Identify communication and emotional patterns
      const communicationPatterns = analyzeTranscripts();
      const emotionalPatterns = analyzeEmotions();
      const allPatterns = [...communicationPatterns, ...emotionalPatterns];
      
      // Generate summary based on patterns
      let summary = `Based on your interview performance, we've identified ${skillAnalysis.missingSkills.length} skill gaps that could be improved.`;
      
      if (communicationPatterns.length > 0) {
        summary += ` There are opportunities to improve your communication style, particularly in ${
          communicationPatterns.includes('communication-brevity') ? 'providing more detailed responses' : 
          communicationPatterns.includes('communication-fillers') ? 'reducing filler words' : 
          'incorporating more technical terminology'
        }.`;
      }
      
      if (emotionalPatterns.length > 0) {
        summary += ` Your interview confidence ${
          emotionalPatterns.includes('emotion-nervousness') ? 'could be enhanced by managing nervousness' : 
          'can be strengthened with more practice and preparation'
        }.`;
      }
      
      summary += ` This plan provides resources, a timeline, and potential career paths that align with your current skills and future goals.`;
      
      // Generate the improvement plan
      const plan: ImprovementPlan = {
        skillGaps: skillAnalysis.missingSkills,
        resources: generateResources(skillAnalysis.missingSkills.length > 0 ? skillAnalysis.missingSkills : skillAnalysis.recommendedSkills, allPatterns),
        timeline: generateTimeline(skillAnalysis.missingSkills.length > 0 ? skillAnalysis.missingSkills : skillAnalysis.recommendedSkills, allPatterns),
        careerPaths: generateCareerPaths(skillAnalysis.matchedSkills, skillAnalysis.missingSkills, allPatterns),
        summary,
        generatedAt: new Date().toISOString()
      };
      
      setImprovementPlan(plan);
      
      // Save the plan to localStorage for access on the dashboard
      localStorage.setItem('latestImprovementPlan', JSON.stringify(plan));
    } catch (error) {
      console.error('Error generating improvement plan:', error);
    } finally {
      setIsGeneratingPlan(false);
    }
  };

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
      
    // Add skill gap analysis text
    const skillGapText = userSkills.skills.length > 0 
      ? `
## Skill Gap Analysis
Overall Skills Utilization: ${skillAnalysis.overallScore}%

Demonstrated Skills: ${skillAnalysis.matchedSkills.length > 0 ? skillAnalysis.matchedSkills.join(', ') : 'None'}

Missing Skills: ${skillAnalysis.missingSkills.length > 0 ? skillAnalysis.missingSkills.join(', ') : 'None'}

Recommended Skills to Add: ${skillAnalysis.recommendedSkills.length > 0 ? skillAnalysis.recommendedSkills.join(', ') : 'None'}

Recommendations:
- Focus on highlighting your ${skillAnalysis.missingSkills.slice(0, 3).join(', ')} skills in future interviews
- Prepare STAR stories for each of your key skills
- Practice integrating technical terms naturally into your responses
`
      : "\n\n## Skill Gap Analysis\nNo skills data available for analysis.";
    
    const resultsText = `
# NERV AI Interview Results
Date: ${new Date(results.timestamp).toLocaleString()}

## Summary
${results.summary || "No summary available"}

## Transcriptions
${transcriptionsText}

## Emotional Analysis
${emotionsText}
${skillGapText}
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
    const currentIndex = tabs.indexOf(activeTab);
    setActiveTab(tabs[(currentIndex + 1) % tabs.length]);
  };

  const prevTab = () => {
    const currentIndex = tabs.indexOf(activeTab);
    setActiveTab(tabs[(currentIndex - 1 + tabs.length) % tabs.length]);
  };

  // Helper function to get emotion color
  const getEmotionColor = (name: string) => {
    const emotionColors: {[key: string]: string} = {
      // Positive emotions - shades of green/teal
      happy: 'bg-emerald-500',
      happiness: 'bg-emerald-500',
      joy: 'bg-green-500',
      satisfaction: 'bg-teal-500',
      contentment: 'bg-teal-400',
      
      // Negative emotions - reds and purples
      sad: 'bg-blue-600',
      sadness: 'bg-blue-600',
      angry: 'bg-red-600',
      anger: 'bg-red-600',
      fearful: 'bg-purple-600',
      fear: 'bg-purple-600',
      disgusted: 'bg-orange-600',
      disgust: 'bg-orange-600',
      contempt: 'bg-pink-600',
      
      // Neutral emotions
      neutral: 'bg-gray-500',
      
      // Cognitive states - blues and cyans
      confusion: 'bg-indigo-500',
      interest: 'bg-cyan-500',
      concentration: 'bg-sky-500',
      focus: 'bg-sky-600',
      thoughtful: 'bg-blue-500',
      
      // Surprise emotions - yellows
      surprised: 'bg-amber-500',
      surprise: 'bg-amber-500',
      amazed: 'bg-yellow-500',
      
      // Confidence related
      confidence: 'bg-violet-500',
      pride: 'bg-fuchsia-500',
      uncertainty: 'bg-slate-500',
      nervousness: 'bg-red-400',
      anxiety: 'bg-rose-400',
      
      default: 'bg-slate-400'
    };
    
    const lowerName = name.toLowerCase();
    return emotionColors[lowerName] || emotionColors.default;
  };
  
  // Helper function to get text color from bg color
  const getTextColorFromBg = (bgColor: string) => {
    return bgColor.replace('bg-', 'text-');
  };

  const getRoundData = (roundType: InterviewRoundType | 'overall') => {
    if (!results || !results.emotionsData || !results.transcriptions) return null;
    
    if (roundType === 'overall' || !hasMultipleRounds) {
      return {
        summary: results.summary,
        emotionsData: results.emotionsData,
        transcriptions: results.transcriptions
      };
    }
    
    if (results.rounds && results.rounds[roundType]) {
      return {
        ...results.rounds[roundType],
        summary: results.rounds[roundType]?.summary || '',
        emotionsData: results.rounds[roundType]?.emotionsData || [],
        transcriptions: results.rounds[roundType]?.transcriptions || []
      };
    }
    
    return results;
  };

  const RoundSelector = () => {
    if (!hasMultipleRounds) return null;
    
    const rounds = results?.rounds ? Object.keys(results.rounds) as InterviewRoundType[] : [];
    
    return (
      <div className="mb-6 border-b border-gray-800">
        <div className="flex space-x-1">
          <button
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              selectedRound === 'overall' ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-400 hover:text-gray-300'
            }`}
            onClick={() => setSelectedRound('overall')}
          >
            Overall Results
          </button>
          
          {rounds.map((round) => (
            <button
              key={round}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                selectedRound === round ? `border-${getEmotionColor(round as InterviewRoundType).slice(1)} text-${getEmotionColor(round as InterviewRoundType).slice(1)}` : 'border-transparent text-gray-400 hover:text-gray-300'
              }`}
              onClick={() => setSelectedRound(round as InterviewRoundType)}
              style={{ borderColor: selectedRound === round ? getEmotionColor(round as InterviewRoundType) : 'transparent' }}
            >
              <div className="flex items-center gap-2">
                <div 
                  className="w-2 h-2 rounded-full" 
                  style={{ backgroundColor: getEmotionColor(round as InterviewRoundType) }}
                ></div>
                {round}
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  };

  const getEmotionsChartData = (emotionsData: any[]) => {
    if (!emotionsData || emotionsData.length === 0) {
      return null;
    }

    // Count emotions across all answers
    const emotionCounts: Record<string, number> = {};
    emotionsData.forEach((item: any) => {
      if (item.emotions && item.emotions.length > 0) {
        item.emotions.forEach((emotion: any) => {
          if (emotion.score > 0.4) { // Only count significant emotions
            emotionCounts[emotion.name] = (emotionCounts[emotion.name] || 0) + (emotion.score);
          }
        });
      }
    });

    // Sort and get top emotions
    const sortedEmotions = Object.entries(emotionCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);

    // Create color mapping for emotions
    const emotionColorMap: Record<string, string> = {
      // Positive emotions
      happy: 'rgba(16, 185, 129, 0.7)',
      happiness: 'rgba(16, 185, 129, 0.7)',
      joy: 'rgba(5, 150, 105, 0.7)',
      contentment: 'rgba(52, 211, 153, 0.7)',
      
      // Negative emotions
      sad: 'rgba(37, 99, 235, 0.7)',
      sadness: 'rgba(37, 99, 235, 0.7)',
      angry: 'rgba(220, 38, 38, 0.7)',
      anger: 'rgba(220, 38, 38, 0.7)',
      fear: 'rgba(124, 58, 237, 0.7)',
      fearful: 'rgba(124, 58, 237, 0.7)',
      disgust: 'rgba(217, 119, 6, 0.7)',
      disgusted: 'rgba(217, 119, 6, 0.7)',
      
      // Neutral/cognitive
      neutral: 'rgba(107, 114, 128, 0.7)',
      concentration: 'rgba(6, 182, 212, 0.7)',
      confusion: 'rgba(79, 70, 229, 0.7)',
      interest: 'rgba(8, 145, 178, 0.7)',
      
      // Surprise emotions
      surprise: 'rgba(245, 158, 11, 0.7)',
      surprised: 'rgba(245, 158, 11, 0.7)',
    };

    // Get color for each emotion, falling back to a default color palette if not found
    const defaultColors = [
      'rgba(54, 162, 235, 0.7)',
      'rgba(255, 99, 132, 0.7)',
      'rgba(75, 192, 192, 0.7)',
      'rgba(255, 206, 86, 0.7)',
      'rgba(153, 102, 255, 0.7)',
      'rgba(255, 159, 64, 0.7)',
    ];

    const backgroundColors = sortedEmotions.map(([name], index) => 
      emotionColorMap[name.toLowerCase()] || defaultColors[index % defaultColors.length]
    );

    const borderColors = backgroundColors.map(color => color.replace('0.7', '1'));

    return {
      labels: sortedEmotions.map(([name]) => name),
      datasets: [
        {
          label: 'Emotion Score',
          data: sortedEmotions.map(([, count]) => (count / emotionsData.length).toFixed(2)),
          backgroundColor: backgroundColors,
          borderColor: borderColors,
          borderWidth: 1,
          borderRadius: 6,
        },
      ],
    };
  };

  // Add the missing getRoundName function
  const getRoundName = (roundType: InterviewRoundType | string): string => {
    switch (roundType) {
      case InterviewRoundType.TECHNICAL:
        return 'Technical Round';
      case InterviewRoundType.BEHAVIORAL:
        return 'Behavioral Round';
      case InterviewRoundType.HR:
        return 'HR Round';
      case 'unspecified':
        return 'Interview';
      case 'overall':
        return 'Overall Interview';
      default:
        return 'Interview Round';
    }
  };

  // Pagination helper function
  const paginate = (items: any[], currentPage: number) => {
    const indexOfLastItem = currentPage * itemsPerPage;
    const indexOfFirstItem = indexOfLastItem - itemsPerPage;
    return items.slice(indexOfFirstItem, indexOfLastItem);
  };

  // Add a toggle function
  const toggleExpandItem = (roundType: string, index: number) => {
    const key = `${roundType}-${index}`;
    setExpandedItems(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  return (
    <div className="min-h-screen bg-black text-white relative overflow-hidden">
      {/* Background gradient effect */}
      <div className="absolute inset-0 bg-gradient-to-b from-black via-black/90 to-black/80 z-0"></div>
      <div className="absolute inset-0 bg-[url('/images/grid.svg')] bg-center opacity-10 z-0"></div>
      
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
          <div>
            <h1 className="font-montserrat font-bold text-3xl bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
              Interview Results
            </h1>
            <p className="text-gray-400 text-sm mt-1">
              {results?.timestamp ? new Date(results.timestamp).toLocaleString() : 'Recent interview'}
            </p>
          </div>
        </motion.div>
        
        {isLoading ? (
          <div className="flex flex-col justify-center items-center h-64 text-center backdrop-blur-sm bg-black/30 border border-white/5 rounded-xl p-8">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mb-4"></div>
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
            className="p-8 rounded-xl bg-gradient-to-br from-black/80 to-gray-900/50 backdrop-blur-sm border border-white/10 mb-6"
          >
            <p className="text-red-300">{error}</p>
            <motion.button 
              whileHover={{ scale: 1.05 }}
              transition={{ duration: 0.2 }}
              onClick={() => navigate('/interview')} 
              className="mt-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white px-6 py-3 rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all font-semibold shadow-lg shadow-blue-900/20"
            >
              Start New Interview
            </motion.button>
          </motion.div>
        ) : results ? (
          <div className="space-y-8">
            <RoundSelector />
            
            {/* Tabs for different sections */}
            <div className="border-b border-gray-800 mb-6 rounded-lg bg-black/20 backdrop-blur-sm p-1">
              <div className="flex space-x-2 overflow-x-auto pb-1 scrollbar-hide">
                {tabs.map((tab) => (
                  <button
                    key={tab}
                    className={`px-4 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                      activeTab === tab 
                        ? 'bg-blue-600/80 text-white shadow-lg shadow-blue-900/20' 
                        : 'bg-transparent text-gray-400 hover:text-gray-300 hover:bg-white/5'
                    }`}
                    onClick={() => setActiveTab(tab)}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            
            {/* Summary Tab */}
            {activeTab === 'summary' && (
              <div className="space-y-8">
                <div className="bg-gradient-to-b from-black/40 to-black/20 backdrop-blur-sm border border-gray-800 rounded-xl p-6 mb-8 shadow-xl">
                  <div className="mb-6 flex items-center justify-between">
                    <div className="flex items-center">
                      <div className="h-12 w-12 rounded-full bg-gradient-to-br from-blue-500/30 to-purple-500/30 flex items-center justify-center mr-4 shadow-md border border-blue-500/20">
                        <Brain className="h-6 w-6 text-blue-400" />
                      </div>
                      <div>
                        <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-300">
                          {hasMultipleRounds && selectedRound !== 'overall'
                            ? `${selectedRound} Summary`
                            : 'Interview Analysis'
                          }
                        </h2>
                        <p className="text-gray-400 text-sm mt-1">
                          AI-generated feedback based on your performance and emotional responses
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center bg-black/20 border border-gray-800 backdrop-blur-sm shadow-inner rounded-lg px-3 py-2">
                      <div className="text-xs text-gray-500 mr-2">Date:</div>
                      <div className="text-sm text-white">
                        {results?.timestamp ? new Date(results.timestamp).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric'
                        }) : 'Recent interview'}
                      </div>
                    </div>
                  </div>
                  
                  {/* Key metrics */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                    <div className="bg-gradient-to-br from-black/40 to-black/30 border border-gray-800 rounded-lg p-4 flex flex-col items-center text-center">
                      <div className="text-3xl font-bold text-white mb-1">{skillAnalysis.overallScore}%</div>
                      <div className="flex items-center">
                        <Brain className="h-4 w-4 text-blue-400 mr-1" />
                        <p className="text-xs text-gray-400">Overall Rating</p>
                      </div>
                      <div className="mt-2 w-full bg-gray-800/60 h-1.5 rounded-full overflow-hidden">
                        <div 
                          className={`h-full ${
                            skillAnalysis.overallScore >= 80 ? 'bg-green-500' :
                            skillAnalysis.overallScore >= 60 ? 'bg-blue-500' :
                            skillAnalysis.overallScore >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                          }`}
                          style={{ width: `${skillAnalysis.overallScore}%` }}
                        ></div>
                      </div>
                    </div>
                    
                    <div className="bg-gradient-to-br from-black/40 to-black/30 border border-gray-800 rounded-lg p-4 flex flex-col items-center text-center">
                      <div className="text-3xl font-bold text-white mb-1">
                        {results?.emotionsData && results.emotionsData.length > 0 ? 
                          Math.round(results.emotionsData.filter(item => 
                            item.emotions?.some(e => ['confidence', 'joy', 'satisfaction'].includes(e.name.toLowerCase()))
                          ).length / results.emotionsData.length * 100) : 0}%
                      </div>
                      <div className="flex items-center">
                        <Smile className="h-4 w-4 text-green-400 mr-1" />
                        <p className="text-xs text-gray-400">Confidence Level</p>
                      </div>
                      <div className="mt-2 w-full">
                        {results?.emotionsData && results.emotionsData.length > 0 &&
                          results.emotionsData.flatMap(item => item.emotions || [])
                            .sort((a, b) => b.score - a.score)
                            .slice(0, 3)
                            .map((emotion, idx) => (
                              <div 
                                key={idx} 
                                className="inline-flex items-center m-0.5 px-1.5 py-0.5 rounded-full text-xs"
                                style={{ 
                                  backgroundColor: `${getEmotionColor(emotion.name)}20`,
                                  color: getTextColorFromBg(getEmotionColor(emotion.name))
                                }}
                              >
                                {emotion.name}
                              </div>
                            ))
                        }
                      </div>
                    </div>
                    
                    <div className="bg-gradient-to-br from-black/40 to-black/30 border border-gray-800 rounded-lg p-4 flex flex-col items-center text-center">
                      <div className="text-3xl font-bold text-white mb-1">
                        {skillAnalysis.matchedSkills.length}/{userSkills.skills.length}
                      </div>
                      <div className="flex items-center">
                        <CheckCircle2 className="h-4 w-4 text-green-400 mr-1" />
                        <p className="text-xs text-gray-400">Skills Demonstrated</p>
                      </div>
                      <div className="mt-2 w-full">
                        {skillAnalysis.matchedSkills.slice(0, 3).map((skill, idx) => (
                          <div key={idx} className="inline-flex items-center m-0.5 px-1.5 py-0.5 bg-green-950/30 text-green-400 rounded-full text-xs">
                            {skill}
                          </div>
                        ))}
                        {skillAnalysis.matchedSkills.length > 3 && (
                          <div className="inline-flex items-center m-0.5 px-1.5 py-0.5 bg-blue-950/30 text-blue-400 rounded-full text-xs">
                            +{skillAnalysis.matchedSkills.length - 3} more
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div className="bg-gradient-to-br from-black/40 to-black/30 border border-gray-800 rounded-lg p-4 flex flex-col items-center text-center">
                      <div className="text-3xl font-bold text-white mb-1">
                        {Math.round(skillAnalysis.communicationMetrics?.clarity || 0)}%
                      </div>
                      <div className="flex items-center">
                        <MessageSquare className="h-4 w-4 text-blue-400 mr-1" />
                        <p className="text-xs text-gray-400">Communication Clarity</p>
                      </div>
                      <div className="mt-2 w-full bg-gray-800/60 h-1.5 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-blue-500"
                          style={{ width: `${skillAnalysis.communicationMetrics?.clarity || 0}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Summary content with better formatting */}
                  <div className="bg-black/30 border border-gray-800 rounded-lg p-6 mb-6">
                    <h3 className="text-lg font-semibold text-white mb-4 flex items-center">
                      <FileText className="h-5 w-5 text-blue-400 mr-2" />
                      Performance Summary
                    </h3>
                    
                    <div className="text-gray-200 text-lg leading-relaxed whitespace-pre-line">
                      <div className="prose prose-invert max-w-none prose-headings:text-blue-400 prose-strong:text-white prose-em:text-gray-300 prose-li:text-gray-200">
                        <ReactMarkdown>
                          {getRoundData(selectedRound)?.summary || 'No summary was generated for this interview.'}
                        </ReactMarkdown>
                      </div>
                    </div>
                  </div>
                  
                  {/* Key strengths and improvement areas */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                    <div className="bg-black/30 border border-gray-800 rounded-lg p-5">
                      <h3 className="text-md font-semibold text-white mb-4 flex items-center">
                        <CheckCircle2 className="h-4 w-4 text-green-500 mr-2" />
                        Key Strengths
                      </h3>
                      <ul className="space-y-2">
                        {skillAnalysis.matchedSkills.length > 0 ? (
                          skillAnalysis.matchedSkills.slice(0, 3).map((skill, idx) => (
                            <li key={idx} className="flex items-start">
                              <div className="h-5 w-5 rounded-full bg-green-950/50 border border-green-800/50 flex items-center justify-center flex-shrink-0 mr-2 mt-0.5">
                                <span className="text-xs text-green-500">{idx + 1}</span>
                              </div>
                              <div>
                                <span className="text-white">{skill}</span>
                                <p className="text-xs text-gray-400 mt-0.5">
                                  {skillAnalysis.detailedSkillScores?.[skill]?.technicalDetail ? 
                                    `Demonstrated strong technical understanding with ${skillAnalysis.detailedSkillScores[skill].confidenceScore}% confidence` : 
                                    'Mentioned during the interview'}
                                </p>
                              </div>
                            </li>
                          ))
                        ) : (
                          <li className="text-gray-400 text-sm">No significant strengths identified</li>
                        )}
                        
                        <li className="flex items-start">
                          <div className="h-5 w-5 rounded-full bg-blue-950/50 border border-blue-800/50 flex items-center justify-center flex-shrink-0 mr-2 mt-0.5">
                            <span className="text-xs text-blue-500">+</span>
                          </div>
                          <div>
                            <span className="text-white">Communication {skillAnalysis.communicationMetrics?.complexity ? 
                              skillAnalysis.communicationMetrics.complexity > 70 ? 'Excellence' : 'Skills' : 'Skills'}</span>
                            <p className="text-xs text-gray-400 mt-0.5">
                              {skillAnalysis.communicationMetrics?.clarity && skillAnalysis.communicationMetrics.clarity > 70 ? 
                                'Clear and articulate responses with good structure' : 
                                'Responded to interview questions appropriately'}
                            </p>
                          </div>
                        </li>
                      </ul>
                    </div>
                    
                    <div className="bg-black/30 border border-gray-800 rounded-lg p-5">
                      <h3 className="text-md font-semibold text-white mb-4 flex items-center">
                        <ArrowUpRight className="h-4 w-4 text-amber-500 mr-2" />
                        Areas for Improvement
                      </h3>
                      <ul className="space-y-2">
                        {skillAnalysis.missingSkills.length > 0 ? (
                          skillAnalysis.missingSkills.slice(0, 3).map((skill, idx) => (
                            <li key={idx} className="flex items-start">
                              <div className="h-5 w-5 rounded-full bg-amber-950/50 border border-amber-800/50 flex items-center justify-center flex-shrink-0 mr-2 mt-0.5">
                                <span className="text-xs text-amber-500">{idx + 1}</span>
                              </div>
                              <div>
                                <span className="text-white">{skill}</span>
                                <p className="text-xs text-gray-400 mt-0.5">
                                  Listed on your profile but not demonstrated effectively during interview
                                </p>
                              </div>
                            </li>
                          ))
                        ) : (
                          <li className="text-gray-400 text-sm">No significant gaps identified</li>
                        )}
                        
                        {skillAnalysis.communicationMetrics?.conciseness && skillAnalysis.communicationMetrics.conciseness < 70 && (
                          <li className="flex items-start">
                            <div className="h-5 w-5 rounded-full bg-amber-950/50 border border-amber-800/50 flex items-center justify-center flex-shrink-0 mr-2 mt-0.5">
                              <span className="text-xs text-amber-500">+</span>
                            </div>
                            <div>
                              <span className="text-white">Response Conciseness</span>
                              <p className="text-xs text-gray-400 mt-0.5">
                                Responses could be more focused and to the point
                              </p>
                            </div>
                          </li>
                        )}
                      </ul>
                    </div>
                  </div>
                  
                  {/* Download & Share Actions */}
                  <div className="flex items-center justify-end space-x-4">
                    <button 
                      onClick={() => setActiveTab('improvement')}
                      className="px-4 py-2 bg-gradient-to-r from-purple-600/80 to-purple-500/80 hover:from-purple-600 hover:to-purple-500 text-white rounded-lg flex items-center transition-colors shadow-lg shadow-purple-900/20"
                    >
                      <ArrowUpRight className="h-4 w-4 mr-2" />
                      View Improvement Plan
                    </button>
                    <button 
                      onClick={handleDownloadResults}
                      className="px-4 py-2 bg-gradient-to-r from-blue-600/80 to-blue-500/80 hover:from-blue-600 hover:to-blue-500 text-white rounded-lg flex items-center transition-colors shadow-lg shadow-blue-900/20"
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Download Report
                    </button>
                  </div>
                </div>
              </div>
            )}
            
            {/* Emotions Tab */}
            {activeTab === 'emotions' && (
              <div className="space-y-6">
                <div className="overflow-hidden rounded-xl border border-gray-800">
                  <div className="bg-black/40 border-b border-gray-800 px-4 py-3">
                    <h3 className="text-lg font-semibold text-white">
                      {hasMultipleRounds && selectedRound !== 'overall'
                        ? `${selectedRound} Emotional Analysis`
                        : 'Emotional Analysis by Round'
                      }
                    </h3>
                  </div>
                  <div className="bg-black/20 p-4">
                    <div className="grid gap-4">
                      {Object.entries(groupEmotionsByRound(getRoundData(selectedRound)?.emotionsData || [])).map(([roundType, items]) => {
                        if (items.length === 0) return null;
                        
                        // Skip filtering by round if we're already showing round-specific data
                        if (hasMultipleRounds && selectedRound !== 'overall' && roundType !== selectedRound && roundType !== 'unspecified') {
                          return null;
                        }
                        
                        const roundColor = getEmotionColor(roundType as InterviewRoundType);
                        const roundName = getRoundName(roundType as InterviewRoundType);
                        
                        return (
                          <div key={roundType} className="bg-black/30 rounded-lg p-4 border border-gray-800">
                            <div className="flex items-center justify-between mb-3">
                              <h4 
                                className="text-md font-medium flex items-center gap-2"
                                style={{ color: roundColor }}
                              >
                                <div className="h-3 w-3 rounded-full" style={{ backgroundColor: roundColor }}></div>
                                {roundName}
                              </h4>
                              <span className="text-xs text-gray-400">{items.length} interactions</span>
                            </div>
                            
                            <div className="space-y-3">
                              {items.map((item: any, index: number) => {
                                const isExpanded = expandedItems[`${roundType}-${index}`] || false;
                                
                                return (
                                  <div key={index} className="bg-black/40 p-3 rounded border border-gray-800">
                                    <div className="mb-2">
                                      <div className="text-sm text-gray-400 mb-1">Question:</div>
                                      <div className="text-white">{item.question}</div>
                                    </div>
                                    <div className="mb-3">
                                      <div className="text-sm text-gray-400 mb-1">Answer:</div>
                                      <div className="text-white text-sm">{item.answer}</div>
                                      {item.responseTime > 0 && (
                                        <div className="flex items-center gap-2 mt-1">
                                          <span className="text-xs text-gray-500">
                                            Response time: {item.responseTime.toFixed(1)}s
                                          </span>
                                          {item.isFollowUp && (
                                            <span className="text-xs bg-blue-900/30 text-blue-400 px-1.5 py-0.5 rounded">
                                              Follow-up
                                            </span>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                    <div>
                                      <div className="text-sm text-gray-400 mb-1">Emotions:</div>
                                      <div className="flex flex-wrap gap-2">
                                        {item.emotions && (isExpanded ? item.emotions : item.emotions.slice(0, 3)).map((emotion: any, idx: number) => (
                                          <div 
                                            key={idx} 
                                            className="px-2 py-1 rounded-md text-xs flex items-center gap-1.5 transition-colors"
                                            style={{ 
                                              backgroundColor: `${getEmotionColor(emotion.name)}30`,
                                              color: getTextColorFromBg(getEmotionColor(emotion.name))
                                            }}
                                          >
                                            <div className="h-2 w-2 rounded-full" style={{ backgroundColor: getTextColorFromBg(getEmotionColor(emotion.name))}}></div>
                                            <span className="font-medium capitalize">{emotion.name}</span>
                                            <span className="font-mono bg-black/30 px-1.5 rounded">
                                              {Math.round(emotion.score * 100)}%
                                            </span>
                                          </div>
                                        ))}
                                        
                                        {item.emotions && item.emotions.length > 3 && (
                                          <button 
                                            onClick={() => toggleExpandItem(roundType, index)}
                                            className="text-xs text-blue-400 hover:underline"
                                          >
                                            {isExpanded ? "Show less" : `+${item.emotions.length - 3} more`}
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
                
                {/* Emotions Chart */}
                <div className="overflow-hidden rounded-xl border border-gray-800">
                  <div className="bg-black/40 border-b border-gray-800 px-4 py-3">
                    <h3 className="text-lg font-semibold text-white">Overall Emotion Distribution</h3>
                  </div>
                  <div className="bg-black/20 p-4">
                    {getEmotionsChartData(getRoundData(selectedRound)?.emotionsData || []) ? (
                      <div className="h-80 w-full">
                        <Bar 
                          data={getEmotionsChartData(getRoundData(selectedRound)?.emotionsData || [])!} 
                          options={{
                            responsive: true,
                            maintainAspectRatio: false,
                            scales: {
                              y: {
                                beginAtZero: true,
                                ticks: {
                                  color: 'rgba(255, 255, 255, 0.7)'
                                },
                                grid: {
                                  color: 'rgba(255, 255, 255, 0.1)'
                                }
                              },
                              x: {
                                ticks: {
                                  color: 'rgba(255, 255, 255, 0.7)'
                                },
                                grid: {
                                  color: 'rgba(255, 255, 255, 0.1)'
                                }
                              }
                            },
                            plugins: {
                              legend: {
                                display: false
                              },
                              tooltip: {
                                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                                titleColor: 'rgba(255, 255, 255, 0.9)',
                                bodyColor: 'rgba(255, 255, 255, 0.9)',
                              }
                            }
                          }} 
                        />
                      </div>
                    ) : (
                      <div className="text-center py-12 text-gray-400">
                        Not enough emotional data to generate chart
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            
            {/* Skills Gap Tab */}
            {activeTab === 'skills' && (
              <div className="space-y-6">
                <div className="bg-gradient-to-b from-black/40 to-black/20 backdrop-blur-sm border border-gray-800 rounded-xl p-6 mb-8 shadow-xl">
                  <div className="mb-6 flex items-center justify-between">
                    <div className="flex items-center">
                      <div className="h-12 w-12 rounded-full bg-gradient-to-br from-purple-500/30 to-blue-500/30 flex items-center justify-center mr-4 shadow-md border border-purple-500/20">
                        <BarChart2 className="h-6 w-6 text-purple-400" />
                      </div>
                      <div>
                        <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-300">Skills Assessment</h2>
                        <p className="text-gray-400 text-sm mt-1">Comprehensive analysis of technical and communication skills</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-center bg-black/50 backdrop-blur-sm rounded-xl px-5 py-3 border border-gray-800 shadow-inner">
                      <div className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400">{skillAnalysis.overallScore}%</div>
                      <span className="text-xs text-gray-400">Overall Score</span>
                    </div>
                  </div>
                  
                  {/* Communication Metrics */}
                  <div className="mb-8">
                    <h3 className="text-lg font-semibold text-white mb-4 flex items-center">
                      <MessageSquare className="h-5 w-5 text-blue-400 mr-2" />
                      Communication Assessment
                    </h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="bg-black/40 border border-gray-800 rounded-lg p-5">
                        <div className="flex justify-between items-center mb-4">
                          <h4 className="text-md font-medium text-white">Language Quality</h4>
                          <div className="flex items-center gap-2">
                            <div className="px-2 py-1 rounded-md bg-gradient-to-r from-blue-900/50 to-purple-900/50 border border-blue-800/50">
                              <span className="text-sm font-medium text-blue-300">
                                {Math.round(((skillAnalysis.communicationMetrics?.clarity || 0) + 
                                (skillAnalysis.communicationMetrics?.complexity || 0)) / 2)}%
                              </span>
                            </div>
                          </div>
                        </div>
                        
                        <div className="space-y-4">
                          <div>
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-sm text-gray-300">Clarity</span>
                              <span className="text-xs text-gray-400">{Math.round(skillAnalysis.communicationMetrics?.clarity || 0)}%</span>
                            </div>
                            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-gradient-to-r from-blue-500 to-blue-400" 
                                style={{ width: `${skillAnalysis.communicationMetrics?.clarity || 0}%` }}
                              />
                            </div>
                            <p className="text-xs text-gray-500 mt-1">
                              {skillAnalysis.communicationMetrics?.clarity || 0 >= 70 ? 
                                'Excellent clarity in responses, easy to understand' : 
                                skillAnalysis.communicationMetrics?.clarity || 0 >= 50 ?
                                'Good clarity, some points could be explained better' :
                                'Responses could benefit from improved clarity'
                              }
                            </p>
                          </div>
                          
                          <div>
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-sm text-gray-300">Language Complexity</span>
                              <span className="text-xs text-gray-400">{Math.round(skillAnalysis.communicationMetrics?.complexity || 0)}%</span>
                            </div>
                            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-gradient-to-r from-purple-500 to-purple-400" 
                                style={{ width: `${skillAnalysis.communicationMetrics?.complexity || 0}%` }}
                              />
                            </div>
                            <p className="text-xs text-gray-500 mt-1">
                              {skillAnalysis.communicationMetrics?.complexity || 0 >= 70 ? 
                                'Advanced vocabulary and technical language used effectively' : 
                                skillAnalysis.communicationMetrics?.complexity || 0 >= 50 ?
                                'Good use of technical terms and concepts' :
                                'Consider using more industry-specific terminology'
                              }
                            </p>
                          </div>
                        </div>
                      </div>
                      
                      <div className="bg-black/40 border border-gray-800 rounded-lg p-5">
                        <div className="flex justify-between items-center mb-4">
                          <h4 className="text-md font-medium text-white">Structure & Delivery</h4>
                          <div className="flex items-center gap-2">
                            <div className="px-2 py-1 rounded-md bg-gradient-to-r from-green-900/50 to-teal-900/50 border border-green-800/50">
                              <span className="text-sm font-medium text-green-300">
                                {Math.round(((skillAnalysis.communicationMetrics?.conciseness || 0) + 
                                (skillAnalysis.communicationMetrics?.structure || 0)) / 2)}%
                              </span>
                            </div>
                          </div>
                        </div>
                        
                        <div className="space-y-4">
                          <div>
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-sm text-gray-300">Conciseness</span>
                              <span className="text-xs text-gray-400">{Math.round(skillAnalysis.communicationMetrics?.conciseness || 0)}%</span>
                            </div>
                            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-gradient-to-r from-green-500 to-green-400" 
                                style={{ width: `${skillAnalysis.communicationMetrics?.conciseness || 0}%` }}
                              />
                            </div>
                            <p className="text-xs text-gray-500 mt-1">
                              {skillAnalysis.communicationMetrics?.conciseness || 0 >= 70 ? 
                                'Excellent: Concise responses that stay on point' : 
                                skillAnalysis.communicationMetrics?.conciseness || 0 >= 50 ?
                                'Good: Mostly direct responses with some tangents' :
                                'Areas to improve: Responses could be more focused'
                              }
                            </p>
                          </div>
                          
                          <div>
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-sm text-gray-300">Response Structure</span>
                              <span className="text-xs text-gray-400">{Math.round(skillAnalysis.communicationMetrics?.structure || 0)}%</span>
                            </div>
                            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-gradient-to-r from-teal-500 to-teal-400" 
                                style={{ width: `${skillAnalysis.communicationMetrics?.structure || 0}%` }}
                              />
                            </div>
                            <p className="text-xs text-gray-500 mt-1">
                              {skillAnalysis.communicationMetrics?.structure || 0 >= 70 ? 
                                'Well-structured responses with clear beginning, middle, and end' : 
                                skillAnalysis.communicationMetrics?.structure || 0 >= 50 ?
                                'Good structure, sometimes lacks logical flow' :
                                'Responses could benefit from improved organization'
                              }
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Skills Score Card */}
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-4 flex items-center">
                      <Brain className="h-5 w-5 text-purple-400 mr-2" />
                      Technical Skills Analysis
                    </h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                      {userSkills.skills.map((skill, index) => {
                        const skillData = skillAnalysis.detailedSkillScores?.[skill];
                        if (!skillData) return null;
                        
                        // Determine color based on score
                        const getColorClass = (score: number) => {
                          if (score >= 80) return 'from-green-500 to-emerald-400';
                          if (score >= 60) return 'from-teal-500 to-cyan-400';
                          if (score >= 40) return 'from-blue-500 to-indigo-400';
                          if (score >= 20) return 'from-yellow-500 to-amber-400';
                          return 'from-red-500 to-rose-400';
                        };

                        // Get score level text
                        const getScoreLevel = (score: number) => {
                          if (score >= 80) return 'Expert';
                          if (score >= 60) return 'Advanced';
                          if (score >= 40) return 'Intermediate';
                          if (score >= 20) return 'Basic';
                          return 'Limited';
                        };
                        
                        return (
                          <div key={index} className="bg-black/40 border border-gray-800 rounded-lg p-5 relative overflow-hidden">
                            {/* Background Pattern */}
                            <div className="absolute inset-0 opacity-5 bg-pattern-grid">
                              {/* This is a design element */}
                            </div>
                            
                            <div className="relative">
                              <div className="flex justify-between items-center mb-4">
                                <div className="flex items-center">
                                  <div className="h-8 w-8 rounded-full bg-gradient-to-br from-blue-900/40 to-purple-900/40 flex items-center justify-center mr-2 border border-blue-900/20">
                                    <span className="text-sm font-semibold text-blue-300">{index + 1}</span>
                                  </div>
                                  <h4 className="text-md font-medium text-white">{skill}</h4>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className={`px-2 py-1 rounded-md ${
                                    skillData.overallScore >= 70 ? 'bg-green-900/30 text-green-400 border border-green-800/50' :
                                    skillData.overallScore >= 40 ? 'bg-blue-900/30 text-blue-400 border border-blue-800/50' :
                                    'bg-red-900/30 text-red-400 border border-red-800/50'
                                  }`}>
                                    <span className="text-sm font-medium">
                                      {getScoreLevel(skillData.overallScore)}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              
                              <div className="space-y-3">
                                <div>
                                  <div className="flex justify-between items-center mb-1">
                                    <span className="text-sm text-gray-300">Knowledge Depth</span>
                                    <span className="text-xs text-gray-400">{skillData.depthScore}%</span>
                                  </div>
                                  <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                                    <div 
                                      className={`h-full bg-gradient-to-r ${getColorClass(skillData.depthScore)}`}
                                      style={{ width: `${skillData.depthScore}%` }}
                                    />
                                  </div>
                                </div>
                                
                                <div>
                                  <div className="flex justify-between items-center mb-1">
                                    <span className="text-sm text-gray-300">Confidence Level</span>
                                    <span className="text-xs text-gray-400">{skillData.confidenceScore}%</span>
                                  </div>
                                  <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                                    <div 
                                      className={`h-full bg-gradient-to-r ${getColorClass(skillData.confidenceScore)}`}
                                      style={{ width: `${skillData.confidenceScore}%` }}
                                    />
                                  </div>
                                </div>
                                
                                <div className="flex flex-wrap gap-2 mt-2">
                                  {skillData.overallScore >= 70 && (
                                    <span className="px-2 py-1 text-xs rounded-full bg-green-950/30 text-green-400 border border-green-900/50">
                                      Strong Demonstration
                                    </span>
                                  )}
                                  {skillData.examples && (
                                    <span className="px-2 py-1 text-xs rounded-full bg-blue-950/30 text-blue-400 border border-blue-900/50">
                                      Provided Examples
                                    </span>
                                  )}
                                  {skillData.technicalDetail && (
                                    <span className="px-2 py-1 text-xs rounded-full bg-purple-950/30 text-purple-400 border border-purple-900/50">
                                      Technical Detail
                                    </span>
                                  )}
                                  {!skillData.examples && !skillData.technicalDetail && (
                                    <span className="px-2 py-1 text-xs rounded-full bg-amber-950/30 text-amber-400 border border-amber-900/50">
                                      Mentioned Only
                                    </span>
                                  )}
                                  {skillData.overallScore < 40 && (
                                    <span className="px-2 py-1 text-xs rounded-full bg-red-950/30 text-red-400 border border-red-900/50">
                                      Needs Development
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  
                  {/* Recommended Skills Section */}
                  <div className="mt-8 bg-black/40 border border-gray-800 rounded-lg p-5">
                    <h3 className="text-md font-semibold text-white mb-4 flex items-center">
                      <ArrowUpRight className="h-4 w-4 text-blue-400 mr-2" />
                      Recommended Skills to Develop
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                      {skillAnalysis.recommendedSkills.length > 0 ? (
                        skillAnalysis.recommendedSkills.map((skill, index) => (
                          <div key={index} className="flex items-center bg-blue-950/30 rounded-lg px-3 py-2 border border-blue-900/30">
                            <div className="h-2 w-2 rounded-full bg-blue-500 mr-2"></div>
                            <span className="text-blue-200">{skill}</span>
                          </div>
                        ))
                      ) : (
                        <p className="text-gray-400 text-sm italic col-span-full">No additional skills recommended at this time.</p>
                      )}
                    </div>
                    
                    <div className="mt-5 p-4 bg-black/30 border border-gray-700/50 rounded-lg">
                      <h4 className="text-sm font-medium text-white mb-2 flex items-center">
                        <ArrowRight className="h-3.5 w-3.5 text-purple-400 mr-1.5" />
                        Next Steps
                      </h4>
                      <p className="text-sm text-gray-400">
                        Visit the <span className="text-purple-400 cursor-pointer" onClick={() => setActiveTab('improvement' as 'summary' | 'emotions' | 'transcript' | 'skills' | 'improvement')}>Improvement Plan</span> tab to see a detailed roadmap for enhancing your skills with resources and timeline.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            )}
            
            {/* Transcript Tab */}
            {activeTab === 'transcript' && (
              <div className="overflow-hidden rounded-xl border border-gray-800">
                <div className="bg-black/40 border-b border-gray-800 px-4 py-3 flex justify-between items-center">
                  <h3 className="text-lg font-semibold text-white">
                    {hasMultipleRounds && selectedRound !== 'overall'
                      ? `${selectedRound} Transcript`
                      : 'Interview Transcript'
                    }
                  </h3>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-400">
                      {getRoundData(selectedRound)?.transcriptions?.length || 0} responses
                    </span>
                    <select 
                      className="ml-2 bg-black/50 border border-gray-700 rounded text-sm text-gray-300 px-2 py-1"
                      value={itemsPerPage}
                      onChange={e => setItemsPerPage(parseInt(e.target.value))}
                    >
                      <option value="5">5 per page</option>
                      <option value="10">10 per page</option>
                      <option value="20">20 per page</option>
                    </select>
                  </div>
                </div>
                <div className="bg-black/20 divide-y divide-gray-800">
                  {(getRoundData(selectedRound)?.transcriptions || []).length > 0 ? (
                    paginate(getRoundData(selectedRound)?.transcriptions || [], currentTranscriptPage).map((transcript: string, index: number) => {
                      // Find the corresponding emotion data if possible
                      const emotionItem = (getRoundData(selectedRound)?.emotionsData || []).find(
                        item => item.answer === transcript
                      );
                      
                      return (
                        <div key={index} className="p-4">
                          <div className="flex items-start">
                            <div className="h-8 w-8 rounded-full bg-black/40 border border-gray-700 flex items-center justify-center mr-3 flex-shrink-0">
                              <User className="h-4 w-4 text-gray-400" />
                            </div>
                            <div className="flex-1">
                              {emotionItem?.question && (
                                <div className="mb-3 -mt-1 flex items-start">
                                  <div className="h-6 w-6 rounded-full bg-gray-800 flex items-center justify-center mr-2 mt-0.5 flex-shrink-0">
                                    <Bot className="h-3 w-3 text-gray-400" />
                                  </div>
                                  <div className="text-sm text-gray-400 font-light italic">
                                    {emotionItem.question}
                                  </div>
                                </div>
                              )}
                              <p className="text-white">{transcript}</p>
                              <div className="flex items-center gap-2 mt-2 flex-wrap">
                                <span className="text-xs text-gray-500">
                                  {new Date(emotionItem?.timestamp || Date.now()).toLocaleString()}
                                </span>
                                
                                {emotionItem?.responseTime && emotionItem?.responseTime > 0 && (
                                  <span className="text-xs text-gray-500">
                                    • Response time: {emotionItem?.responseTime.toFixed(1)}s
                                  </span>
                                )}
                                
                                {emotionItem?.isFollowUp && (
                                  <span className="text-xs bg-blue-900/30 text-blue-400 px-1.5 py-0.5 rounded">
                                    Follow-up
                                  </span>
                                )}
                                
                                {emotionItem?.emotions && emotionItem.emotions.length > 0 && (
                                  <div className="flex items-center gap-1 mt-2 w-full">
                                    <span className="text-xs text-gray-500 mr-1">Emotion Analysis:</span>
                                    <div className="flex flex-wrap gap-1">
                                      {emotionItem.emotions.slice(0, 4).map((emotion, idx) => (
                                        <div 
                                          key={idx} 
                                          className="px-2 py-1 rounded-md text-xs flex items-center gap-1.5 transition-colors"
                                          style={{ 
                                            backgroundColor: `${getEmotionColor(emotion.name)}30`,
                                            color: getTextColorFromBg(getEmotionColor(emotion.name))
                                          }}
                                        >
                                          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: getTextColorFromBg(getEmotionColor(emotion.name))}}></div>
                                          <span className="font-medium capitalize">{emotion.name}</span>
                                          <span className="font-mono bg-black/30 px-1.5 rounded">
                                            {Math.round(emotion.score * 100)}%
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="p-6 text-center text-gray-400">
                      No transcript available for this interview.
                    </div>
                  )}
                </div>
                
                {/* Pagination */}
                {(getRoundData(selectedRound)?.transcriptions?.length || 0) > itemsPerPage && (
                  <div className="bg-black/40 border-t border-gray-800 px-4 py-3 flex items-center justify-between">
                    <button
                      className="flex items-center text-gray-400 hover:text-white disabled:opacity-50 disabled:hover:text-gray-400"
                      onClick={() => setCurrentTranscriptPage(prev => Math.max(prev - 1, 1))}
                      disabled={currentTranscriptPage === 1}
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      Previous
                    </button>
                    <span className="text-sm text-gray-400">
                      Page {currentTranscriptPage} of {Math.ceil((getRoundData(selectedRound)?.transcriptions?.length || 0) / itemsPerPage)}
                    </span>
                    <button
                      className="flex items-center text-gray-400 hover:text-white disabled:opacity-50 disabled:hover:text-gray-400"
                      onClick={() => setCurrentTranscriptPage(prev => Math.min(prev + 1, Math.ceil((getRoundData(selectedRound)?.transcriptions?.length || 0) / itemsPerPage)))}
                      disabled={currentTranscriptPage === Math.ceil((getRoundData(selectedRound)?.transcriptions?.length || 0) / itemsPerPage)}
                    >
                      Next
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </button>
                  </div>
                )}
              </div>
            )}
            
            {/* Improvement Plan Tab */}
            {activeTab === 'improvement' && (
              <div className="space-y-6">
                {isGeneratingPlan ? (
                  <div className="flex flex-col justify-center items-center h-64 text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-white mb-4"></div>
                    <h3 className="text-xl font-semibold mb-2">Generating Your Improvement Plan</h3>
                    <p className="text-gray-400 max-w-md">
                      We're analyzing your skills and interview performance to create a personalized improvement roadmap.
                    </p>
                  </div>
                ) : improvementPlan ? (
                  <div>
                    {/* Summary Card */}
                    <div className="bg-black/30 border border-gray-800 rounded-xl p-6 mb-8">
                      <div className="mb-6 flex items-center">
                        <div className="h-10 w-10 rounded-full bg-blue-500/20 flex items-center justify-center mr-3">
                          <FileText className="h-5 w-5 text-blue-400" />
                        </div>
                        <div>
                          <h2 className="text-xl font-bold">Your Improvement Plan</h2>
                          <p className="text-gray-400 text-sm mt-1">
                            Generated on {new Date(improvementPlan.generatedAt).toLocaleDateString()}
                          </p>
                        </div>
                        <button 
                          onClick={handleDownloadResults}
                          className="ml-auto px-3 py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 rounded-lg flex items-center transition-colors"
                        >
                          <Download className="h-4 w-4 mr-2" />
                          Download
                        </button>
                      </div>
                      
                      <div className="prose prose-invert max-w-none mb-6">
                        <p className="text-gray-200">{improvementPlan.summary}</p>
                      </div>
                      
                      {/* Skill Gaps Summary */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                        <div className="bg-black/40 rounded-lg border border-gray-800 p-4">
                          <h3 className="font-semibold text-white mb-3 flex items-center">
                            <AlertTriangle className="h-4 w-4 text-amber-500 mr-2" />
                            Identified Skill Gaps
                          </h3>
                          <div className="space-y-2">
                            {improvementPlan.skillGaps.length > 0 ? (
                              improvementPlan.skillGaps.map((skill, index) => (
                                <div key={index} className="flex items-center">
                                  <div className="h-1.5 w-1.5 rounded-full bg-amber-500 mr-2"></div>
                                  <span className="text-gray-300 text-sm">{skill}</span>
                                </div>
                              ))
                            ) : (
                              <p className="text-gray-400 text-sm italic">No significant skill gaps identified.</p>
                            )}
                          </div>
                        </div>
                        
                        {/* Career Path Suggestions */}
                        <div className="bg-black/40 rounded-lg border border-gray-800 p-4">
                          <h3 className="font-semibold text-white mb-3 flex items-center">
                            <ArrowUpRight className="h-4 w-4 text-blue-400 mr-2" />
                            Suggested Career Paths
                          </h3>
                          <div className="space-y-2">
                            {improvementPlan.careerPaths.length > 0 ? (
                              improvementPlan.careerPaths.slice(0, 2).map((path, index) => (
                                <div key={index} className="flex items-center justify-between py-1">
                                  <div className="flex items-center">
                                    <div className="h-1.5 w-1.5 rounded-full bg-blue-500 mr-2"></div>
                                    <span className="text-gray-300 text-sm">{path.role}</span>
                                    <span className="text-xs ml-2 px-1.5 py-0.5 rounded bg-black/50 text-gray-400 border border-gray-700">
                                      {path.level}
                                    </span>
                                  </div>
                                  <div className="flex items-center">
                                    <div className="w-16 bg-gray-800 h-1.5 rounded-full mr-2">
                                      <div className="bg-blue-500 h-full rounded-full" style={{ width: `${path.matchPercentage}%` }}></div>
                                    </div>
                                    <span className="text-xs text-gray-400">{path.matchPercentage}%</span>
                                  </div>
                                </div>
                              ))
                            ) : (
                              <p className="text-gray-400 text-sm italic">No career paths available.</p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Timeline Roadmap */}
                    <div className="bg-black/30 border border-gray-800 rounded-xl p-6 mb-8">
                      <h3 className="text-lg font-semibold text-white mb-4 flex items-center">
                        <List className="h-5 w-5 text-indigo-400 mr-2" />
                        Skill Development Timeline
                      </h3>
                      
                      <div className="space-y-6 relative">
                        {/* Timeline line */}
                        <div className="absolute top-0 bottom-0 left-6 w-0.5 bg-gray-800 z-0"></div>
                        
                        {improvementPlan.timeline.map((item, index) => (
                          <div key={index} className="relative flex items-start z-10">
                            <div className={`h-12 w-12 rounded-full flex-shrink-0 flex items-center justify-center -ml-1.5 ${
                              item.priority === 'high' ? 'bg-red-950/50 text-red-500 border-red-800' : 
                              item.priority === 'medium' ? 'bg-amber-950/50 text-amber-500 border-amber-800' : 
                              'bg-blue-950/50 text-blue-500 border-blue-800'
                            } border-2`}>
                              {index + 1}
                            </div>
                            <div className="ml-4 -mt-1 bg-black/40 border border-gray-800 rounded-lg p-4 w-full">
                              <div className="flex justify-between items-start mb-2">
                                <h4 className="font-medium text-white">{item.task}</h4>
                                <span className={`text-xs ${
                                  item.priority === 'high' ? 'bg-red-900/50 text-red-300 border-red-800' : 
                                  item.priority === 'medium' ? 'bg-amber-900/50 text-amber-300 border-amber-800' : 
                                  'bg-blue-900/50 text-blue-300 border-blue-800'
                                } px-2 py-1 rounded border`}>
                                  {item.priority.toUpperCase()}
                                </span>
                              </div>
                              <p className="text-gray-400 text-sm">{item.duration}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    {/* Learning Resources */}
                    <div className="bg-black/30 border border-gray-800 rounded-xl p-6 mb-8">
                      <h3 className="text-lg font-semibold text-white mb-4 flex items-center">
                        <FileText className="h-5 w-5 text-green-400 mr-2" />
                        Recommended Resources
                      </h3>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {improvementPlan.resources.map((resource, index) => (
                          <div key={index} className="bg-black/40 border border-gray-800 rounded-lg p-4 hover:border-gray-700 transition-colors">
                            <div className="flex items-start mb-2">
                              <div className={`h-8 w-8 rounded-full flex-shrink-0 flex items-center justify-center mr-2 ${
                                resource.type === 'course' ? 'bg-purple-950/50 text-purple-500' : 
                                resource.type === 'book' ? 'bg-blue-950/50 text-blue-500' : 
                                resource.type === 'project' ? 'bg-green-950/50 text-green-500' : 
                                resource.type === 'video' ? 'bg-red-950/50 text-red-500' : 
                                'bg-amber-950/50 text-amber-500'
                              }`}>
                                {resource.type === 'course' && "C"}
                                {resource.type === 'book' && "B"}
                                {resource.type === 'project' && "P"}
                                {resource.type === 'video' && "V"}
                                {resource.type === 'article' && "A"}
                              </div>
                              <div>
                                <div className="flex items-center">
                                  <h4 className="font-medium text-white">{resource.title}</h4>
                                  <span className={`text-xs ml-2 ${
                                    resource.type === 'course' ? 'bg-purple-900/30 text-purple-300 border-purple-800' : 
                                    resource.type === 'book' ? 'bg-blue-900/30 text-blue-300 border-blue-800' : 
                                    resource.type === 'project' ? 'bg-green-900/30 text-green-300 border-green-800' : 
                                    resource.type === 'video' ? 'bg-red-900/30 text-red-300 border-red-800' : 
                                    'bg-amber-900/30 text-amber-300 border-amber-800'
                                  } px-1.5 py-0.5 rounded-sm border uppercase`}>
                                    {resource.type}
                                  </span>
                                </div>
                                <p className="text-gray-400 text-sm mt-1">{resource.description}</p>
                              </div>
                            </div>
                            {resource.url && (
                              <a 
                                href={resource.url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="flex items-center text-sm text-blue-400 hover:text-blue-300 mt-3 transition-colors"
                              >
                                <ExternalLink className="h-3 w-3 mr-1" />
                                View Resource
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col justify-center items-center h-64 text-center">
                    <p className="text-gray-400 max-w-md">
                      No improvement plan available. Please complete an interview first.
                    </p>
                    <button 
                      onClick={generateImprovementPlan}
                      className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                    >
                      Generate Plan
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default Results;