import axios from 'axios';

/**
 * Transcribes audio using OpenAI's Whisper API
 * @param audioBlob - The audio blob to transcribe
 * @returns The transcription text
 * @throws Error if transcription fails
 */
export const transcribeAudio = async (audioBlob: Blob): Promise<string> => {
  try {
    // Create form data according to OpenAI documentation
    const formData = new FormData();
    formData.append('file', audioBlob, 'recording.webm');
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'json'); // Explicitly request JSON format
    
    // Log the API key (first few characters) for debugging
    const apiKey = import.meta.env.VITE_OPENAI_API_KEY || '';
    if (!apiKey) {
      throw new Error('OpenAI API key is missing. Please check your environment variables.');
    }
    
    console.log(`Using API key: ${apiKey.substring(0, 5)}...`);
    console.log('Audio blob size:', Math.round(audioBlob.size / 1024), 'KB');
    console.log('Audio blob type:', audioBlob.type);
    
    // Make the API request
    const response = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
      formData,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'multipart/form-data',
        },
        timeout: 30000, // 30 second timeout
      }
    );
    
    console.log('Transcription response status:', response.status);
    console.log('Transcription response data:', response.data);
    
    // Handle different response formats
    if (typeof response.data === 'string') {
      return response.data;
    } else if (response.data && response.data.text) {
      return response.data.text;
    } else {
      console.error('Unexpected response format:', response.data);
      throw new Error('Unexpected response format from OpenAI API');
    }
  } catch (error) {
    console.error('Error transcribing audio:', error);
    
    // Provide detailed error information
    if (axios.isAxiosError(error)) {
      if (error.response) {
        console.error('API response error:', error.response.status, error.response.data);
        
        if (error.response.status === 429) {
          throw new Error('Rate limit exceeded for OpenAI API. Please try again later.');
        } else if (error.response.status === 401) {
          throw new Error('Authentication error: Invalid API key.');
        } else if (error.response.status === 400) {
          throw new Error(`Bad request: ${JSON.stringify(error.response.data)}`);
        } else {
          throw new Error(`API error (${error.response.status}): ${JSON.stringify(error.response.data)}`);
        }
      } else if (error.code === 'ECONNABORTED') {
        throw new Error('Transcription request timed out. Please try again.');
      } else if (error.request) {
        throw new Error('No response received from OpenAI API. Please check your internet connection.');
      } else {
        throw new Error(`Request error: ${error.message}`);
      }
    }
    
    // Re-throw the error for other types of errors
    throw new Error(`Failed to transcribe audio: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}; 