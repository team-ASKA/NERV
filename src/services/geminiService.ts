import { GoogleGenerativeAI } from "@google/generative-ai";

// Initialize the Gemini API with your API key
const getGeminiAPI = () => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY || '';
  if (!apiKey) {
    console.warn('Gemini API key is missing. Using mock responses.');
    return null;
  }
  return new GoogleGenerativeAI(apiKey);
};

// Create a model instance if API key is available
const getModel = () => {
  const genAI = getGeminiAPI();
  if (!genAI) return null;
  return genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
};

// Store conversation history for context
let conversationHistory: { role: 'user' | 'model', parts: string }[] = [];
let resumeContext = '';
let emotionData: { question: string, emotions: any[] }[] = [];
let questionEmotionsMap: {[questionId: number]: any[]} = {};

/**
 * Initialize the interview with resume data
 * @param resumeText - The text extracted from the resume PDF
 */
export const initializeInterview = async (resumeText: string): Promise<string[]> => {
  try {
    // Reset conversation history and emotion data
    conversationHistory = [];
    emotionData = [];
    resumeContext = resumeText;
    
    // Log the resume text length to verify it's being passed correctly
    console.log("Gemini service - Resume text length:", resumeText?.length);

    // Generate initial prompt with resume context
    const prompt = `
      You are an AI technical interviewer named NERV. You're conducting a job interview.
      
      Here is the candidate's resume:
      ${resumeText}
      
      Based on this resume, generate 5 specific interview questions with the following mix:
      
      1. 70% of questions should directly reference the candidate's experience, skills, and past projects mentioned in their resume:
         - Reference specific projects, technologies, companies, or accomplishments mentioned in the resume
         - Ask about specific challenges they faced, how they solved problems, or implementation details
         - Ask about specific technologies they've listed (e.g., "I see you used React for Project X. How did you handle state management in that application?")
         - For each question, include a direct reference to something specific from their resume
      
      2. 30% of questions should be algorithm/data structure questions in a LeetCode style:
         - Present a clear problem statement in algorithm format 
         - Make the problems relevant to their background when possible
         - Include time/space complexity considerations
         - Ask them to explain their approach to solving algorithm problems
      
      DO NOT ask generic questions like "Can you explain a complex data structure you've used?" without relating it to their specific experience.
      
      Format your response as a JSON array of strings, with each string being a question.
      Do not include any other text in your response.
    `;

    // Add to conversation history
    conversationHistory.push({ role: 'user', parts: prompt });

    const model = getModel();
    if (!model) {
      console.log('Using fallback questions due to missing API key');
      return getDefaultQuestions();
    }

    // Generate questions
    const result = await model.generateContent(prompt);
    const response = result.response.text();
    
    // Add to conversation history
    conversationHistory.push({ role: 'model', parts: response });

    // Parse the JSON response to get the questions
    try {
      // The response might have markdown code blocks, so we need to extract the JSON
      const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/) || 
                        response.match(/```\n([\s\S]*?)\n```/) ||
                        [null, response];
      
      const jsonString = jsonMatch[1] || response;
      const questions = JSON.parse(jsonString);
      
      if (Array.isArray(questions) && questions.length > 0) {
        console.log("Gemini successfully generated questions:", questions.length);
        return questions;
      } else {
        console.error("Invalid questions format from Gemini:", questions);
        return getFallbackQuestions();
      }
    } catch (parseError) {
      console.error("Error parsing questions from Gemini:", parseError);
      return getFallbackQuestions();
    }
  } catch (error) {
    console.error("Error initializing interview with Gemini:", error);
    return getFallbackQuestions();
  }
};

/**
 * Process the user's answer and generate feedback
 * @param question - The question that was asked
 * @param answer - The user's answer to the question
 * @param emotions - The emotions detected during the answer
 */
export const processAnswer = async (
  question: string, 
  answer: string, 
  emotions: any[] = []
): Promise<string> => {
  try {
    // Store emotions for this question
    emotionData.push({
      question,
      emotions: [...emotions]
    });

    // Create prompt for analyzing the answer
    const emotionContext = emotions.length > 0 
      ? `The candidate showed these emotions while answering: ${JSON.stringify(emotions.slice(0, 5))}.` 
      : '';

    const prompt = `
      You are an AI technical interviewer named NERV. You're evaluating a candidate's response.
      
      Resume context: ${resumeContext.substring(0, 500)}...
      
      Question: ${question}
      
      Candidate's answer: ${answer}
      
      ${emotionContext}
      
      Provide a brief, constructive feedback on the candidate's answer. Be encouraging but honest.
      Keep your response under 3 sentences. Don't explicitly mention the emotions unless they're
      very relevant to your feedback.
    `;

    // Add to conversation history (keeping a limited context window)
    if (conversationHistory.length > 6) {
      // Keep the resume context and the last 3 exchanges
      const resumePrompt = conversationHistory[0];
      conversationHistory = [resumePrompt, ...conversationHistory.slice(-6)];
    }
    
    conversationHistory.push({ role: 'user', parts: prompt });

    const model = getModel();
    if (!model) {
      return "Your answer shows good understanding. I appreciate your detailed explanation.";
    }

    // Generate feedback
    const result = await model.generateContent(prompt);
    const feedback = result.response.text();
    
    // Add to conversation history
    conversationHistory.push({ role: 'model', parts: feedback });

    return feedback;
  } catch (error) {
    console.error("Error processing answer with Gemini:", error);
    return "Thank you for your answer. Let's move on to the next question.";
  }
};

/**
 * Generate the next question based on the conversation history
 */
export const generateNextQuestion = async (): Promise<string> => {
  try {
    const prompt = `
      Based on our conversation so far and the candidate's resume, generate the next technical interview question.
      Make it relevant to their background but also challenging. Ask only ONE question and keep it concise.
    `;

    // Add to conversation history
    conversationHistory.push({ role: 'user', parts: prompt });

    const model = getModel();
    if (!model) {
      const defaultQuestions = getDefaultQuestions();
      const randomIndex = Math.floor(Math.random() * defaultQuestions.length);
      return defaultQuestions[randomIndex];
    }

    // Generate next question
    const result = await model.generateContent(prompt);
    const nextQuestion = result.response.text();
    
    // Add to conversation history
    conversationHistory.push({ role: 'model', parts: nextQuestion });

    return nextQuestion;
  } catch (error) {
    console.error("Error generating next question with Gemini:", error);
    return "Can you tell me about a challenging project you worked on recently?";
  }
};

/**
 * Generate a final summary of the interview
 */
export const generateInterviewSummary = async (): Promise<string> => {
  try {
    const prompt = `
      You are an AI technical interviewer named NERV. You've just completed an interview with a candidate.
      
      Based on our conversation and the candidate's responses, provide a brief summary of their performance.
      Highlight 2-3 strengths and 1-2 areas for improvement. Be constructive and encouraging.
      
      Keep your response under 5 sentences.
    `;

    const model = getModel();
    if (!model) {
      return "Thank you for completing this interview. You demonstrated good technical knowledge and communication skills. Your problem-solving approach was methodical and clear. Consider providing more specific examples in your answers. I wish you the best in your job search!";
    }

    // Generate summary
    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (error) {
    console.error("Error generating interview summary with Gemini:", error);
    return "Thank you for completing this interview. You demonstrated good technical knowledge and communication skills. I wish you the best in your job search!";
  }
};

/**
 * Get the stored emotion data for the results page
 */
export const getEmotionData = (): { question: string, emotions: any[] }[] => {
  return emotionData;
};

/**
 * Generate a detailed analysis for the results page
 */
export const generateResultsAnalysis = async (): Promise<any> => {
  try {
    // Create a prompt that includes all the emotion data
    const emotionSummary = emotionData.map(data => 
      `Question: ${data.question}\nEmotions: ${JSON.stringify(data.emotions.slice(0, 3))}`
    ).join('\n\n');

    const prompt = `
      You are an AI technical interviewer named NERV. You've completed an interview with a candidate.
      
      Resume context: ${resumeContext.substring(0, 300)}...
      
      Here is the emotion data captured during the interview:
      ${emotionSummary}
      
      Based on the candidate's responses and emotional reactions, generate a comprehensive analysis
      of their interview performance. Include:
      
      1. Overall assessment
      2. Technical strengths
      3. Communication skills
      4. Areas for improvement
      5. Emotional intelligence observations
      
      Format your response as a JSON object with these sections as keys.
    `;

    const model = getModel();
    if (!model) {
      return {
        overallAssessment: "The candidate showed good technical knowledge and communication skills throughout the interview. They demonstrated a solid understanding of core concepts and articulated their thoughts clearly.",
        technicalStrengths: [
          "Demonstrated understanding of core concepts",
          "Showed problem-solving abilities",
          "Familiar with relevant technologies"
        ],
        communicationSkills: "Clear and concise communication with good technical vocabulary and explanation skills.",
        areasForImprovement: [
          "Could provide more detailed examples from past experience",
          "May benefit from more structured responses"
        ],
        emotionalIntelligenceObservations: "Maintained composure throughout the interview, showing confidence when discussing familiar topics."
      };
    }

    // Generate analysis
    const result = await model.generateContent(prompt);
    const response = result.response.text();
    
    // Parse the JSON response
    try {
      // The response might have markdown code blocks, so we need to extract the JSON
      const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/) || 
                        response.match(/```\n([\s\S]*?)\n```/) ||
                        [null, response];
      
      const jsonString = jsonMatch[1] || response;
      return JSON.parse(jsonString);
    } catch (parseError) {
      console.error("Error parsing results analysis:", parseError);
      return {
        overallAssessment: "The candidate showed good technical knowledge and communication skills.",
        technicalStrengths: ["Demonstrated understanding of core concepts"],
        communicationSkills: "Clear and concise communication",
        areasForImprovement: ["Could provide more detailed examples"],
        emotionalIntelligenceObservations: "Maintained composure throughout the interview"
      };
    }
  } catch (error) {
    console.error("Error generating results analysis with Gemini:", error);
    return {
      overallAssessment: "The candidate showed good technical knowledge and communication skills.",
      technicalStrengths: ["Demonstrated understanding of core concepts"],
      communicationSkills: "Clear and concise communication",
      areasForImprovement: ["Could provide more detailed examples"],
      emotionalIntelligenceObservations: "Maintained composure throughout the interview"
    };
  }
};

/**
 * Fallback questions that combine resume-based and algorithm questions
 */
const getFallbackQuestions = (): string[] => {
  return [
    "Tell me about your most recent project mentioned in your resume.",
    "What is your greatest technical accomplishment?",
    "Implement a function to find the most frequent element in an array. What is the time and space complexity of your solution?",
    "Describe a technical challenge you faced and how you overcame it.",
    "Design an algorithm to find if a given string is a palindrome after removing at most one character. What would be the time complexity?"
  ];
};

/**
 * Default questions in case Gemini fails
 */
const getDefaultQuestions = (): string[] => {
  return [
    "Tell me about your most recent project mentioned in your resume.",
    "What is your greatest technical accomplishment?",
    "Implement a function to find the most frequent element in an array. What is the time and space complexity of your solution?",
    "Describe a technical challenge you faced and how you overcame it.",
    "Design an algorithm to find if a given string is a palindrome after removing at most one character. What would be the time complexity?"
  ];
};