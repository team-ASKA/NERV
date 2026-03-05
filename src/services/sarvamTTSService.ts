/**
 * Sarvam AI Text-to-Speech Service
 * Replaces Azure TTS — uses Sarvam streaming TTS endpoint.
 * All rounds use speaker "shubh" with English (en-IN).
 */

export interface VoiceConfig {
  speaker: string;
  language: string;
  pace: number;
}

// Voice configurations — all rounds use shubh / en-IN per user preference
export const VOICE_CONFIGS = {
  technical: { speaker: 'shubh', language: 'en-IN', pace: 1.0 },
  core: { speaker: 'shubh', language: 'en-IN', pace: 1.0 },
  hr: { speaker: 'shubh', language: 'en-IN', pace: 0.95 },
} as const;

export type InterviewRound = keyof typeof VOICE_CONFIGS;

const SARVAM_TTS_URL = 'https://api.sarvam.ai/text-to-speech/stream';

export class SarvamTTSService {
  private apiKey: string;
  private isPlaying: boolean = false;
  private currentAudio: HTMLAudioElement | null = null;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Convert text to speech using Sarvam streaming TTS.
   * Drop-in replacement for AzureTTSService.speak()
   */
  async speak(text: string, round: InterviewRound = 'technical'): Promise<void> {
    if (this.isPlaying) {
      this.isPlaying = false; // force-reset in case a previous call got stuck
      console.warn('[SarvamTTS] Forcing isPlaying reset before new speak call.');
    }
    if (!text || text.trim() === '') return;

    this.isPlaying = true;
    try {
      const voiceConfig = VOICE_CONFIGS[round];

      // Skip Sarvam for very short / truncated text — go straight to browser TTS
      if (text.trim().length < 20) {
        console.warn('[SarvamTTS] Text too short, using browser TTS directly:', text);
        await this.fallbackSpeak(text, round);
        return;
      }

      const response = await fetch(SARVAM_TTS_URL, {
        method: 'POST',
        headers: {
          'api-subscription-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          target_language_code: voiceConfig.language,
          speaker: voiceConfig.speaker,
          model: 'bulbul:v3',
          pace: voiceConfig.pace,
          speech_sample_rate: 22050,
          output_audio_codec: 'mp3',
          enable_preprocessing: true,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Sarvam TTS error: ${response.status} — ${errText}`);
      }

      await this.playStream(response);
    } catch (error) {
      console.error('[SarvamTTS] Error, falling back to browser TTS:', error);
      try {
        await this.fallbackSpeak(text, round);
      } catch { }
    } finally {
      this.isPlaying = false;
    }
  }

  /** Stream audio via MediaSource API, fallback to blob if unsupported */
  private async playStream(response: Response): Promise<void> {
    if ('MediaSource' in window && MediaSource.isTypeSupported('audio/mpeg')) {
      return this.playViaMediaSource(response);
    } else {
      return this.playViaBlob(response);
    }
  }

  /** Real-time streaming playback using MediaSource API */
  private playViaMediaSource(response: Response): Promise<void> {
    return new Promise((resolve, reject) => {
      const audio = new Audio();
      const mediaSource = new MediaSource();
      audio.src = URL.createObjectURL(mediaSource);
      this.currentAudio = audio;

      mediaSource.addEventListener('sourceopen', async () => {
        try {
          const sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
          const reader = response.body!.getReader();

          // Helper to wait for buffer updates
          const waitForBuffer = () => new Promise<void>((res) => {
            if (!sourceBuffer.updating) return res();
            sourceBuffer.onupdateend = () => {
              sourceBuffer.onupdateend = null;
              res();
            };
          });

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            // Ensure buffer is ready before appending
            await waitForBuffer();
            sourceBuffer.appendBuffer(value);
            // Wait AFTER append to ensure it's processed before next loop or ending
            await waitForBuffer();
          }

          // Final wait and check before ending stream
          await waitForBuffer();
          if (mediaSource.readyState === 'open' && !sourceBuffer.updating) {
            mediaSource.endOfStream();
          }
        } catch (err) {
          console.error('[SarvamTTS] Streaming error:', err);
          // Don't reject yet, let the audio onended or onerror handle it
          if (mediaSource.readyState === 'open') {
            try { mediaSource.endOfStream(); } catch { }
          }
        }
      });

      audio.onended = () => {
        URL.revokeObjectURL(audio.src);
        resolve();
      };
      audio.onerror = (err) => {
        URL.revokeObjectURL(audio.src);
        reject(err);
      };
      audio.play().catch(reject);
    });
  }



  /** Collect all chunks then play — fallback when MediaSource unavailable */
  private async playViaBlob(response: Response): Promise<void> {
    const chunks: Uint8Array[] = [];
    const reader = response.body!.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    const blob = new Blob(chunks as BlobPart[], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    this.currentAudio = audio;

    return new Promise((resolve, reject) => {
      audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
      audio.onerror = (err) => { URL.revokeObjectURL(url); reject(err); };
      audio.play().catch(reject);
    });
  }

  /** Browser speech synthesis fallback — chunks text to bypass Chrome's ~300-char limit */
  private async fallbackSpeak(text: string, round: InterviewRound): Promise<void> {
    if (!('speechSynthesis' in window)) return;

    // Split into sentence-sized chunks so Chrome doesn't silently cut off long questions
    const chunks = this.splitIntoChunks(text, 200);

    // Wait for voices to load (required on first call)
    const getVoices = (): Promise<SpeechSynthesisVoice[]> =>
      new Promise((res) => {
        const voices = speechSynthesis.getVoices();
        if (voices.length > 0) return res(voices);
        speechSynthesis.onvoiceschanged = () => res(speechSynthesis.getVoices());
      });

    const voices = await getVoices();
    const enVoice = voices.find((v) => v.lang.startsWith('en')) ?? voices[0];

    for (const chunk of chunks) {
      if (!chunk.trim()) continue;
      await new Promise<void>((resolve) => {
        const utterance = new SpeechSynthesisUtterance(chunk);
        if (enVoice) utterance.voice = enVoice;
        utterance.rate = VOICE_CONFIGS[round].pace;
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        speechSynthesis.speak(utterance);
      });
    }
  }

  /** Split text at sentence boundaries into chunks no longer than maxLen characters */
  private splitIntoChunks(text: string, maxLen: number): string[] {
    // Split on sentence-ending punctuation while keeping the delimiter
    const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text];
    const chunks: string[] = [];
    let current = '';

    for (const sentence of sentences) {
      if ((current + sentence).length > maxLen && current.length > 0) {
        chunks.push(current.trim());
        current = sentence;
      } else {
        current += sentence;
      }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
  }

  /** Stop current audio playback */
  stop(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
    this.isPlaying = false;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }

  get isCurrentlyPlaying(): boolean {
    return this.isPlaying;
  }
}

// Singleton — drop-in replacement for `azureTTS`
const API_KEY = import.meta.env.VITE_SARVAM_API_KEY as string;
export const sarvamTTS = new SarvamTTSService(API_KEY);

// Alias for backward compatibility in case any file imports azureTTS from here
export { sarvamTTS as azureTTS };
