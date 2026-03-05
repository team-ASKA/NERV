/**
 * Azure Text-to-Speech Service
 * Handles different voices for different interview rounds and personas
 */

export interface TTSConfig {
  apiKey: string;
  endpoint: string;
  region: string;
}

export interface VoiceConfig {
  name: string;
  language: string;
  gender: 'Male' | 'Female';
  style?: string;
  rate?: string;
  pitch?: string;
}

// Voice configurations for different interview rounds and personas
export const VOICE_CONFIGS = {
  technical: {
    name: 'en-US-DavisNeural',
    language: 'en-US',
    gender: 'Male' as const,
    style: 'professional',
    rate: '1.0',
    pitch: '0%'
  },
  core: {
    name: 'en-US-AriaNeural',
    language: 'en-US',
    gender: 'Female' as const,
    style: 'friendly',
    rate: '1.0',
    pitch: '0%'
  },
  hr: {
    name: 'en-US-JennyNeural',
    language: 'en-US',
    gender: 'Female' as const,
    style: 'warm',
    rate: '0.9',
    pitch: '5%'
  }
} as const;

export type InterviewRound = keyof typeof VOICE_CONFIGS;

export class AzureTTSService {
  private config: TTSConfig;
  private isPlaying: boolean = false;

  constructor(config: TTSConfig) {
    this.config = config;
  }

  /**
   * Convert text to speech using Azure TTS
   * @param text - Text to convert to speech
   * @param round - Interview round to determine voice
   * @returns Promise that resolves when audio finishes playing
   */
  async speak(text: string, round: InterviewRound = 'technical'): Promise<void> {
    if (this.isPlaying) {
      console.log('Audio already playing, skipping request');
      return;
    }

    if (!text || text.trim() === '') {
      return;
    }

    try {
      this.isPlaying = true;
      
      const voiceConfig = VOICE_CONFIGS[round];
      const ssml = this.createSSML(text, voiceConfig);
      
      const response = await fetch(
        `https://${this.config.region}.tts.speech.microsoft.com/cognitiveservices/v1`,
        {
          method: 'POST',
          headers: {
            'Ocp-Apim-Subscription-Key': this.config.apiKey,
            'Content-Type': 'application/ssml+xml',
            'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
            'User-Agent': 'NERV-Interviewer'
          },
          body: ssml
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Azure TTS API error:', errorText);
        throw new Error(`TTS API error: ${response.status} - ${errorText}`);
      }

      const audioBlob = await response.blob();
      await this.playAudio(audioBlob);
      
    } catch (error) {
      console.error('Error in Azure TTS service, falling back to browser TTS:', error);
      // Fallback to browser's built-in speech synthesis
      await this.fallbackSpeak(text, round);
    } finally {
      this.isPlaying = false;
    }
  }

  /**
   * Fallback to browser's built-in speech synthesis
   */
  private async fallbackSpeak(text: string, round: InterviewRound): Promise<void> {
    if (!('speechSynthesis' in window)) {
      console.warn('Speech synthesis not supported in this browser');
      return;
    }

    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      
      // Set voice based on round
      const voices = speechSynthesis.getVoices();
      const voiceConfig = VOICE_CONFIGS[round];
      
      // Try to find a suitable voice
      const suitableVoice = voices.find(voice => 
        voice.lang.startsWith('en') && 
        voice.gender === voiceConfig.gender.toLowerCase()
      ) || voices.find(voice => voice.lang.startsWith('en')) || voices[0];
      
      if (suitableVoice) {
        utterance.voice = suitableVoice;
      }
      
      utterance.rate = parseFloat(voiceConfig.rate || '1.0');
      utterance.pitch = voiceConfig.pitch ? parseFloat(voiceConfig.pitch.replace('%', '')) / 100 : 1.0;
      
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      
      speechSynthesis.speak(utterance);
    });
  }

  /**
   * Create SSML markup for Azure TTS
   */
  private createSSML(text: string, voiceConfig: VoiceConfig): string {
    const { name, language, style, rate, pitch } = voiceConfig;
    
    return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${language}">
      <voice name="${name}">
        <prosody rate="${rate}" pitch="${pitch}">
          <mstts:express-as style="${style}" styledegree="0.8" xmlns:mstts="https://www.w3.org/2001/mstts">
            ${this.escapeXml(text)}
          </mstts:express-as>
        </prosody>
      </voice>
    </speak>`;
  }

  /**
   * Escape XML special characters
   */
  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Play audio blob
   */
  private async playAudio(audioBlob: Blob): Promise<void> {
    return new Promise((resolve, reject) => {
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        resolve();
      };
      
      audio.onerror = (error) => {
        URL.revokeObjectURL(audioUrl);
        reject(error);
      };
      
      audio.play().catch(reject);
    });
  }

  /**
   * Stop current audio playback
   */
  stop(): void {
    this.isPlaying = false;
  }

  /**
   * Check if audio is currently playing
   */
  get isCurrentlyPlaying(): boolean {
    return this.isPlaying;
  }
}

// Create default instance with your provided API key
const defaultConfig: TTSConfig = {
  apiKey: import.meta.env.VITE_APP_AZURE_TTS_API_KEY,
  endpoint: `https://${import.meta.env.VITE_APP_AZURE_TTS_REGION}.api.cognitive.microsoft.com`,
  region: import.meta.env.VITE_APP_AZURE_TTS_REGION
};

export const azureTTS = new AzureTTSService(defaultConfig);