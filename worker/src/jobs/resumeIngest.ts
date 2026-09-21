/**
 * The resume ingestion pipeline.
 *
 * download → text layer → route → (vlm) → structure → persist
 *
 * Every step is replay-safe. The job can be retried by BullMQ, re-enqueued by
 * the API, or picked up by a different pod after a crash, and the outcome is
 * the same: one resume row, one terminal job row. That is enforced by the
 * database (unique index + advisory lock), not by checking first and hoping.
 */

import { UnrecoverableError, type Job } from 'bullmq';
import {
  routeExtraction,
  SCANNED_WORD_FLOOR,
  type ExtractionStrategy,
  type ResumeIngestJob,
  type ResumeJobStatus,
} from '../../../shared/ingestion.js';
import { isEmptyParse } from '../../../shared/resumeParse.js';
import { config, logger } from '../config.js';
import { query, withTransaction } from '../db.js';
import { extractPdfText } from '../extract/pdfText.js';
import { structureResume } from '../extract/structure.js';
import { extractWithVlm } from '../extract/vlm.js';
import { downloadResume, removeResume } from '../storage.js';

/** How often the DB heartbeat is refreshed while a job runs. */
const HEARTBEAT_MS = 15_000;

/**
 * Raw text we keep alongside the structured parse. The interviewer reads the
 * structure; the raw text is a fallback for quoting and re-parsing. Beyond this
 * it is storage cost with no reader.
 */
const MAX_STORED_RAW = 40_000;

/** A failure the user can act on. Reported verbatim; never retried. */
class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentError';
  }
}

// ---------------------------------------------------------------------------
// Job-row bookkeeping
// ---------------------------------------------------------------------------

interface JobRow {
  status: ResumeJobStatus;
  attempts: number;
}

async function readJob(jobId: string): Promise<JobRow | null> {
  const rows = await query<JobRow>('select status, attempts from resume_jobs where id = $1', [jobId]);
  return rows[0] ?? null;
}

/**
 * Advance a job's status.
 *
 * The guard matters: a job cancelled by the user, or already finished by a
 * duplicate worker, must not be dragged back into an in-flight state by a
 * straggler.
 */
async function setStatus(
  jobId: string,
  status: ResumeJobStatus,
  extra: { strategy?: ExtractionStrategy; wordCount?: number; pageCount?: number; error?: string } = {},
): Promise<void> {
  await query(
    `update resume_jobs
        set status       = $2::resume_job_status,
            heartbeat_at = now(),
            strategy     = coalesce($3, strategy),
            word_count   = coalesce($4, word_count),
            page_count   = coalesce($5, page_count),
            error        = case when $6::text is null then error else $6::text end,
            finished_at  = case when $2 in ('done','failed','cancelled') then now() else finished_at end
      where id = $1
        and status not in ('done','failed','cancelled')`,
    [
      jobId,
      status,
      extra.strategy ?? null,
      extra.wordCount ?? null,
      extra.pageCount ?? null,
      extra.error ?? null,
    ],
  );
}

function startHeartbeat(jobId: string): () => void {
  const timer = setInterval(() => {
    void query('update resume_jobs set heartbeat_at = now() where id = $1', [jobId]).catch((err) =>
      logger.warn({ jobId, err: (err as Error).message }, 'heartbeat failed'),
    );
  }, HEARTBEAT_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

interface ExtractedText {
  text: string;
  strategy: ExtractionStrategy;
  wordCount: number;
  pageCount: number;
}

/**
 * Read the text layer first — it is fast, free, and its word count is what the
 * routing rule is defined on. Only then decide whether to pay for vision.
 */
async function extract(bytes: Uint8Array, jobId: string): Promise<ExtractedText> {
  let pdfText: Awaited<ReturnType<typeof extractPdfText>>;
  try {
    pdfText = await extractPdfText(bytes);
  } catch (err) {
    throw new PermanentError(`This PDF could not be opened: ${(err as Error).message}`);
  }

  const decision = routeExtraction(pdfText.wordCount, pdfText.pageCount);
  logger.info(
    { jobId, strategy: decision.strategy, wordCount: decision.wordCount, pages: pdfText.pageCount },
    decision.reason,
  );

  if (decision.strategy === 'pdf_text') {
    return {
      text: pdfText.text,
      strategy: 'pdf_text',
      wordCount: pdfText.wordCount,
      pageCount: pdfText.pageCount,
    };
  }

  await setStatus(jobId, 'extracting', { strategy: 'vlm', pageCount: pdfText.pageCount });

  try {
    const vlm = await extractWithVlm(bytes);
    if (vlm.wordCount < SCANNED_WORD_FLOOR) {
      throw new Error(`vision returned only ${vlm.wordCount} words`);
    }
    return { text: vlm.text, strategy: 'vlm', wordCount: vlm.wordCount, pageCount: vlm.pageCount };
  } catch (err) {
    // Vision is the better reading of a long or scanned resume, not the only
    // one. If the text layer had real content, fall back to it and say so
    // rather than failing an upload we can still partly serve.
    if (pdfText.wordCount >= SCANNED_WORD_FLOOR) {
      logger.warn(
        { jobId, err: (err as Error).message },
        'vision extraction failed; falling back to the text layer',
      );
      return {
        text: pdfText.text,
        strategy: 'pdf_text',
        wordCount: pdfText.wordCount,
        pageCount: pdfText.pageCount,
      };
    }
    throw new PermanentError(
      'This looks like a scanned resume and it could not be read. Please upload a PDF with selectable text.',
    );
  }
}

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------

export interface IngestOutcome {
  resumeId: string;
  strategy: ExtractionStrategy;
  wordCount: number;
  usedModel: boolean;
  skipped?: boolean;
}

export async function processResumeIngest(job: Job<ResumeIngestJob>): Promise<IngestOutcome> {
  const { jobId, userId, contentHash, storagePath } = job.data;
  const log = logger.child({ jobId, bullId: job.id, attempt: job.attemptsMade + 1 });

  const existing = await readJob(jobId);
  if (!existing) throw new PermanentError(`Job ${jobId} no longer exists.`);
  if (existing.status === 'done' || existing.status === 'cancelled') {
    // A replay of work that already landed. Not an error — the point of
    // idempotency is that this is boring.
    log.info({ status: existing.status }, 'job already terminal; skipping');
    return { resumeId: '', strategy: 'pdf_text', wordCount: 0, usedModel: false, skipped: true };
  }

  const stopHeartbeat = startHeartbeat(jobId);
  const started = Date.now();

  try {
    await query('update resume_jobs set attempts = attempts + 1 where id = $1', [jobId]);
    await setStatus(jobId, 'extracting');

    // --- download + verify -------------------------------------------------
    const { bytes, actualHash } = await downloadResume(storagePath);
    if (actualHash !== contentHash) {
      // The hash drives idempotency and dedupe. Trusting a client's claim about
      // it would let one upload be filed under another document's identity.
      throw new PermanentError('The uploaded file does not match its checksum. Please upload it again.');
    }

    // --- extract -----------------------------------------------------------
    const extracted = await extract(bytes, jobId);
    if (!extracted.text.trim()) {
      throw new PermanentError('No readable text was found in this PDF.');
    }

    await setStatus(jobId, 'parsing', {
      strategy: extracted.strategy,
      wordCount: extracted.wordCount,
      pageCount: extracted.pageCount,
    });

    // --- structure ---------------------------------------------------------
    const { parsed, usedModel, chunks } = await structureResume(extracted.text);
    if (isEmptyParse(parsed)) {
      throw new PermanentError(
        'We could not find any skills, projects or experience in this document. Is it definitely a resume?',
      );
    }

    // --- persist -----------------------------------------------------------
    await setStatus(jobId, 'persisting');

    const resumeId = await withTransaction(async (client) => {
      const result = await client.query<{ finish_resume_job: string }>(
        'select finish_resume_job($1::uuid, $2::text, $3::text, $4::jsonb, $5::text, $6::text, $7::int) as finish_resume_job',
        [
          jobId,
          userId,
          contentHash,
          JSON.stringify(parsed),
          extracted.text.slice(0, MAX_STORED_RAW),
          extracted.strategy,
          extracted.wordCount,
        ],
      );
      const id = result.rows[0]?.finish_resume_job;
      if (!id) throw new Error('finish_resume_job returned no resume id');

      await client.query('update resume_jobs set page_count = $2 where id = $1', [
        jobId,
        extracted.pageCount,
      ]);
      return id;
    });

    // --- cleanup (best effort; never fails a completed job) -----------------
    void query('select prune_user_resumes($1::text, $2::int)', [userId, config.resumesPerUser]).catch((err) =>
      log.warn({ err: (err as Error).message }, 'prune failed'),
    );
    if (!config.retainPdf) void removeResume(storagePath);

    log.info(
      {
        resumeId,
        strategy: extracted.strategy,
        wordCount: extracted.wordCount,
        chunks,
        usedModel,
        ms: Date.now() - started,
      },
      'ingestion complete',
    );

    return { resumeId, strategy: extracted.strategy, wordCount: extracted.wordCount, usedModel };
  } catch (err) {
    const error = err as Error;
    const permanent = error instanceof PermanentError;
    const attemptsAllowed = job.opts.attempts ?? 1;
    const lastAttempt = job.attemptsMade + 1 >= attemptsAllowed;

    if (permanent || lastAttempt) {
      // Only now is the job actually dead. Record the reason for the user.
      await setStatus(jobId, 'failed', {
        error: permanent ? error.message : 'Ingestion failed after several attempts. Please try again.',
      }).catch(() => undefined);
    } else {
      // BullMQ will retry; park the row back in `queued` so the UI shows
      // "waiting" rather than a stage it is no longer in.
      await setStatus(jobId, 'queued', { error: error.message }).catch(() => undefined);
    }

    log.error({ err: error.message, permanent, lastAttempt }, 'ingestion failed');

    if (permanent) {
      // Tell BullMQ not to burn the remaining attempts on something that will
      // fail identically every time.
      throw new UnrecoverableError(error.message);
    }
    throw error;
  } finally {
    stopHeartbeat();
  }
}
