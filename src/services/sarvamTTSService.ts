/**
 * Text-to-speech adapter kept for backward compatibility.
 * Delegates to {@link voiceService}, which proxies Sarvam server-side (no API
 * key in the browser) and pipelines sentence-level playback with barge-in.
 * Same interface as before: sarvamTTS.speak(text, round?, settings?) / stop().
 */
import { voiceService } from './voiceService';

interface LegacyTTSSettings {
  voice?: string;
  target_language_code?: string;
  pitch?: number;
  pace?: number;
  loudness?: number;
}

class SarvamTTSAdapter {
  /** `round` and `settings` are accepted for API compatibility and ignored. */
  speak(text: string, _round: string = 'technical', _settings: LegacyTTSSettings = {}): Promise<void> {
    return voiceService.speak(text);
  }

  stop(): void {
    voiceService.stopSpeaking();
  }

  get isSpeaking(): boolean {
    return voiceService.speaking;
  }
}

export const sarvamTTS = new SarvamTTSAdapter();

/** @deprecated Import `voiceService` (or `sarvamTTS`) instead. */
export { sarvamTTS as azureTTS };
