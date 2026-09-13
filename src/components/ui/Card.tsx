import React from 'react';
import { cn } from '../../lib/cn';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Add hover affordance for clickable cards. */
  interactive?: boolean;
  /** Toggle default inner padding. */
  padded?: boolean;
}

/** Solid raised surface with hairline border. The default container. */
export function Card({ interactive, padded = true, className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-border bg-surface shadow-card',
        padded && 'p-5 sm:p-6',
        interactive && 'cursor-pointer transition-colors hover:border-border-strong hover:bg-surface-raised',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
