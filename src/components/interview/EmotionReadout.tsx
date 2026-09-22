import { AlertTriangle, Activity } from 'lucide-react';
import type { EmotionDimensions, EmotionSource } from '../../../shared/emotion';
import type { EmotionAggregate } from '../../types/interview';
import { WARMING_UP_REASON } from '../../services/emotionService';
import { Badge } from '../ui';
import { cn } from '../../lib/cn';

export interface EmotionReadoutProps {
  aggregate: EmotionAggregate | null;
  /** Hard failure from the room — e.g. a camera permission error. Wins over
   *  whatever the service reports, because it explains the cause. */
  unavailableReason?: string | null;
  className?: string;
}

/**
 * The four weighted dimensions, in the order an interviewer reads them.
 * Shown instead of raw provider labels because the raw names are
 * provider-shaped (`Brow inner up` means nothing to a candidate) and because
 * these are the exact numbers the interviewer adapts to and the report prints.
 */
const DIMENSIONS: Array<{ key: keyof EmotionDimensions; label: string; tone: string }> = [
  { key: 'composure', label: 'Composure', tone: 'bg-success' },
  { key: 'engagement', label: 'Engagement', tone: 'bg-info' },
  { key: 'stress', label: 'Tension', tone: 'bg-warning' },
  { key: 'uncertainty', label: 'Uncertainty', tone: 'bg-danger' },
];

/** Legacy tones, for reads that arrive as raw Hume labels with no dimensions. */
const BAR_TONES: Record<string, string> = {
  Confidence: 'bg-success',
  Joy: 'bg-success',
  Excitement: 'bg-accent',
  Calmness: 'bg-info',
  Concentration: 'bg-info',
  Interest: 'bg-accent',
  Anxiety: 'bg-warning',
  Nervous: 'bg-warning',
  Distress: 'bg-danger',
  Confusion: 'bg-danger',
  Doubt: 'bg-warning',
  Boredom: 'bg-muted',
};

function barTone(name: string): string {
  return BAR_TONES[name] ?? 'bg-accent-soft';
}

const SOURCE_LABEL: Record<EmotionSource, string> = {
  mediapipe: 'On-device model',
  hume: 'Hume stream',
  none: 'Unknown source',
};

/**
 * Words, not a second percentage: `reliability` is capped per provider (the
 * local model tops out well below the cloud one because its mapping is openly
 * heuristic), so a bare number next to the composite score would read as a
 * contradiction rather than as a caveat.
 */
function trustWord(reliability: number): string {
  if (reliability >= 0.6) return 'high confidence';
  if (reliability >= 0.35) return 'moderate confidence';
  return 'low confidence';
}

const pct = (n: number): number => Math.round(Math.min(1, Math.max(0, n)) * 100);

/**
 * Live facial-expression readout.
 *
 * Renders an explicit "unavailable" state whenever there is no read — no
 * provider, no face, or not enough frames yet. It never falls back to
 * placeholder scores, because a fabricated confidence number is worse than no
 * number at all.
 */
export function EmotionReadout({ aggregate, unavailableReason, className }: EmotionReadoutProps) {
  if (!aggregate?.available) {
    const reason = unavailableReason ?? aggregate?.unavailableReason ?? null;
    // Warming up is not a fault: a provider is running and counting frames.
    const warming = !unavailableReason && reason === WARMING_UP_REASON;

    return (
      <div className={cn('rounded-2xl border border-border bg-surface p-4', className)}>
        <div className="mb-2 flex items-center gap-2">
          {warming ? (
            <Activity size={14} className="text-accent-soft" />
          ) : (
            <AlertTriangle size={14} className="text-warning" />
          )}
          <span className="text-xs font-semibold uppercase tracking-widest text-muted">
            Expression analysis
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {warming
            ? `${reason} Nothing is scored until the read is steady.`
            : `Unavailable for this session. ${reason ?? 'Your answers are still scored on content alone.'}`}
        </p>
      </div>
    );
  }

  const confidence = pct(aggregate.confidenceScore ?? 0);
  const dimensions = aggregate.dimensions;
  const legacy = dimensions ? [] : (aggregate.breakdown ?? []).slice(0, 4);

  return (
    <div className={cn('rounded-2xl border border-border bg-surface p-4', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-accent-soft" />
          <span className="text-xs font-semibold uppercase tracking-widest text-muted">
            Expression analysis
          </span>
        </div>
        <Badge variant="success" dot>
          Live
        </Badge>
      </div>

      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-sm text-muted">{aggregate.dominantEmotion ?? 'Neutral'}</span>
        <span className="text-2xl font-semibold tabular-nums text-white">{confidence}%</span>
      </div>

      <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-white/8">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-700 ease-out"
          style={{ width: `${confidence}%` }}
        />
      </div>

      <div className="space-y-2">
        {dimensions
          ? DIMENSIONS.map(({ key, label, tone }) => (
              <div key={key} className="flex items-center gap-2">
                <span className="w-24 shrink-0 truncate text-[11px] text-muted-foreground">{label}</span>
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/8">
                  <div
                    className={cn('h-full rounded-full transition-[width] duration-700 ease-out', tone)}
                    style={{ width: `${pct(dimensions[key])}%` }}
                  />
                </div>
              </div>
            ))
          : legacy.map((e) => (
              <div key={e.name} className="flex items-center gap-2">
                <span className="w-24 shrink-0 truncate text-[11px] text-muted-foreground">{e.name}</span>
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/8">
                  <div
                    className={cn('h-full rounded-full transition-[width] duration-700 ease-out', barTone(e.name))}
                    style={{ width: `${pct(e.score)}%` }}
                  />
                </div>
              </div>
            ))}
      </div>

      {(aggregate.isNervous || aggregate.isStruggling) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {aggregate.isNervous && <Badge variant="warning">Nervous</Badge>}
          {aggregate.isStruggling && <Badge variant="danger">Struggling</Badge>}
        </div>
      )}

      {/* Say where the number came from and how much it is worth. */}
      <p className="mt-3 text-[11px] text-muted-foreground">
        {SOURCE_LABEL[aggregate.source ?? 'none']} · {aggregate.samples ?? 0} frames ·{' '}
        {trustWord(aggregate.reliability ?? 0)}
      </p>
    </div>
  );
}

export default EmotionReadout;
