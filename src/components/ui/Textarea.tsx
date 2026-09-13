import React, { forwardRef, useId } from 'react';
import { cn } from '../../lib/cn';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, hint, className, id, ...props }, ref) => {
    const autoId = useId();
    const areaId = id ?? autoId;
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={areaId} className="mb-1.5 block text-sm font-medium text-white/90">
            {label}
          </label>
        )}
        <textarea
          id={areaId}
          ref={ref}
          className={cn(
            'w-full rounded-lg border bg-input-bg px-3.5 py-2.5 text-sm text-white transition-colors',
            'placeholder:text-muted-foreground focus:outline-none resize-y min-h-[96px]',
            error ? 'border-danger focus:border-danger' : 'border-border hover:border-border-strong focus:border-accent',
            className,
          )}
          aria-invalid={!!error}
          {...props}
        />
        {error ? (
          <p className="mt-1.5 text-xs text-danger">{error}</p>
        ) : hint ? (
          <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </div>
    );
  },
);
Textarea.displayName = 'Textarea';
