/**
 * Ingestion contracts shared by the browser, the Vercel API and the BullMQ
 * worker. This is the only place the three agree on shapes, so it must stay
 * dependency-free and runtime-agnostic (no Node built-ins, no DOM).
 */

// ---------------------------------------------------------------------------
// Routing policy
// ---------------------------------------------------------------------------

/**
 * Word count at or above which we stop trusting the flat text layer and read
 * the rendered pages with a vision model instead.
 *
 * Rationale: short resumes are almost always single-column, and pdf.js returns
 * them faithfully for a fraction of a cent. Past this length they are
 * overwhelmingly multi-column or table-heavy, and pdf.js linearises those in
 * visual order — "React 2021 Node" — which silently corrupts the structure the
 * interviewer grounds its questions in. A VLM reads the layout as laid out.
 */
export const VLM_WORD_THRESHOLD = 500;

/**
 * Below this, the text layer is considered absent rather than short — a scanned
 * or image-only PDF. These go to the VLM regardless of the threshold above,
 * because there is no text to route on.
 */
export const SCANNED_WORD_FLOOR = 25;

export type ExtractionStrategy = 'pdf_text' | 'vlm';

export interface RoutingDecision {
  strategy: ExtractionStrategy;
  wordCount: number;
  /** Human-readable justification, surfaced in the UI and the job record. */
  reason: string;
}

/**
 * The single place the pdf.js-vs-VLM choice is made. Pure and total, so it is
 * trivially testable and behaves identically on both sides of the wire.
 */
export function routeExtraction(wordCount: number, pageCount = 1): RoutingDecision {
  if (wordCount < SCANNED_WORD_FLOOR) {
    return {
      strategy: 'vlm',
      wordCount,
      reason: `Only ${wordCount} words in the text layer across ${pageCount} page(s) — treating this as a scanned or image-only PDF.`,
    };
  }
  if (wordCount < VLM_WORD_THRESHOLD) {
    return {
      strategy: 'pdf_text',
      wordCount,
      reason: `${wordCount} words — short enough that the text layer is reliable.`,
    };
  }
  return {
    strategy: 'vlm',
    wordCount,
    reason: `${wordCount} words — long enough to likely use a multi-column or table layout, which the text layer flattens incorrectly.`,
  };
}

// ---------------------------------------------------------------------------
// Job lifecycle
// ---------------------------------------------------------------------------

export type ResumeJobStatus =
  | 'queued'
  | 'extracting'
  | 'parsing'
  | 'persisting'
  | 'done'
  | 'failed'
  | 'cancelled';

export const TERMINAL_STATUSES: readonly ResumeJobStatus[] = ['done', 'failed', 'cancelled'];

export function isTerminal(status: ResumeJobStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Coarse progress for the UI. Deliberately not a percentage — it would lie. */
export const STATUS_COPY: Record<ResumeJobStatus, string> = {
  queued: 'Waiting for a worker',
  extracting: 'Reading your PDF',
  parsing: 'Understanding your experience',
  persisting: 'Saving',
  done: 'Ready',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/** Ordered for progress rendering; terminal states excluded. */
export const STATUS_SEQUENCE: readonly ResumeJobStatus[] = [
  'queued',
  'extracting',
  'parsing',
  'persisting',
];

// ---------------------------------------------------------------------------
// Queue payloads
// ---------------------------------------------------------------------------

export const QUEUE_RESUME_INGEST = 'resume-ingest';
export const QUEUE_INTERVIEW_SIM = 'interview-sim';

/**
 * Retry policy. Defined here because the producer (Vercel) sets it and the
 * consumer (worker) reads `job.opts.attempts` to decide whether a failure is
 * the last one — if the two disagreed, jobs would be marked failed while BullMQ
 * still had retries left, or stay "queued" forever after the final attempt.
 */
export const RESUME_JOB_ATTEMPTS = 3;

export const RESUME_JOB_OPTIONS = {
  attempts: RESUME_JOB_ATTEMPTS,
  backoff: { type: 'exponential', delay: 5_000 },
  /** Completed jobs are history; the `resume_jobs` table is the record. */
  removeOnComplete: { age: 3_600, count: 1_000 },
  /** Failures linger a day so a bad deploy is diagnosable. */
  removeOnFail: { age: 86_400, count: 5_000 },
} as const;

export interface ResumeIngestJob {
  /** Row id in `resume_jobs`. The worker writes status against this. */
  jobId: string;
  userId: string;
  /** sha256 of the raw file bytes, lowercase hex. */
  contentHash: string;
  /** Supabase Storage object path. The file never passes through the API. */
  storagePath: string;
  filename: string;
  byteSize: number;
  mimeType: string;
}

// ---------------------------------------------------------------------------
// API shapes
// ---------------------------------------------------------------------------

export interface IngestRequest {
  contentHash: string;
  storagePath: string;
  filename: string;
  byteSize: number;
  mimeType: string;
}

export interface IngestResponse {
  jobId: string;
  status: ResumeJobStatus;
  /** False when this request folded into an in-flight or completed job. */
  created: boolean;
}

export interface JobStatusResponse {
  jobId: string;
  status: ResumeJobStatus;
  strategy: ExtractionStrategy | null;
  wordCount: number | null;
  pageCount: number | null;
  attempts: number;
  error: string | null;
  /** Present only once status is `done`. */
  resume: ParsedResumePayload | null;
  createdAt: string;
  finishedAt: string | null;
  /** Server-suggested delay before the next poll. 0 once terminal. */
  pollAfterMs: number;
}

/**
 * Polling cadence, computed server-side and echoed to the client.
 *
 * Tight at first — most resumes finish in a few seconds and a spinner that
 * lingers after the work is done feels broken — then backing off, because a
 * slow queue must not turn every waiting tab into a request storm. At 10k
 * users a fixed one-second poll is tens of thousands of requests per minute
 * spent on jobs that are demonstrably not finishing quickly.
 */
export function nextPollDelay(status: ResumeJobStatus, elapsedMs: number): number {
  if (isTerminal(status)) return 0;
  if (elapsedMs < 5_000) return 900;
  if (elapsedMs < 20_000) return 1_500;
  if (elapsedMs < 60_000) return 3_000;
  return 5_000;
}

/**
 * When the client should stop polling and tell the user to come back later.
 * The job is not cancelled — the worker finishes it and the result is waiting
 * on the next visit.
 */
export const MAX_POLL_MS = 180_000;

/** The structured resume both the interviewer and the report consume. */
export interface ParsedResumePayload {
  name: string;
  title: string;
  summary: string;
  skills: string[];
  projects: string[];
  achievements: string[];
  experience: string[];
  education: string[];
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_PDF_PAGES = 12;
/** Pages sent to the VLM. Beyond this, later pages are rarely load-bearing. */
export const MAX_VLM_PAGES = 6;
export const ACCEPTED_MIME = ['application/pdf'] as const;

export function validateUpload(input: {
  byteSize: number;
  mimeType: string;
}): { ok: true } | { ok: false; error: string } {
  if (!ACCEPTED_MIME.includes(input.mimeType as (typeof ACCEPTED_MIME)[number])) {
    return { ok: false, error: 'Only PDF resumes are supported.' };
  }
  if (input.byteSize <= 0) return { ok: false, error: 'That file is empty.' };
  if (input.byteSize > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `That file is ${(input.byteSize / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
    };
  }
  return { ok: true };
}

/** sha256 hex is the only accepted idempotency input — validate it as such. */
export function isSha256Hex(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

/**
 * Idempotency key. Scoped per user so the same resume uploaded by two accounts
 * produces two independent jobs — sharing a parse across users would leak one
 * person's document into another's session.
 */
export function idempotencyKey(userId: string, contentHash: string): string {
  return `resume:${userId}:${contentHash}`;
}
