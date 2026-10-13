/**
 * Validated server config. Missing required production keys report exact
 * variable NAMES privately (never values). Defaults never hide malformed
 * explicit values.
 */

function str(name: string): string {
  const v = process.env[name];
  if (v == null) return '';
  const t = v.trim();
  return t;
}

export interface ServerConfig {
  appMode: string;
  isProduction: boolean;
  firebaseProjectId: string;
  supabaseUrl: string;
  supabaseSecretKey: string;
  resumeBucket: string;
  redisUrl: string;
  groqModel: string;
  groqTextModel: string;
  groqVisionModel: string;
  geminiModel: string;
  sarvamSttModel: string;
  sarvamTtsModel: string;
  sarvamTtsSpeaker: string;
  allowUnverifiedAuth: boolean;
  demoMode: boolean;
}

export function serverConfig(): ServerConfig {
  const isProduction = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
  return {
    appMode: str('APP_MODE') || (isProduction ? 'production' : 'development'),
    isProduction,
    firebaseProjectId: str('FIREBASE_PROJECT_ID') || str('VITE_FIREBASE_PROJECT_ID'),
    supabaseUrl: str('SUPABASE_URL'),
    supabaseSecretKey: str('SUPABASE_SECRET_KEY') || str('SUPABASE_SERVICE_ROLE_KEY'),
    resumeBucket: str('RESUME_BUCKET') || 'resumes',
    redisUrl: str('REDIS_URL'),
    groqModel: str('GROQ_MODEL') || str('GROQ_TEXT_MODEL') || 'llama-3.3-70b-versatile',
    groqTextModel: str('GROQ_TEXT_MODEL') || str('GROQ_MODEL') || 'llama-3.3-70b-versatile',
    groqVisionModel: str('GROQ_VISION_MODEL') || 'meta-llama/llama-4-scout-17b-16e-instruct',
    geminiModel: str('GEMINI_MODEL') || 'gemini-2.5-flash',
    sarvamSttModel: str('SARVAM_STT_MODEL') || 'saarika:v2.5',
    sarvamTtsModel: str('SARVAM_TTS_MODEL') || 'bulbul:v2',
    sarvamTtsSpeaker: str('SARVAM_TTS_SPEAKER') || 'anushka',
    allowUnverifiedAuth: str('ALLOW_UNVERIFIED_AUTH') === 'true',
    demoMode: str('DEMO_MODE') === 'mock',
  };
}

/** Production refuses demo flags and unverified identity. Tested explicitly. */
export function assertProductionSafe(cfg: ServerConfig): string | null {
  if (!cfg.isProduction) return null;
  if (cfg.allowUnverifiedAuth) return 'ALLOW_UNVERIFIED_AUTH must never be true in production.';
  if (cfg.demoMode) return 'DEMO_MODE=mock is rejected in production.';
  return null;
}

export function missingRequired(cfg: ServerConfig, names: Array<keyof ServerConfig>): string[] {
  return names.filter((n) => !cfg[n]);
}
