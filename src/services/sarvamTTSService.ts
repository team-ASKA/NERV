import axios from 'axios';

interface TTSSettings {
  voice?: 'amrit';
  target_language_code?: 'en-IN' | 'hi-IN';
  speaker_bitrate?: number;
  pitch?: number;
  pace?: number;
  loudness?: number;
}

class SarvamTTSService {
  private apiKey: string = import.meta.env.VITE_SARVAM_API_KEY || '';
  private apiUrl: string = 'https://api.sarvam.ai/text-to-speech';
  private audioContext: AudioContext | null = null;
  private isSpeaking: boolean = false;

  constructor() {
    if (typeof window !== 'undefined') {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  }

  async speak(text: string, round: string = 'technical', settings: TTSSettings = {}): Promise<void> {
    if (!this.apiKey) {
      console.warn('Sarvam API Key missing, falling back to browser TTS');
      return this.fallbackSpeak(text);
    }

    if (this.isSpeaking) return;
    this.isSpeaking = true;

    try {
      const response = await axios.post(
        this.apiUrl,
        {
          inputs: [text],
          target_language_code: settings.target_language_code || 'en-IN',
          speaker_voice: settings.voice || 'amrit',
          pitch: settings.pitch || 0,
          pace: settings.pace || 1.1,
          loudness: settings.loudness || 1.1,
          speech_sample_rate: 24000
        },
        {
          headers: {
            'api-subscription-key': this.apiKey,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data && response.data.audios && response.data.audios.length > 0) {
        const audioBase64 = response.data.audios[0];
        await this.playAudioFromBase64(audioBase64);
      }
    } catch (error) {
      console.error('Sarvam TTS error:', error);
      await this.fallbackSpeak(text);
    } finally {
      this.isSpeaking = false;
    }
  }

  private async playAudioFromBase64(base64: string): Promise<void> {
    if (!this.audioContext) return;

    try {
      const binaryString = window.atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const audioBuffer = await this.audioContext.decodeAudioData(bytes.buffer);
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext.destination);
      
      return new Promise((resolve) => {
        source.onended = () => resolve();
        source.start(0);
      });
    } catch (error) {
      console.error('Error playing audio:', error);
    }
  }

  private fallbackSpeak(text: string): Promise<void> {
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onend = () => resolve();
      window.speechSynthesis.speak(utterance);
    });
  }
}

export const sarvamTTS = new SarvamTTSService();
export { sarvamTTS as azureTTS };
