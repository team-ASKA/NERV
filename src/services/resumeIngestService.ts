/**
 * Queue-backed resume ingestion (client half).
 *
 * The browser never uploads through our API and never waits on a request that
 * does the parsing. It hashes the file, pushes the bytes straight to storage
 * with a one-shot signed URL, asks the API to claim a job, and then polls.
 *
 * The hash is what makes the whole thing safe to retry: re-running any step
 * with the same file converges on the same job and the same parse, so a
 * double-click, a flaky network, or a refreshed tab costs nothing.
 *
 * Failures are split in two on purpose. `IngestUnavailableError` means the
 * pipeline is not deployed here and the caller should fall back to the
 * synchronous parser; anything else is a real failure the candidate needs to
 * hear about.
 */

import { authedFetch, postJson } from '../lib/authedFetch';
import { logger } from '../lib/logger';
import {
  MAX_POLL_MS,
  STATUS_COPY,
  nextPollDelay,
  validateUpload,
  type JobStatusResponse,
  type ParsedResumePayload,
  type ResumeJobStatus,
} from '../../shared/ingestion';

export class IngestUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IngestUnavailableError';
  }
}

export class IngestFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IngestFailedError';
  }
}

/** The job outlived the client's patience. It is still running server-side. */
export class IngestPendingError extends Error {
  readonly jobId: string;
  constructor(jobId: string) {
    super('Your resume is taking longer than usual. It will be ready when you come back.');
    this.name = 'IngestPendingError';
    this.jobId = jobId;
  }
}

export type IngestPhase = 'hashing' | 'uploading' | 'queueing' | ResumeJobStatus;

export interface IngestProgress {
  phase: IngestPhase;
  label: string;
}

export interface IngestResult {
  jobId: string;
  resume: ParsedResumePayload;
  strategy: JobStatusResponse['strategy'];
  wordCount: number | null;
  pageCount: number | null;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** sha256 of the file bytes, lowercase hex — the content address and job key. */
export async function sha256Hex(file: Blob): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    // Only available in a secure context. Not an error worth showing anyone —
    // the caller falls back to the synchronous path.
    throw new IngestUnavailableError('Hashing is unavailable in this context.');
  }
  const digest = await subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

interface UploadUrlResponse {
  storagePath?: string;
  alreadyUploaded?: boolean;
  signedUrl?: string;
  error?: string;
}

interface IngestClaimResponse {
  jobId?: string;
  status?: ResumeJobStatus;
  created?: boolean;
  error?: string;
}

/**
 * A 404 means the route isn't deployed; a 503 means it is deployed but not
 * configured. Both mean "use the other path", and neither is the user's
 * problem.
 */
function unavailable(status: number): boolean {
  return status === 404 || status === 503;
}

async function poll(jobId: string, onProgress?: (p: IngestProgress) => void): Promise<IngestResult> {
  const startedAt = Date.now();
  let delay = 700;
  let consecutiveErrors = 0;

  for (;;) {
    await sleep(delay);

    let job: JobStatusResponse | null = null;
    try {
      const response = await authedFetch(`/api/resume/job/${jobId}`);
      if (response.status === 404) {
        throw new IngestFailedError('That upload is no longer available. Please try again.');
      }
      if (response.ok) {
        job = (await response.json()) as JobStatusResponse;
        consecutiveErrors = 0;
      } else {
        consecutiveErrors += 1;
      }
    } catch (err) {
      if (err instanceof IngestFailedError) throw err;
      consecutiveErrors += 1;
    }

    if (!job) {
      // A blip on a poll is not a failed parse — the work is still running.
      // Back off and keep asking until the overall budget runs out.
      if (consecutiveErrors > 12) throw new IngestPendingError(jobId);
      delay = Math.min(delay * 2, 5_000);
      if (Date.now() - startedAt > MAX_POLL_MS) throw new IngestPendingError(jobId);
      continue;
    }

    onProgress?.({ phase: job.status, label: STATUS_COPY[job.status] });

    if (job.status === 'done') {
      if (!job.resume) {
        throw new IngestFailedError(
          'We read that file but could not pull any experience out of it. Please upload a text-based resume.',
        );
      }
      return {
        jobId: job.jobId,
        resume: job.resume,
        strategy: job.strategy,
        wordCount: job.wordCount,
        pageCount: job.pageCount,
      };
    }

    if (job.status === 'failed') {
      throw new IngestFailedError(job.error ?? 'We could not process that resume. Please try again.');
    }
    if (job.status === 'cancelled') {
      throw new IngestFailedError('That upload was cancelled.');
    }

    const elapsed = Date.now() - startedAt;
    if (elapsed > MAX_POLL_MS) throw new IngestPendingError(jobId);

    delay = job.pollAfterMs || nextPollDelay(job.status, elapsed);
    // A backgrounded tab does not need second-by-second updates, and at scale
    // those polls are pure waste.
    if (typeof document !== 'undefined' && document.hidden) delay = Math.max(delay, 5_000);
  }
}

/**
 * Hash → upload → claim → poll. Resolves only once the resume is parsed and
 * stored; the worker has already written it to the database by then, so the
 * caller does not need to save anything.
 */
export async function ingestResumeFile(
  file: File,
  onProgress?: (p: IngestProgress) => void,
): Promise<IngestResult> {
  const mimeType = file.type || 'application/pdf';
  const valid = validateUpload({ byteSize: file.size, mimeType });
  if (!valid.ok) throw new IngestFailedError(valid.error);

  onProgress?.({ phase: 'hashing', label: 'Reading your file' });
  const contentHash = await sha256Hex(file);

  const prepared = await postJson<UploadUrlResponse>('/api/resume/upload-url', {
    contentHash,
    byteSize: file.size,
    mimeType,
  });

  if (!prepared.ok) {
    if (unavailable(prepared.status)) {
      throw new IngestUnavailableError(prepared.data.error ?? 'Ingestion is not available here.');
    }
    throw new IngestFailedError(prepared.data.error ?? 'Could not prepare the upload.');
  }

  const storagePath = prepared.data.storagePath;
  if (!storagePath) throw new IngestUnavailableError('The upload service returned nothing usable.');

  if (!prepared.data.alreadyUploaded) {
    if (!prepared.data.signedUrl) throw new IngestUnavailableError('No upload URL was returned.');

    onProgress?.({ phase: 'uploading', label: 'Uploading' });
    const put = await fetch(prepared.data.signedUrl, {
      method: 'PUT',
      body: file,
      headers: { 'content-type': mimeType, 'x-upsert': 'true' },
    });
    if (!put.ok) {
      throw new IngestFailedError('The upload did not complete. Please check your connection and try again.');
    }
  } else {
    logger.info('[ingest] file already stored; skipping upload');
  }

  onProgress?.({ phase: 'queueing', label: 'Starting' });
  const claimed = await postJson<IngestClaimResponse>('/api/resume/ingest', {
    contentHash,
    storagePath,
    filename: file.name,
    byteSize: file.size,
    mimeType,
  });

  if (!claimed.ok) {
    if (unavailable(claimed.status)) {
      throw new IngestUnavailableError(claimed.data.error ?? 'Ingestion is not available here.');
    }
    throw new IngestFailedError(claimed.data.error ?? 'Could not start processing.');
  }

  const jobId = claimed.data.jobId;
  if (!jobId) throw new IngestUnavailableError('No job was created.');

  onProgress?.({ phase: claimed.data.status ?? 'queued', label: STATUS_COPY[claimed.data.status ?? 'queued'] });
  return poll(jobId, onProgress);
}
