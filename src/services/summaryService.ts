/**
 * Client for `/api/summary` — the end-of-interview report.
 *
 * Never throws: a failed or unconfigured report degrades to a clearly-labelled
 * placeholder so the candidate still reaches their results page with the
 * transcript intact.
 */

import type { ResumeContext, TranscriptTurn } from '../types/interview';
import type { ExpressionEntry, LegacyMessage } from '../lib/roundPayload';
import { logger } from '../lib/logger';
import { authedFetch, retryAfterSeconds } from '../lib/authedFetch';

export interface SummaryRequest {
  resume: ResumeContext | null;
  technical: TranscriptTurn[] | LegacyMessage[];
  core: TranscriptTurn[] | LegacyMessage[];
  hr: TranscriptTurn[] | LegacyMessage[];
  /** Per-question emotion snapshots, or null when analysis was unavailable. */
  emotions?: ExpressionEntry[] | null;
  code?: string;
}

export interface SummaryResult {
  summary: string;
  degraded: boolean;
}

const FALLBACK = [
  '# Interview Performance Report',
  '',
  'The report service could not be reached, so a detailed analysis is not available for this session.',
  'Your full transcript is preserved below and in your dashboard — you can regenerate the report later.',
].join('\n');

/**
 * A refusal is not an outage, and saying "could not be reached" for one sends
 * the candidate to check their connection over something that clears itself in
 * seconds. The transcript is already safe, so the only thing they need is the
 * wait and the fact that retrying works.
 */
function rateLimited(retryAfter: number): string {
  return [
    '# Interview Performance Report',
    '',
    `The report could not be generated right now — too many requests in a short window. Wait about ${retryAfter} seconds and regenerate it.`,
    'Nothing was lost: your full transcript is preserved below and in your dashboard.',
  ].join('\n');
}

export async function generateSummary(req: SummaryRequest): Promise<SummaryResult> {
  try {
    const res = await authedFetch('/api/summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resume: req.resume,
        technical: req.technical ?? [],
        core: req.core ?? [],
        hr: req.hr ?? [],
        emotions: req.emotions ?? null,
        code: req.code ?? '',
      }),
    });

    const retryAfter = retryAfterSeconds(res);
    if (retryAfter !== null) {
      logger.warn(`[summary] rate limited; retry in ${retryAfter}s`);
      return { summary: rateLimited(retryAfter), degraded: true };
    }

    if (!res.ok) {
      logger.warn('[summary] request failed', res.status);
      return { summary: FALLBACK, degraded: true };
    }

    const data = (await res.json()) as { summary?: string; degraded?: boolean };
    const summary = (data.summary ?? '').trim();
    if (!summary) return { summary: FALLBACK, degraded: true };
    return { summary, degraded: Boolean(data.degraded) };
  } catch (err) {
    logger.warn('[summary] unreachable', (err as Error)?.message);
    return { summary: FALLBACK, degraded: true };
  }
}
