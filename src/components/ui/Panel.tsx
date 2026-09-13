import React from 'react';
import { cn } from '../../lib/cn';

export interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
  padded?: boolean;
}

/** Translucent glass surface — for overlays on top of video/imagery. */
export function Panel({ padded = true, className, children, ...props }: PanelProps) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-border bg-surface/60 backdrop-blur-md shadow-card',
        padded && 'p-5 sm:p-6',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
