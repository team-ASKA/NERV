const SARVAM_STT_URL = 'https://api.sarvam.ai/speech-to-text';
const apiKey = process.env.SARVAM_API_KEY;

async function testSarvamSTT() {
    console.log('Testing Sarvam STT API...');

    // Create a dummy form data with no real audio just to check connectivity/auth
    const formData = new FormData();
    // We need some bytes for a "file"
    const dummyBlob = new Blob([new Uint8Array(1000)], { type: 'audio/wav' });
    formData.append('file', dummyBlob, 'recording.wav');
    formData.append('model', 'saaras:v2');
    formData.append('language_code', 'en-IN');

    try {
        const response = await fetch(SARVAM_STT_URL, {
            method: 'POST',
            headers: {
                'api-subscription-key': apiKey,
            },
            body: formData,
        });

        console.log('Status:', response.status);
        const data = await response.text();
        console.log('Response:', data);
    } catch (error) {
        console.error('Fetch error:', error);
    }
}

testSarvamSTT();
