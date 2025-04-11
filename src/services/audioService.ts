/**
 * Audio service for recording, transcription, and text-to-speech
 */

/**
 * Start audio recording
 * @returns Promise with MediaRecorder and stream
 */
export const startAudioRecording = async (): Promise<{
  mediaRecorder: MediaRecorder;
  stream: MediaStream;
}> => {
  try {
    // Request audio permissions
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });
    
    // Create a MediaRecorder instance
    const mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm',
    });
    
    return { mediaRecorder, stream };
  } catch (error) {
    console.error('Error starting audio recording:', error);
    throw new Error(`Failed to start audio recording: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Stop audio recording and get the recorded blob
 * @param mediaRecorder - The MediaRecorder instance
 * @param chunks - The recorded audio chunks
 * @returns Promise with the audio blob
 */
export const stopAudioRecording = (
  mediaRecorder: MediaRecorder,
  chunks: Blob[]
): Promise<Blob> => {
  return new Promise((resolve) => {
    // Stop recording
    mediaRecorder.stop();
    
    // Handle the data available event
    mediaRecorder.addEventListener('dataavailable', (e) => {
      chunks.push(e.data);
    });
    
    // When recording stops, create the final audio blob
    mediaRecorder.addEventListener('stop', () => {
      const audioBlob = new Blob(chunks, { type: 'audio/webm' });
      resolve(audioBlob);
    });
  });
};

/**
 * Clean up audio resources
 * @param stream - The MediaStream to clean up
 */
export const cleanupAudioResources = (stream: MediaStream | null): void => {
  if (stream) {
    stream.getTracks().forEach((track) => {
      track.stop();
    });
  }
};

/**
 * Transcribe audio using Azure Speech-to-Text
 * @param audioBlob - The audio blob to transcribe
 * @param apiKey - The Azure Speech API key
 * @returns Promise with the transcription
 */
export const transcribeAudio = async (
  audioBlob: Blob,
  apiKey: string
): Promise<string> => {
  try {
    if (!apiKey) {
      throw new Error('Azure Speech API key is required for transcription');
    }
    
    // Convert blob to ArrayBuffer for processing
    const audioArrayBuffer = await audioBlob.arrayBuffer();
    
    // Prepare the API request
    const endpoint = "https://westus.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1";
    const params = new URLSearchParams({
      'language': 'en-US',
      'format': 'detailed',
    });
    
    // Make the API request
    const response = await fetch(`${endpoint}?${params}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'audio/webm',
        'Ocp-Apim-Subscription-Key': apiKey,
        'Accept': 'application/json',
      },
      body: audioArrayBuffer,
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Azure Speech API error: ${response.status} - ${errorText}`);
    }
    
    const result = await response.json();
    
    // Get the recognition result
    if (result && result.RecognitionStatus === 'Success' && result.NBest && result.NBest.length > 0) {
      return result.NBest[0].Display || result.NBest[0].Lexical || '';
    } else {
      return 'No speech detected. Please try again.';
    }
  } catch (error) {
    console.error('Error transcribing audio:', error);
    return `Transcription failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
};

/**
 * Convert text to speech using Azure TTS API
 * @param text - The text to convert to speech
 * @param apiKey - The Azure TTS API key
 * @returns Promise that resolves when audio playback completes
 */
export const textToSpeech = async (
  text: string,
  apiKey: string
): Promise<void> => {
  // Add debug logging to track speech requests
  console.log("Speech requested for text:", text.substring(0, 30) + "...");
  
  // Global variable to track if audio is currently playing
  if (window.audioPlaying) {
    console.log("Another audio is already playing, skipping this request");
    return;
  }
  
  try {
    // Set global flag to prevent concurrent speech
    window.audioPlaying = true;
    
    const endpoint = "https://westus.tts.speech.microsoft.com/cognitiveservices/v1";
    const deploymentName = "tts";
    
    console.log("Converting text to speech...");
    
    // Ensure we have text to convert
    if (!text || text.trim() === '') {
      console.error("Empty text provided for TTS");
      window.audioPlaying = false;
      return;
    }
    
    // Prepare the request payload
    const payload = {
      text: text,
      voice: "en-US-JennyNeural",
      rate: "+0%",
      pitch: "+0%",
    };
    
    // Make the API request
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
        'Ocp-Apim-Subscription-Key': apiKey,
      },
      body: `<speak version='1.0' xml:lang='en-US'><voice xml:lang='en-US' name='${payload.voice}'><prosody rate='${payload.rate}' pitch='${payload.pitch}'>${payload.text}</prosody></voice></speak>`,
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Azure TTS API error:", errorText);
      window.audioPlaying = false;
      throw new Error(`Failed to convert text to speech: ${response.status}`);
    }
    
    // Get the audio data
    const audioBlob = await response.blob();
    
    // Create an audio element and play it
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);
    
    // Return a promise that resolves when the audio finishes playing
    return new Promise<void>((resolve) => {
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        window.audioPlaying = false;
        console.log("Audio playback completed");
        resolve();
      };
      
      audio.play().catch(error => {
        console.error("Error playing audio:", error);
        window.audioPlaying = false;
        resolve();
      });
    });
  } catch (error) {
    console.error("Error in textToSpeech:", error);
    window.audioPlaying = false;
    return Promise.resolve();
  }
};

// Declaration for window.audioPlaying
declare global {
  interface Window {
    audioPlaying: boolean;
  }
}

// Initialize the global audio playing state
if (typeof window !== 'undefined') {
  window.audioPlaying = false;
} 