/**
 * Interview service for question generation, answer processing, and feedback
 */
import { StorageKey, loadData, saveData } from './storageService';
import { extractTextFromPDF } from './pdfService';
import { isValidPDF } from './pdfValidationService';

interface InterviewConfig {
  questionCount: number;
  difficultyLevel: string;
}

interface InterviewData {
  question: string;
  answer: string;
  emotions: { name: string; score: number }[];
  timestamp: string;
}

interface InterviewResults {
  id: string;
  summary?: string;
  emotionsData: InterviewData[];
  transcriptions: string[];
  timestamp: string;
}

/**
 * Initialize an interview with resume text
 * @param resumeText The resume text to use for generating questions
 * @param openaiApiKey The OpenAI API key
 * @returns Array of generated questions
 */
export const initializeInterview = async (
  resumeText: string,
  openaiApiKey: string
): Promise<string[]> => {
  try {
    // Get interview configuration
    const interviewConfig = await loadData<InterviewConfig>(
      StorageKey.InterviewConfig,
      { questionCount: 7, difficultyLevel: 'medium' }
    );
    
    // If resume text is available, generate tailored questions
    if (resumeText && resumeText.trim().length > 100) {
      console.log('Generating interview questions based on resume');
      
      // Generate questions using Azure OpenAI API
      const endpoint = "https://kushal43.openai.azure.com";
      const deployment = "gpt-4";
      const apiVersion = "2025-01-01-preview";
      
      const promptTemplate = `
        You are an expert interviewer for technical positions. Please generate ${interviewConfig.questionCount} interview questions 
        for a candidate with the following resume. Make the questions specific to their experience and skills where possible.
        
        Difficulty level: ${interviewConfig.difficultyLevel}
        
        RESUME:
        ${resumeText.slice(0, 4000)} // Limit to 4000 chars to avoid token limits
        
        FORMAT: Return ONLY the questions as a numbered list, with no additional text.
      `;
      
      const response = await fetch(
        `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': openaiApiKey,
          },
          body: JSON.stringify({
            messages: [
              {
                role: 'system',
                content: 'You are an expert technical interviewer who creates tailored interview questions based on candidate resumes.',
              },
              {
                role: 'user',
                content: promptTemplate,
              },
            ],
            temperature: 0.7,
          }),
        }
      );
      
      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
      }
      
      const result = await response.json();
      const generatedText = result.choices[0].message.content;
      
      // Parse the numbered list of questions
      const questions = generatedText
        .split(/\d+\.\s+/)
        .filter((q: string) => q.trim().length > 0)
        .map((q: string) => q.trim());
      
      if (questions.length >= 3) {
        return questions;
      }
      
      // Fallback to default questions if parsing failed
      console.log('Failed to parse generated questions, using defaults');
    }
    
    // Fallback to default questions
    return getMockQuestions(interviewConfig.questionCount);
  } catch (error) {
    console.error('Error initializing interview:', error);
    return getMockQuestions(7); // Default fallback
  }
};

/**
 * Get mock questions for fallback
 * @param count The number of questions to generate
 * @returns Array of default questions
 */
export const getMockQuestions = (count: number = 7): string[] => {
  const allQuestions = [
    "Can you tell me about your experience and skills?",
    "What are your greatest strengths and weaknesses?",
    "Where do you see yourself in 5 years?",
    "Why should we hire you?",
    "Tell me about a challenging project you worked on.",
    "Explain a complex technical concept you understand well.",
    "How do you approach debugging a complex issue?",
    "Describe a situation where you had to work in a team to solve a problem.",
    "What is your experience with agile methodologies?",
    "How do you stay up-to-date with industry trends and new technologies?",
  ];
  
  // Return the requested number of questions, or all if count > available
  return allQuestions.slice(0, Math.min(count, allQuestions.length));
};

/**
 * Process a user's answer to an interview question
 * @param question The question that was asked
 * @param answer The user's answer
 * @param emotions Array of detected emotions
 * @param openaiApiKey The OpenAI API key
 * @returns The AI's response/feedback
 */
export const processAnswer = async (
  question: string,
  answer: string,
  emotions: any[] = [],
  openaiApiKey: string
): Promise<string> => {
  try {
    // Prepare emotion data for the prompt
    const emotionData = emotions.length > 0
      ? `The candidate's facial expressions showed: ${emotions
          .map(e => `${e.name} (${(e.score * 100).toFixed(1)}%)`)
          .join(', ')}.`
      : 'No emotion data was captured.';
    
    // Get interview configuration
    const interviewConfig = await loadData<InterviewConfig>(
      StorageKey.InterviewConfig,
      { questionCount: 7, difficultyLevel: 'medium' }
    );
    
    // Store the answer with emotions
    await storeAnswerWithEmotions(question, answer, emotions);
    
    // Generate the response using Azure OpenAI API
    const endpoint = "https://kushal43.openai.azure.com";
    const deployment = "gpt-4";
    const apiVersion = "2025-01-01-preview";
    
    // Generate appropriate follow-up based on difficulty level
    const promptTemplate = `
      You are an AI interviewer having a conversation with a job candidate.
      
      QUESTION: "${question}"
      
      CANDIDATE'S ANSWER: "${answer}"
      
      EMOTION DATA: ${emotionData}
      
      Based on this response and the detected emotions, provide a natural, conversational follow-up comment or question that:
      1. Acknowledges their answer in a professional manner
      2. Is appropriate for an interview setting (${interviewConfig.difficultyLevel} difficulty)
      3. Sounds natural and encouraging
      4. Is brief (2-3 sentences maximum)
      
      Do not explicitly mention their emotions or that you are analyzing them.
      Respond as if you are having a natural conversation.
    `;
    
    const response = await fetch(
      `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': openaiApiKey,
        },
        body: JSON.stringify({
          messages: [
            {
              role: 'system',
              content: 'You are a professional interviewer having a conversation with a job candidate.',
            },
            {
              role: 'user',
              content: promptTemplate,
            },
          ],
          temperature: 0.7,
        }),
      }
    );
    
    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }
    
    const result = await response.json();
    return result.choices[0].message.content;
  } catch (error) {
    console.error('Error processing answer:', error);
    return "Thank you for your response. Let's continue with the next question.";
  }
};

/**
 * Store an answer with associated emotions
 * @param question The question that was asked
 * @param answer The user's answer
 * @param emotions Array of detected emotions
 */
export const storeAnswerWithEmotions = async (
  question: string,
  answer: string,
  emotions: any[] = []
): Promise<void> => {
  try {
    // Create the interview data object
    const interviewData: InterviewData = {
      question,
      answer,
      emotions: emotions.map(e => ({ name: e.name, score: e.score })),
      timestamp: new Date().toISOString(),
    };
    
    // Get existing interview data
    const existingData = await loadData<InterviewData[]>(
      StorageKey.InterviewData,
      []
    );
    
    // Add the new data and save
    await saveData(StorageKey.InterviewData, [...existingData, interviewData]);
  } catch (error) {
    console.error('Error storing answer with emotions:', error);
  }
};

/**
 * Generate the next question in the interview
 * @param openaiApiKey The OpenAI API key
 * @returns The next question
 */
export const generateNextQuestion = async (
  openaiApiKey: string
): Promise<string> => {
  try {
    // Get interview configuration
    const interviewConfig = await loadData<InterviewConfig>(
      StorageKey.InterviewConfig,
      { questionCount: 7, difficultyLevel: 'medium' }
    );
    
    // Get interview data so far
    const interviewData = await loadData<InterviewData[]>(
      StorageKey.InterviewData,
      []
    );
    
    // If we haven't reached the question limit yet, generate a new question
    if (interviewData.length < interviewConfig.questionCount) {
      // Generate the next question using Azure OpenAI API
      const endpoint = "https://kushal43.openai.azure.com";
      const deployment = "gpt-4";
      const apiVersion = "2025-01-01-preview";
      
      // Get previous questions and answers
      const previousQA = interviewData.map(item => ({
        question: item.question,
        answer: item.answer,
      }));
      
      const promptTemplate = `
        You are an expert interviewer for a technical position. Generate the next relevant interview question based on the conversation so far.
        
        PREVIOUS QUESTIONS AND ANSWERS:
        ${JSON.stringify(previousQA)}
        
        DIFFICULTY LEVEL: ${interviewConfig.difficultyLevel}
        
        INSTRUCTIONS:
        1. Generate a question that follows logically from the previous conversation
        2. Avoid repeating questions already asked
        3. Make the question appropriately challenging for the ${interviewConfig.difficultyLevel} difficulty level
        4. Return ONLY the question text, with no additional commentary or text
      `;
      
      const response = await fetch(
        `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': openaiApiKey,
          },
          body: JSON.stringify({
            messages: [
              {
                role: 'system',
                content: 'You are an expert technical interviewer who creates relevant questions based on previous conversation.',
              },
              {
                role: 'user',
                content: promptTemplate,
              },
            ],
            temperature: 0.7,
          }),
        }
      );
      
      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
      }
      
      const result = await response.json();
      const nextQuestion = result.choices[0].message.content.trim();
      
      return nextQuestion;
    } else {
      // If we've reached the question limit, return a closing message
      return "Thank you for answering all the questions. Let's wrap up this interview now.";
    }
  } catch (error) {
    console.error('Error generating next question:', error);
    // Return a fallback question
    return getMockQuestions()[0];
  }
};

/**
 * Generate a summary of the interview
 * @param openaiApiKey The OpenAI API key
 * @returns The interview summary
 */
export const generateInterviewSummary = async (
  openaiApiKey: string
): Promise<string> => {
  try {
    // Get interview data
    const interviewData = await loadData<InterviewData[]>(
      StorageKey.InterviewData,
      []
    );
    
    if (interviewData.length === 0) {
      return "No interview data available to generate a summary.";
    }
    
    // Generate the summary using Azure OpenAI API
    const endpoint = "https://kushal43.openai.azure.com";
    const deployment = "gpt-4";
    const apiVersion = "2025-01-01-preview";
    
    // Prepare emotion summary
    const emotionSummary = interviewData
      .filter(item => item.emotions && item.emotions.length > 0)
      .map(item => {
        const topEmotions = item.emotions
          .slice(0, 3)
          .map(e => `${e.name} (${(e.score * 100).toFixed(1)}%)`)
          .join(', ');
        return `Question: "${item.question}" - Emotions: ${topEmotions}`;
      })
      .join('\n');
    
    const promptTemplate = `
      Analyze the following interview data and provide a comprehensive summary of the candidate's performance.
      
      INTERVIEW DATA:
      ${JSON.stringify(interviewData.map(item => ({
        question: item.question,
        answer: item.answer,
      })))}
      
      EMOTION DATA:
      ${emotionSummary}
      
      INSTRUCTIONS:
      1. Summarize the candidate's key strengths and weaknesses based on their answers
      2. Evaluate their communication skills and clarity of responses
      3. Mention any notable emotional reactions detected during specific questions (if any)
      4. Provide an overall assessment of the candidate's fit for the position
      5. Keep the summary professional, objective, and constructive
      6. Format the summary in markdown with appropriate sections
      
      Your summary should be well-structured, concise, and focused on actionable feedback.
    `;
    
    const response = await fetch(
      `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': openaiApiKey,
        },
        body: JSON.stringify({
          messages: [
            {
              role: 'system',
              content: 'You are an expert at analyzing interview performances and providing constructive feedback.',
            },
            {
              role: 'user',
              content: promptTemplate,
            },
          ],
          temperature: 0.7,
        }),
      }
    );
    
    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }
    
    const result = await response.json();
    return result.choices[0].message.content;
  } catch (error) {
    console.error('Error generating interview summary:', error);
    return "We were unable to generate an interview summary at this time. Please try again later.";
  }
};

/**
 * Create the final interview results object
 * @param summary The interview summary
 * @returns Interview results object
 */
export const createInterviewResults = async (
  summary: string
): Promise<InterviewResults> => {
  // Get interview data
  const interviewData = await loadData<InterviewData[]>(
    StorageKey.InterviewData,
    []
  );
  
  // Get stored messages
  const messages = await loadData<any[]>(
    StorageKey.InterviewMessages,
    []
  );
  
  // Extract transcriptions from messages
  const transcriptions = messages
    .filter(m => m.sender === 'user')
    .map(m => m.text);
  
  // Create the results object
  const interviewResults: InterviewResults = {
    id: `interview-${Date.now()}`,
    summary,
    emotionsData: interviewData,
    transcriptions,
    timestamp: new Date().toISOString(),
  };
  
  return interviewResults;
}; 