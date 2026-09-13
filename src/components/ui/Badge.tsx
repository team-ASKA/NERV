import React from 'react';
import { cn } from '../../lib/cn';

type BadgeVariant = 'default' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'outline';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  /** Optional leading dot indicator. */
  dot?: boolean;
}

const variants: Record<BadgeVariant, string> = {
  default: 'bg-white/8 text-muted border border-border',
  accent: 'bg-accent-muted text-accent-soft border border-accent/30',
  success: 'bg-success-muted text-success border border-success/30',
  warning: 'bg-warning-muted text-warning border border-warning/30',
  danger: 'bg-danger-muted text-danger border border-danger/30',
  info: 'bg-info-muted text-info border border-info/30',
  outline: 'bg-transparent text-muted border border-border-strong',
};

const dotColors: Record<BadgeVariant, string> = {
  default: 'bg-muted',
  accent: 'bg-accent-soft',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  outline: 'bg-muted',
};

export function Badge({ variant = 'default', dot, className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        variants[variant],
        className,
      )}
      {...props}
    >
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', dotColors[variant])} />}
      {children}
    </span>
  );
}
