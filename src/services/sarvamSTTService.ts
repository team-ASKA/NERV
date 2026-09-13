/**
 * Speech-to-text adapter kept for backward compatibility.
 * Delegates to {@link voiceService}, which proxies Sarvam server-side
 * (no API key in the browser). Same interface as before: transcribeAudio(blob).
 */
import { voiceService } from './voiceService';

const transcribeAudio = (audioBlob: Blob): Promise<string> => voiceService.transcribe(audioBlob);

export const sarvamSTT = { transcribeAudio };

/** @deprecated Import `voiceService` (or `sarvamSTT`) instead. */
export const whisperService = sarvamSTT;
