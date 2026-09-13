import { cn } from '../../lib/cn';

type Tone = 'accent' | 'success' | 'warning' | 'danger';

export interface ProgressBarProps {
  /** Current value. */
  value: number;
  /** Maximum value (default 100). */
  max?: number;
  tone?: Tone;
  showLabel?: boolean;
  className?: string;
}

const toneColors: Record<Tone, string> = {
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

export function ProgressBar({ value, max = 100, tone = 'accent', showLabel, className }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={cn('w-full', className)}>
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/8">
        <div
          className={cn('h-full rounded-full transition-[width] duration-500 ease-out', toneColors[tone])}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      {showLabel && <div className="mt-1 text-right text-xs text-muted-foreground">{Math.round(pct)}%</div>}
    </div>
  );
}
