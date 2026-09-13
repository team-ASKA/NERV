import React from 'react';
import { cn } from '../../lib/cn';
import { Card } from './Card';

export interface StatTileProps {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  hint?: string;
  className?: string;
}

/** Compact metric tile for dashboards / summaries. */
export function StatTile({ label, value, icon, hint, className }: StatTileProps) {
  return (
    <Card padded={false} className={cn('p-4', className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="mt-1 text-2xl font-bold text-white">{value}</div>
          {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
        </div>
        {icon && (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-muted text-accent-soft">
            {icon}
          </div>
        )}
      </div>
    </Card>
  );
}
