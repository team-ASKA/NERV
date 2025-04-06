import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ArrowLeft, Download, Brain, MessageSquare, Bot, User, ChevronLeft, ChevronRight, ArrowRight, BarChart2, AlertTriangle, CheckCircle2, ArrowUpRight, List, FileText, ExternalLink } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { FaVideo } from 'react-icons/fa';
import { motion } from 'framer-motion';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';

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

const Results = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [results, setResults] = useState<InterviewResults | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(0);
  const [userSkills, setUserSkills] = useState<UserSkills>({ skills: [], expertise: [] });
  const [skillAnalysis, setSkillAnalysis] = useState<{
    matchedSkills: string[];
    missingSkills: string[];
    recommendedSkills: string[];
    overallScore: number;
  }>({
    matchedSkills: [],
    missingSkills: [],
    recommendedSkills: [],
    overallScore: 0
  });
  // New state for the improvement plan
  const [improvementPlan, setImprovementPlan] = useState<ImprovementPlan | null>(null);
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const tabs = ["Summary", "Transcription", "Emotional Analysis", "Skill Gap Analysis", "Improvement Plan"];

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
    if (!results || !results.emotionsData) return;
    
    // Extract all text from answers for analysis
    const allAnswersText = results.emotionsData
      .map(item => item.answer)
      .join(' ')
      .toLowerCase();
    
    // Check which skills from the user's profile were demonstrated in the interview
    const matchedSkills = userSkills.skills.filter(skill => 
      allAnswersText.includes(skill.toLowerCase())
    );
    
    // Skills that were not demonstrated
    const missingSkills = userSkills.skills.filter(skill => 
      !allAnswersText.includes(skill.toLowerCase())
    );
    
    // Get common technical skills to recommend
    const commonTechSkills = [
      'javascript', 'react', 'typescript', 'node.js', 'python', 
      'java', 'sql', 'aws', 'git', 'css', 'html', 'docker',
      'kubernetes', 'c#', 'c++', 'ruby', 'php', 'golang', 'swift',
      'vue.js', 'angular', 'devops', 'graphql', 'rest api'
    ];
    
    // Check which common skills were mentioned in the interview but not in user profile
    const mentionedCommonSkills = commonTechSkills.filter(skill => 
      allAnswersText.includes(skill) && 
      !userSkills.skills.some(userSkill => userSkill.toLowerCase() === skill)
    );
    
    // Recommend skills based on what was mentioned but not in profile
    // and some important skills that weren't mentioned
    const recommendedSkills = [
      ...mentionedCommonSkills,
      ...commonTechSkills
        .filter(skill => !allAnswersText.includes(skill))
        .slice(0, 3)
    ].slice(0, 5); // Limit to 5 recommendations
    
    // Calculate an overall score (percentage of skills demonstrated)
    const overallScore = userSkills.skills.length > 0 
      ? Math.round((matchedSkills.length / userSkills.skills.length) * 100) 
      : 0;
    
    setSkillAnalysis({
      matchedSkills,
      missingSkills,
      recommendedSkills,
      overallScore
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
                  
                  {results.summary ? (
                    <div className="space-y-6">
                      {/* Animated card with overall assessment */}
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4 }}
                        className="bg-gradient-to-r from-blue-900/40 to-indigo-900/40 p-6 rounded-xl border border-blue-500/30 shadow-lg"
                      >
                        <div className="flex items-center mb-3">
                          <BarChart2 className="h-5 w-5 text-blue-400 mr-2" />
                          <h3 className="text-xl font-semibold text-blue-300">Overall Assessment</h3>
                        </div>
                        <div className="prose prose-invert max-w-none prose-p:text-white/90 prose-headings:text-white/90 prose-a:text-blue-300">
                          {/* Extract and display the first paragraph as the overall assessment */}
                          <ReactMarkdown>
                            {results.summary.split('\n\n')[0]}
                          </ReactMarkdown>
                        </div>
                      </motion.div>

                      {/* Strengths section */}
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4, delay: 0.1 }}
                        className="bg-gradient-to-r from-green-900/40 to-emerald-900/40 p-6 rounded-xl border border-green-500/30 shadow-lg"
                      >
                        <div className="flex items-center mb-3">
                          <CheckCircle2 className="h-5 w-5 text-green-400 mr-2" />
                          <h3 className="text-xl font-semibold text-green-300">Strengths</h3>
                        </div>
                        <div className="prose prose-invert max-w-none prose-p:text-white/90 prose-headings:text-white/90 prose-a:text-green-300">
                          {/* Extract strengths section if it exists */}
                          <ReactMarkdown>
                            {results.summary.includes('Strengths') ? 
                              results.summary.split('Strengths')[1].split('Areas for Improvement')[0] : 
                              results.summary.split('\n\n')[1] || ''}
                          </ReactMarkdown>
                        </div>
                      </motion.div>

                      {/* Areas for improvement section */}
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4, delay: 0.2 }}
                        className="bg-gradient-to-r from-amber-900/40 to-orange-900/40 p-6 rounded-xl border border-amber-500/30 shadow-lg"
                      >
                        <div className="flex items-center mb-3">
                          <AlertTriangle className="h-5 w-5 text-amber-400 mr-2" />
                          <h3 className="text-xl font-semibold text-amber-300">Areas for Improvement</h3>
                        </div>
                        <div className="prose prose-invert max-w-none prose-p:text-white/90 prose-headings:text-white/90 prose-a:text-amber-300">
                          {/* Extract areas for improvement section if it exists */}
                          <ReactMarkdown>
                            {results.summary.includes('Areas for Improvement') ? 
                              results.summary.split('Areas for Improvement')[1].split('Recommendations')[0] : 
                              results.summary.split('\n\n')[2] || ''}
                          </ReactMarkdown>
                        </div>
                      </motion.div>

                      {/* Recommendations section */}
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4, delay: 0.3 }}
                        className="bg-gradient-to-r from-purple-900/40 to-violet-900/40 p-6 rounded-xl border border-purple-500/30 shadow-lg"
                      >
                        <div className="flex items-center mb-3">
                          <ArrowUpRight className="h-5 w-5 text-purple-400 mr-2" />
                          <h3 className="text-xl font-semibold text-purple-300">Recommendations</h3>
                        </div>
                        <div className="prose prose-invert max-w-none prose-p:text-white/90 prose-headings:text-white/90 prose-a:text-purple-300">
                          {/* Extract recommendations section if it exists */}
                          <ReactMarkdown>
                            {results.summary.includes('Recommendations') ? 
                              results.summary.split('Recommendations')[1] : 
                              results.summary.split('\n\n')[3] || ''}
                          </ReactMarkdown>
                        </div>
                      </motion.div>

                      {/* Key points section */}
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4, delay: 0.4 }}
                        className="bg-gradient-to-r from-gray-800/40 to-gray-700/40 p-6 rounded-xl border border-gray-500/30 shadow-lg"
                      >
                        <div className="flex items-center mb-3">
                          <List className="h-5 w-5 text-gray-400 mr-2" />
                          <h3 className="text-xl font-semibold text-gray-300">Key Points</h3>
                        </div>
                        <div className="prose prose-invert max-w-none prose-p:text-white/90 prose-headings:text-white/90 prose-a:text-gray-300">
                          {/* Display full summary as fallback */}
                          <ReactMarkdown>
                            {results.summary.split('\n\n').slice(4).join('\n\n') || ''}
                          </ReactMarkdown>
                        </div>
                      </motion.div>
                    </div>
                  ) : (
                    <div className="bg-gradient-to-r from-gray-900/40 to-gray-800/40 p-6 rounded-xl border border-gray-500/30 shadow-lg">
                      <h3 className="text-xl font-semibold text-white mb-3">Interview Completed</h3>
                      <p className="text-white/80 mb-2">You've successfully completed your interview with NERV AI.</p>
                      <p className="text-white/80 mb-2">Check the Transcription tab to review your conversation, and the Emotional Analysis tab to see insights about your emotional expressions during the interview.</p>
                      <p className="text-white/80">To start a new interview, click the "Start New Interview" button below.</p>
                    </div>
                  )}
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
              
              {/* Skill Gap Analysis Tab */}
              {activeTab === 3 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.5 }}
                  className="p-8 rounded-xl bg-black/80 backdrop-blur-sm border border-white/10 hover:border-white/30 transition-all"
                >
                  <div className="flex items-center mb-6">
                    <BarChart2 className="h-6 w-6 text-white mr-3" />
                    <h2 className="font-montserrat font-semibold text-2xl">Skill Gap Analysis</h2>
                  </div>
                  
                  {userSkills.skills.length > 0 ? (
                    <div className="space-y-8">
                      {/* Overall Score */}
                      <div className="bg-black/40 rounded-lg p-6 border border-white/10">
                        <h3 className="text-lg font-medium mb-4">Resume Skills Utilization</h3>
                        <div className="flex flex-col sm:flex-row items-center justify-between">
                          <div className="relative w-32 h-32 mb-4 sm:mb-0">
                            <svg className="w-full h-full" viewBox="0 0 36 36">
                              <path
                                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                fill="none"
                                stroke="#2a2a2a"
                                strokeWidth="3"
                              />
                              <path
                                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                fill="none"
                                stroke="url(#gradient)"
                                strokeWidth="3"
                                strokeDasharray={`${skillAnalysis.overallScore}, 100`}
                              />
                              <defs>
                                <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                                  <stop offset="0%" stopColor="#4F46E5" />
                                  <stop offset="100%" stopColor="#8B5CF6" />
                                </linearGradient>
                              </defs>
                            </svg>
                            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-center">
                              <div className="text-2xl font-bold">{skillAnalysis.overallScore}%</div>
                              <div className="text-xs text-gray-400">Skills Utilized</div>
                            </div>
                          </div>
                          
                          <div className="flex-1 ml-4">
                            <p className="text-white/70 mb-4">
                              {skillAnalysis.overallScore > 70 
                                ? "You effectively demonstrated a high percentage of your resume skills during the interview. Great job!"
                                : skillAnalysis.overallScore > 40
                                ? "You demonstrated some of the skills from your resume during the interview, but could improve on highlighting more of your expertise."
                                : "You demonstrated few of the skills listed in your resume during the interview. Focus on weaving your key skills into your answers."}
                            </p>
                            <p className="text-white/60 text-sm">
                              Based on {userSkills.skills.length} skills in your profile and {skillAnalysis.matchedSkills.length} mentioned during your interview.
                            </p>
                          </div>
                        </div>
                      </div>
                      
                      {/* Skills Analysis */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Demonstrated Skills */}
                        <div className="bg-black/40 rounded-lg p-6 border border-white/10">
                          <div className="flex items-center mb-4">
                            <CheckCircle2 className="h-5 w-5 text-green-500 mr-2" />
                            <h3 className="text-lg font-medium">Demonstrated Resume Skills</h3>
                          </div>
                          
                          {skillAnalysis.matchedSkills.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {skillAnalysis.matchedSkills.map((skill, index) => (
                                <motion.span
                                  key={index}
                                  initial={{ opacity: 0, scale: 0.8 }}
                                  animate={{ opacity: 1, scale: 1 }}
                                  transition={{ duration: 0.3, delay: index * 0.05 }}
                                  className="px-3 py-1 rounded-full bg-green-500/20 text-green-400 text-sm border border-green-500/30"
                                >
                                  {skill}
                                </motion.span>
                              ))}
                            </div>
                          ) : (
                            <p className="text-white/60">No skills from your resume were mentioned during the interview.</p>
                          )}
                        </div>
                        
                        {/* Missing Skills */}
                        <div className="bg-black/40 rounded-lg p-6 border border-white/10">
                          <div className="flex items-center mb-4">
                            <AlertTriangle className="h-5 w-5 text-amber-500 mr-2" />
                            <h3 className="text-lg font-medium">Unmentiond Resume Skills</h3>
                          </div>
                          
                          {skillAnalysis.missingSkills.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {skillAnalysis.missingSkills.map((skill, index) => (
                                <motion.span
                                  key={index}
                                  initial={{ opacity: 0, scale: 0.8 }}
                                  animate={{ opacity: 1, scale: 1 }}
                                  transition={{ duration: 0.3, delay: index * 0.05 }}
                                  className="px-3 py-1 rounded-full bg-amber-500/20 text-amber-400 text-sm border border-amber-500/30"
                                >
                                  {skill}
                                </motion.span>
                              ))}
                            </div>
                          ) : (
                            <p className="text-white/60">You mentioned all skills from your resume. Great job!</p>
                          )}
                        </div>
                      </div>
                      
                      {/* Recommendations */}
                      <div className="bg-black/40 rounded-lg p-6 border border-white/10">
                        <div className="flex items-center mb-4">
                          <ArrowUpRight className="h-5 w-5 text-blue-500 mr-2" />
                          <h3 className="text-lg font-medium">Improvement Recommendations</h3>
                        </div>
                        
                        <div className="space-y-4">
                          <p className="text-white/70">
                            Based on your interview performance and resume skills, here are some recommendations to improve your skill presentation:
                          </p>
                          
                          <ul className="space-y-3">
                            {skillAnalysis.missingSkills.length > 0 && (
                              <li className="flex items-start">
                                <List className="h-5 w-5 text-white/70 mr-2 flex-shrink-0 mt-0.5" />
                                <span className="text-white/70">
                                  Highlight your <strong className="text-white/90">{skillAnalysis.missingSkills.slice(0, 3).join(', ')}</strong> skills in future interviews, as they were in your resume but not mentioned.
                                </span>
                              </li>
                            )}
                            
                            <li className="flex items-start">
                              <List className="h-5 w-5 text-white/70 mr-2 flex-shrink-0 mt-0.5" />
                              <span className="text-white/70">
                                Provide specific examples that demonstrate your resume skills rather than just listing them.
                              </span>
                            </li>
                            
                            <li className="flex items-start">
                              <List className="h-5 w-5 text-white/70 mr-2 flex-shrink-0 mt-0.5" />
                              <span className="text-white/70">
                                Consider adding these relevant skills to your resume:
                              </span>
                            </li>
                          </ul>
                          
                          <div className="flex flex-wrap gap-2 mt-2">
                            {skillAnalysis.recommendedSkills.map((skill, index) => (
                              <motion.span
                                key={index}
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ duration: 0.3, delay: index * 0.05 }}
                                className="px-3 py-1 rounded-full bg-blue-500/20 text-blue-400 text-sm border border-blue-500/30"
                              >
                                {skill}
                              </motion.span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-10">
                      <p className="text-gray-400 mb-4">No resume data was found. Please upload your resume to enable skill gap analysis.</p>
                      <button
                        onClick={() => navigate('/dashboard')}
                        className="px-4 py-2 bg-white text-black rounded-lg hover:bg-black hover:text-white hover:border hover:border-white transition-all"
                      >
                        Go to Dashboard
                      </button>
                    </div>
                  )}
                </motion.div>
              )}
              
              {/* Improvement Plan Tab - NEW */}
              {activeTab === 4 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.5 }}
                  className="p-8 rounded-xl bg-black/80 backdrop-blur-sm border border-white/10 hover:border-white/30 transition-all"
                >
                  <div className="flex items-center mb-6">
                    <Brain className="h-6 w-6 text-white mr-3" />
                    <h2 className="font-montserrat font-semibold text-2xl">Improvement Plan</h2>
                  </div>
                  
                  {!improvementPlan && !isGeneratingPlan && (
                    <div className="text-center py-8">
                      <p className="text-white/70 mb-6">Generate a personalized improvement plan based on your interview performance.</p>
                      <button
                        onClick={generateImprovementPlan}
                        className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:from-indigo-700 hover:to-purple-700 transition-all flex items-center justify-center mx-auto"
                      >
                        <Brain className="h-5 w-5 mr-2" />
                        Generate Improvement Plan
                      </button>
                    </div>
                  )}
                  
                  {isGeneratingPlan && (
                    <div className="text-center py-10">
                      <div className="animate-spin h-10 w-10 border-2 border-white border-t-transparent rounded-full mx-auto mb-4"></div>
                      <p className="text-white/70">Analyzing your interview performance and generating recommendations...</p>
                    </div>
                  )}
                  
                  {improvementPlan && !isGeneratingPlan && (
                    <div className="space-y-8">
                      {/* Plan Summary */}
                      <div className="bg-gradient-to-r from-indigo-900/30 to-purple-900/30 p-6 rounded-lg border border-white/10">
                        <h3 className="text-lg font-medium mb-3">Plan Overview</h3>
                        <p className="text-white/80">{improvementPlan.summary}</p>
                      </div>
                      
                      {/* Skill Gaps */}
                      <div className="bg-black/40 rounded-lg p-6 border border-white/10">
                        <h3 className="text-lg font-medium mb-4">Identified Skill Gaps</h3>
                        
                        {improvementPlan.skillGaps.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {improvementPlan.skillGaps.map((skill, index) => (
                              <motion.span
                                key={index}
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ duration: 0.3, delay: index * 0.05 }}
                                className="px-3 py-1 rounded-full bg-amber-500/20 text-amber-400 text-sm border border-amber-500/30"
                              >
                                {skill}
                              </motion.span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-white/60">No significant skill gaps identified. Focus on improving your existing skills.</p>
                        )}
                      </div>
                      
                      {/* Timeline */}
                      <div className="bg-black/40 rounded-lg p-6 border border-white/10">
                        <h3 className="text-lg font-medium mb-4">Development Timeline</h3>
                        
                        <div className="space-y-4">
                          {improvementPlan.timeline.map((item, index) => (
                            <motion.div 
                              key={index}
                              initial={{ opacity: 0, x: -20 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ duration: 0.3, delay: index * 0.1 }}
                              className="flex items-start"
                            >
                              <div className="relative">
                                <div className={`
                                  w-4 h-4 rounded-full mt-1
                                  ${item.priority === 'high' ? 'bg-red-500' : 
                                    item.priority === 'medium' ? 'bg-yellow-500' : 'bg-blue-500'}
                                `}></div>
                                {index < improvementPlan.timeline.length - 1 && (
                                  <div className="absolute top-5 bottom-0 left-2 w-0.5 -ml-px h-full bg-white/10"></div>
                                )}
                              </div>
                              <div className="ml-4 pb-8">
                                <div className="flex items-center">
                                  <span className="text-white/40 text-sm font-medium bg-white/5 px-2 py-1 rounded">
                                    {item.duration}
                                  </span>
                                  <span className={`
                                    ml-2 text-xs px-2 py-0.5 rounded-full
                                    ${item.priority === 'high' ? 'bg-red-500/20 text-red-400' : 
                                      item.priority === 'medium' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-blue-500/20 text-blue-400'}
                                  `}>
                                    {item.priority.toUpperCase()} PRIORITY
                                  </span>
                                </div>
                                <p className="text-white/80 mt-2">{item.task}</p>
                              </div>
                            </motion.div>
                          ))}
                        </div>
                      </div>
                      
                      {/* Recommended Resources */}
                      <div className="bg-black/40 rounded-lg p-6 border border-white/10">
                        <h3 className="text-lg font-medium mb-4">Recommended Resources</h3>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {improvementPlan.resources.map((resource, index) => (
                            <motion.div
                              key={index}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.3, delay: index * 0.05 }}
                              className="bg-black/30 p-4 rounded-lg border border-white/10 hover:border-white/30 transition-all"
                            >
                              <div className="flex items-start">
                                <div className={`
                                  p-2 rounded-lg mr-3 flex-shrink-0
                                  ${resource.type === 'course' ? 'bg-blue-500/20' :
                                    resource.type === 'book' ? 'bg-purple-500/20' :
                                    resource.type === 'project' ? 'bg-green-500/20' :
                                    resource.type === 'video' ? 'bg-red-500/20' : 'bg-amber-500/20'}
                                `}>
                                  {resource.type === 'course' && <ArrowRight className="h-5 w-5 text-blue-400" />}
                                  {resource.type === 'book' && <FileText className="h-5 w-5 text-purple-400" />}
                                  {resource.type === 'project' && <CheckCircle2 className="h-5 w-5 text-green-400" />}
                                  {resource.type === 'video' && <FaVideo className="h-5 w-5 text-red-400" />}
                                  {resource.type === 'article' && <FileText className="h-5 w-5 text-amber-400" />}
                                </div>
                                <div>
                                  <h4 className="font-medium text-white/90 mb-1">{resource.title}</h4>
                                  <div className="text-xs text-white/50 mb-2 uppercase tracking-wider">
                                    {resource.type}
                                  </div>
                                  <p className="text-white/70 text-sm mb-2">{resource.description}</p>
                                  {resource.url && (
                                    <a 
                                      href={resource.url} 
                                      target="_blank" 
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center text-indigo-400 hover:text-indigo-300 text-sm"
                                    >
                                      View Resource <ExternalLink className="h-3 w-3 ml-1" />
                                    </a>
                                  )}
                                </div>
                              </div>
                            </motion.div>
                          ))}
                        </div>
                      </div>
                      
                      {/* Career Paths */}
                      <div className="bg-black/40 rounded-lg p-6 border border-white/10">
                        <h3 className="text-lg font-medium mb-4">Recommended Career Paths</h3>
                        
                        <div className="space-y-6">
                          {improvementPlan.careerPaths.map((path, index) => (
                            <motion.div
                              key={index}
                              initial={{ opacity: 0, y: 20 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.4, delay: index * 0.1 }}
                              className="bg-gradient-to-r from-black/50 to-black/20 rounded-lg p-5 border border-white/10"
                            >
                              <div className="flex flex-col md:flex-row md:items-center justify-between mb-4">
                                <div>
                                  <h4 className="font-medium text-lg text-white/90">{path.role}</h4>
                                  <div className="flex items-center mt-1">
                                    <span className={`
                                      text-xs px-2 py-0.5 rounded-full
                                      ${path.level === 'entry' ? 'bg-green-500/20 text-green-400' : 
                                        path.level === 'mid' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'}
                                    `}>
                                      {path.level.toUpperCase()} LEVEL
                                    </span>
                                  </div>
                                </div>
                                
                                <div className="mt-4 md:mt-0">
                                  <div className="flex items-center">
                                    <div className="relative w-24 h-24">
                                      <svg className="w-full h-full" viewBox="0 0 36 36">
                                        <path
                                          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                          fill="none"
                                          stroke="#2a2a2a"
                                          strokeWidth="3"
                                        />
                                        <path
                                          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                          fill="none"
                                          stroke="url(#gradient-career)"
                                          strokeWidth="3"
                                          strokeDasharray={`${path.matchPercentage}, 100`}
                                        />
                                        <defs>
                                          <linearGradient id="gradient-career" x1="0%" y1="0%" x2="100%" y2="0%">
                                            <stop offset="0%" stopColor="#4F46E5" />
                                            <stop offset="100%" stopColor="#8B5CF6" />
                                          </linearGradient>
                                        </defs>
                                      </svg>
                                      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-center">
                                        <div className="text-xl font-bold">{path.matchPercentage}%</div>
                                        <div className="text-xs text-gray-400">Match</div>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                              
                              <p className="text-white/70 mb-3">{path.description}</p>
                              
                              <div>
                                <h5 className="text-sm font-medium text-white/90 mb-2">Required Skills:</h5>
                                <div className="flex flex-wrap gap-2">
                                  {path.requiredSkills.map((skill, idx) => (
                                    <span 
                                      key={idx}
                                      className={`px-2 py-1 rounded-full text-xs 
                                        ${skillAnalysis.matchedSkills.includes(skill) ? 
                                          'bg-green-500/20 text-green-400 border border-green-500/30' : 
                                          'bg-gray-500/20 text-gray-400 border border-gray-500/30'}`
                                      }
                                    >
                                      {skill}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            </motion.div>
                          ))}
                        </div>
                      </div>
                    </div>
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