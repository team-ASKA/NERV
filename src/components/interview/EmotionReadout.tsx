import { AlertTriangle, Activity } from 'lucide-react';
import type { EmotionAggregate } from '../../types/interview';
import { Badge } from '../ui';
import { cn } from '../../lib/cn';

export interface EmotionReadoutProps {
  aggregate: EmotionAggregate | null;
  /** Reason shown when analysis is off — e.g. a camera permission error. */
  unavailableReason?: string | null;
  className?: string;
}

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

/**
 * Live facial-expression readout.
 *
 * When the Hume stream isn't running this renders an explicit "unavailable"
 * state — it never falls back to placeholder scores, because a fabricated
 * confidence number is worse than no number at all.
 */
export function EmotionReadout({ aggregate, unavailableReason, className }: EmotionReadoutProps) {
  const available = Boolean(aggregate?.available);

  if (!available) {
    return (
      <div className={cn('rounded-2xl border border-border bg-surface p-4', className)}>
        <div className="mb-2 flex items-center gap-2">
          <AlertTriangle size={14} className="text-warning" />
          <span className="text-xs font-semibold uppercase tracking-widest text-muted">
            Expression analysis
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Unavailable for this session.{' '}
          {unavailableReason ?? 'Your answers are still scored on content alone.'}
        </p>
      </div>
    );
  }

  const confidence = Math.round((aggregate?.confidenceScore ?? 0) * 100);
  const breakdown = (aggregate?.breakdown ?? []).slice(0, 4);

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
        <span className="text-sm text-muted">{aggregate?.dominantEmotion ?? 'Neutral'}</span>
        <span className="text-2xl font-semibold tabular-nums text-white">{confidence}%</span>
      </div>

      <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-white/8">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-700 ease-out"
          style={{ width: `${confidence}%` }}
        />
      </div>

      <div className="space-y-2">
        {breakdown.map((e) => (
          <div key={e.name} className="flex items-center gap-2">
            <span className="w-24 shrink-0 truncate text-[11px] text-muted-foreground">{e.name}</span>
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/8">
              <div
                className={cn('h-full rounded-full transition-[width] duration-700 ease-out', barTone(e.name))}
                style={{ width: `${Math.round(Math.min(1, Math.max(0, e.score)) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {(aggregate?.isNervous || aggregate?.isStruggling) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {aggregate?.isNervous && <Badge variant="warning">Nervous</Badge>}
          {aggregate?.isStruggling && <Badge variant="danger">Struggling</Badge>}
        </div>
      )}
    </div>
  );
}

export default EmotionReadout;
