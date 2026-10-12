/**
 * Structured report schema: evidence-led, no fabricated metrics.
 */
import type { RoundKind } from './session';

export const REPORT_SCHEMA_VERSION = 1;

export interface EvidenceQuote {
  turnId: string;
  round: RoundKind;
  quote: string;
}

export interface CompetencyDimension {
  name: string;
  observation: string;
  evidenceTurnIds: string[];
}

export interface StructuredReport {
  schemaVersion: number;
  sessionId: string;
  status: 'ready' | 'transcript_only';
  summary: string;
  nextStep: string;
  roundObservations: Array<{ round: RoundKind; text: string }>;
  competencies: CompetencyDimension[];
  quotes: EvidenceQuote[];
  recommendations: string[];
  unassessedTopics: string[];
  expressionNotes: string[];
  resumeSnapshotId: string | null;
  promptVersion: string;
  model: string;
  provider: string;
  generatedAt: string;
}

export function validateReport(r: unknown): { ok: true; report: StructuredReport } | { ok: false; error: string } {
  if (typeof r !== 'object' || r === null) return { ok: false, error: 'Report must be an object.' };
  const v = r as Record<string, unknown>;
  if (typeof v.summary !== 'string' || !v.summary.trim()) return { ok: false, error: 'Report summary is empty.' };
  if (typeof v.nextStep !== 'string' || !v.nextStep.trim()) return { ok: false, error: 'Report next step is empty.' };
  if (!Array.isArray(v.competencies)) return { ok: false, error: 'Report competencies must be an array.' };
  if (!Array.isArray(v.quotes)) return { ok: false, error: 'Report quotes must be an array.' };
  for (const q of v.quotes as Array<Record<string, unknown>>) {
    if (typeof q?.quote !== 'string' || !q.quote.trim()) return { ok: false, error: 'Report contains an empty quote.' };
    if (typeof q?.turnId !== 'string' || !q.turnId) return { ok: false, error: 'Report quote is missing its turn reference.' };
  }
  return { ok: true, report: r as StructuredReport };
}

/** Every quote must be a substring of a real stored turn. */
export function quotesMatchTurns(report: StructuredReport, turnTexts: Map<string, string>): string | null {
  for (const q of report.quotes) {
    const full = turnTexts.get(q.turnId);
    if (!full) return `Quote references unknown turn ${q.turnId}.`;
    if (!full.includes(q.quote.trim().slice(0, 24))) {
      return `Quote for turn ${q.turnId} does not match stored text.`;
    }
  }
  return null;
}
