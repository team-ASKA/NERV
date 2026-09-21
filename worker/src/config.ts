/**
 * Runtime configuration and structured logging.
 *
 * Every secret is read here and nowhere else, so the set of required variables
 * is greppable in one file. Nothing throws at import time: the worker must be
 * able to boot, report precisely which variables are missing, and keep the
 * healthcheck honest rather than crash-looping before it can say why.
 */

import pino from 'pino';

const bool = (v: string | undefined, fallback: boolean) =>
  v === undefined ? fallback : /^(1|true|yes|on)$/i.test(v);

const int = (v: string | undefined, fallback: number) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  /** Port for the /healthz and /readyz endpoints the platform probes. */
  port: int(process.env.PORT, 8080),

  redisUrl: process.env.REDIS_URL ?? '',

  databaseUrl: process.env.DATABASE_URL ?? '',
  /** Cap per pod. Multiplied across replicas, this must stay under the
   *  Postgres connection limit — use the transaction pooler (port 6543) in
   *  production and this can stay small. */
  dbPoolMax: int(process.env.DB_POOL_MAX, 8),

  supabaseUrl: process.env.SUPABASE_URL ?? '',
  /** Service-role key. Worker-only — never ships to a browser. */
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  resumeBucket: process.env.RESUME_BUCKET ?? 'resumes',

  groqApiKey: process.env.GROQ_API_KEY ?? '',
  /** Vision model used when the router picks the VLM path. */
  groqVisionModel: process.env.GROQ_VISION_MODEL ?? 'meta-llama/llama-4-scout-17b-16e-instruct',
  /** Text model for structured extraction. */
  groqTextModel: process.env.GROQ_TEXT_MODEL ?? 'llama-3.1-8b-instant',
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',

  /** Jobs processed concurrently per pod. Ingestion is IO- and API-bound, so
   *  this can exceed the core count; the Groq limiter is the real ceiling. */
  ingestConcurrency: int(process.env.INGEST_CONCURRENCY, 4),
  simConcurrency: int(process.env.SIM_CONCURRENCY, 2),

  /** Token-bucket ceiling for outbound model calls, per pod. Keep the product
   *  of this and the replica count under the provider's account limit. */
  llmRequestsPerMinute: int(process.env.LLM_RPM, 90),

  enableInterviewSim: bool(process.env.ENABLE_INTERVIEW_SIM, true),
} as const;

export const logger = pino({
  level: config.logLevel,
  base: { service: 'nerv-worker' },
  redact: {
    paths: [
      'req.headers.authorization',
      'apiKey',
      '*.apiKey',
      'rawText',
      '*.rawText',
      'text',
      '*.text',
    ],
    censor: '[redacted]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export interface Requirement {
  name: string;
  present: boolean;
  /** Without this the worker cannot run at all. */
  fatal: boolean;
  note: string;
}

/**
 * What is configured and what isn't. Reported at boot and by /readyz so a
 * misconfigured deploy is diagnosable from logs alone.
 */
export function checkRequirements(): Requirement[] {
  return [
    { name: 'REDIS_URL', present: !!config.redisUrl, fatal: true, note: 'BullMQ broker' },
    { name: 'DATABASE_URL', present: !!config.databaseUrl, fatal: true, note: 'Postgres (use the transaction pooler)' },
    { name: 'SUPABASE_URL', present: !!config.supabaseUrl, fatal: true, note: 'Storage host for uploaded PDFs' },
    { name: 'SUPABASE_SERVICE_ROLE_KEY', present: !!config.supabaseServiceKey, fatal: true, note: 'Storage download auth' },
    { name: 'GROQ_API_KEY', present: !!config.groqApiKey, fatal: false, note: 'Text + vision extraction; without it ingestion falls back to heuristics' },
    { name: 'GEMINI_API_KEY', present: !!config.geminiApiKey, fatal: false, note: 'Fallback provider' },
  ];
}

export function fatalMissing(): string[] {
  return checkRequirements().filter((r) => r.fatal && !r.present).map((r) => r.name);
}

/** True when at least one model provider is usable. */
export function hasModelProvider(): boolean {
  return !!config.groqApiKey || !!config.geminiApiKey;
}
