import React from 'react';
import { cn } from '../../lib/cn';

export interface SectionHeaderProps {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: React.ReactNode;
  className?: string;
}

/** Consistent page/section title block with optional right-aligned actions. */
export function SectionHeader({ title, description, eyebrow, actions, className }: SectionHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div>
        {eyebrow && (
          <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-accent-soft">{eyebrow}</div>
        )}
        <h2 className="text-2xl font-bold text-white">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
