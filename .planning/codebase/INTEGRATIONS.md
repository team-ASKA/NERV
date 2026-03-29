# Integrations 

The project heavily integrates with external AI models and platform APIs:

**Client / BaaS**
- **Authentication / DB**: Firebase (`firebase`), Supabase (`@supabase/supabase-js`). The app seems to use a hybrid approach or is migrating between them (found `src/lib/firebase.ts` and `src/lib/supabase.ts`).
- **Analytics**: PostHog (`posthog-js`)

**AI / Deep Learning Services**
- **Google Generative AI**: Gemini API integration (`@google/generative-ai`), heavily used in logic and both front/backend.
- **Groq**: LLaMA-based speedy API for language modeling (`groq-sdk`), also has a proxy script `api/groq-proxy.ts`.
- **Hume AI**: Emotion AI interpretation (`hume`, implemented in `src/services/humeAIService.ts`).
- **D-ID**: Digital avatar and text-to-video (`@d-id/client-sdk`).
- **Azure Face API**: Facial feature and emotion detection (`@azure/cognitiveservices-face`).
- **OpenAI**: Whisper or broader service use (`openAIService.ts` and `whisperService.ts` in `src/services/`).
- **Sarvam AI**: Specific STT/TTS models for Indian context (`sarvamSTTService.ts`, `sarvamTTSService.ts`).

**Third-Party APIs**
- **YouTube Service**: Indicated by `youtubeService.ts` for possible references or analysis of videos.
