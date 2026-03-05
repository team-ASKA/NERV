/**
 * Sarvam AI Speech-to-Text Service
 * Replaces Azure Whisper — uses Sarvam real-time STT REST API.
 * Same interface as whisperService: transcribeAudio(audioBlob) → Promise<string>
 */

const SARVAM_STT_URL = 'https://api.sarvam.ai/speech-to-text';

const transcribeAudio = async (audioBlob: Blob): Promise<string> => {
    const apiKey = import.meta.env.VITE_SARVAM_API_KEY as string;

    if (!apiKey) {
        throw new Error('VITE_SARVAM_API_KEY is not set in environment variables.');
    }

    console.log('[SarvamSTT] Transcribing audio, size:', Math.round(audioBlob.size / 1024), 'KB');

    // Sarvam STT requires a file extension it recognises — send as .wav
    const formData = new FormData();
    formData.append('file', audioBlob, 'recording.wav');
    formData.append('model', 'saaras:v3');
    formData.append('language_code', 'en-IN');
    formData.append('with_timestamps', 'false');
    formData.append('with_diarization', 'false');

    const response = await fetch(SARVAM_STT_URL, {
        method: 'POST',
        headers: {
            'api-subscription-key': apiKey,
            // Do NOT set Content-Type — let fetch set multipart boundary automatically
        },
        body: formData,
    });

    if (!response.ok) {
        const errText = await response.text();
        console.error('[SarvamSTT] API error:', response.status, errText);

        const errorMsg = `Sarvam STT error (${response.status}): ${errText}`;
        if (response.status === 429) {
            throw new Error('Rate limit exceeded for Sarvam STT. Please try again later.');
        } else if (response.status === 401) {
            throw new Error('Authentication error: Invalid Sarvam API key.');
        } else if (response.status === 400) {
            throw new Error(`Bad request: ${errText}`);
        } else {
            throw new Error(errorMsg);
        }
    }

    const data = await response.json();
    console.log('[SarvamSTT] Response:', data);

    // Sarvam STT returns { transcript: string } or { text: string }
    if (typeof data.transcript === 'string') {
        return data.transcript;
    } else if (typeof data.text === 'string') {
        return data.text;
    } else {
        console.error('[SarvamSTT] Unexpected response format:', data);
        throw new Error('Unexpected response format from Sarvam STT API');
    }
};

// Export as both sarvamSTT and whisperService for backward compatibility
export const sarvamSTT = { transcribeAudio };

/** @deprecated Import sarvamSTT instead */
export const whisperService = sarvamSTT;
