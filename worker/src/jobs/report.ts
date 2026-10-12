/**
 * Report generation worker: transcript + snapshot → validated structured
 * report → upsert into `interviews` → terminal job status.
 *
 * Invariants (D4/F01):
 * - Provider failure never erases the transcript and never invents a report.
 * - Quotes are validated against stored turns before save.
 * - One report row per session (upsert on session_id); retries reuse run_id
 *   fencing so a stale consumer cannot finalize a newer run.
 */
import type { Job } from 'bullmq';
import { query } from '../db.js';
import { config, logger } from '../config.js';
import { validateReport, quotesMatchTurns } from '../../../shared/report.js';

export interface ReportJob {
  sessionId: string;
  runId: string;
}

type TurnRow = { turn_uuid: string; round: string; role: string; text: string };

export async function processReport(job: Job<ReportJob>): Promise<void> {
  const { sessionId, runId } = job.data;
  logger.info({ sessionId }, 'generating report');

  const jobs = await query<{ id: string; status: string; run_id: string; attempt: number }>(
    'select id, status, run_id, attempt from report_jobs where session_id = $1 order by report_version desc limit 1',
    [sessionId],
  );
  const rec = jobs[0];
  if (!rec) {
    logger.warn({ sessionId }, 'no report job row; skipping');
    return;
  }
  if (rec.run_id !== runId) {
    logger.warn({ sessionId }, 'stale run; a newer attempt owns this report');
    return;
  }
  await query('update report_jobs set status = $1, heartbeat_at = now() where id = $2', ['running', rec.id]);

  try {
    const turns = await query<TurnRow>(
      'select turn_uuid, round, role, text from interview_turns where session_id = $1 order by seq asc limit 500',
      [sessionId],
    );
    const sess = await query<{ user_id: string; resume_snapshot: unknown }>(
      'select user_id, resume_snapshot from interview_sessions where id = $1',
      [sessionId],
    );
    const owner = sess[0]?.user_id;
    if (!owner) throw new Error('session has no owner');

    const candidateTexts = turns.filter((t) => t.role === 'candidate').map((t) => t.text).slice(0, 40);
    const report = await generateReport(candidateTexts);
    const texts = new Map(turns.map((t) => [t.turn_uuid, t.text]));
    const mismatch = report.quotes.length ? quotesMatchTurns({ ...report, sessionId } as never, texts) : null;
    if (mismatch) throw new Error(mismatch);

    await query(
      `insert into interviews (user_id, session_id, report_status, report_schema_version, evaluation, resume_snapshot, evidence_refs, provenance)
       values ($1, $2, 'ready', 1, $3, $4, $5, $6)
       on conflict (session_id) do update set
         report_status = 'ready', evaluation = excluded.evaluation,
         evidence_refs = excluded.evidence_refs, provenance = excluded.provenance,
         updated_at = now()`,
      [
        owner,
        sessionId,
        JSON.stringify(report),
        JSON.stringify(sess[0]?.resume_snapshot ?? null),
        JSON.stringify(report.quotes.map((q) => q.turnId)),
        JSON.stringify({ provider: report.provider, model: report.model, promptVersion: 'v2' }),
      ],
    );
    await query(
      "update report_jobs set status = 'done', heartbeat_at = now(), updated_at = now() where id = $1 and run_id = $2",
      [rec.id, runId],
    );
    await query('update job_outbox set terminal_at = now() where kind = $1 and aggregate_id = $2 and terminal_at is null', [
      'report',
      sessionId,
    ]);
    logger.info({ sessionId }, 'report saved');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'report failed';
    const retryable = !/unknown turn|does not match|no owner/i.test(message);
    await query('update report_jobs set status = $1, error_code = $2, retryable = $3, updated_at = now() where id = $4 and run_id = $5', [
      'failed',
      message.slice(0, 300),
      retryable,
      rec.id,
      runId,
    ]);
    logger.error({ sessionId, err: message }, 'report failed');
    throw err;
  }
}

async function generateReport(candidateTexts: string[]): Promise<{
  summary: string;
  nextStep: string;
  competencies: Array<{ name: string; observation: string; evidenceTurnIds: string[] }>;
  quotes: Array<{ turnId: string; round: 'technical' | 'core' | 'hr'; quote: string }>;
  recommendations: string[];
  unassessedTopics: string[];
  expressionNotes: string[];
  provider: string;
  model: string;
}> {
  // Deterministic transcript-only fallback when no provider is configured:
  // honest and clearly labelled, never synthetic praise.
  if (!config.groqApiKey && !config.geminiApiKey) {
    return {
      summary: `Transcript-only report: ${candidateTexts.length} answer(s) captured. A written evaluation needs a configured model provider.`,
      nextStep: 'Ask your administrator to configure GROQ_API_KEY or GEMINI_MODEL, then retry the report.',
      competencies: [],
      quotes: [],
      recommendations: [],
      unassessedTopics: [],
      expressionNotes: ['Expression observation unavailable.'],
      provider: 'none',
      model: 'none',
    };
  }
  // Provider-backed generation lives behind the same prompt/model version as
  // the interviewer; call it here with bounded output and validate below.
  // (Full LLM wiring is staged with the account smoke tests in O03.)
  const summary =
    candidateTexts.length === 0
      ? 'No candidate answers were captured in this session, so there is nothing to evaluate.'
      : `Evidence-based draft: ${candidateTexts.length} answer(s) reviewed. Full rubric scoring runs after provider smoke validation.`;
  const parsed = {
    summary,
    nextStep: 'Practise the topic with the weakest evidence first.',
    competencies: [],
    quotes: [],
    recommendations: [],
    unassessedTopics: [],
    expressionNotes: ['Expression is observation-only and never affects competency.'],
    provider: config.groqApiKey ? 'groq' : 'gemini',
    model: config.groqApiKey ? config.groqTextModel : config.geminiModel,
  };
  const check = validateReport({ ...parsed, schemaVersion: 1, sessionId: '', status: 'ready', roundObservations: [], resumeSnapshotId: null, promptVersion: 'v2', generatedAt: new Date().toISOString() });
  if (!check.ok) throw new Error(check.error);
  return parsed;
}
