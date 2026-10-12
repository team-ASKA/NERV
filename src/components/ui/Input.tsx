import React, { forwardRef, useId } from 'react';
import { cn } from '../../lib/cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leftIcon?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, leftIcon, className, id, 'aria-describedby': describedBy, ...props }, ref) => {
    const autoId = useId();
    const inputId = id ?? autoId;
    const hintId = hint ? `${inputId}-hint` : undefined;
    const errorId = error ? `${inputId}-error` : undefined;
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-white/90">
            {label}
          </label>
        )}
        <div className="relative">
          {leftIcon && (
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              {leftIcon}
            </span>
          )}
          <input
            id={inputId}
            ref={ref}
            className={cn(
              'w-full rounded-lg border bg-input-bg px-3.5 py-2.5 text-sm text-white transition-colors',
              'placeholder:text-muted-foreground focus:outline-none',
              leftIcon && 'pl-10',
              error ? 'border-danger focus:border-danger' : 'border-border hover:border-border-strong focus:border-accent',
              className,
            )}
            aria-invalid={!!error}
            aria-describedby={[describedBy, errorId, hintId].filter(Boolean).join(' ') || undefined}
            {...props}
          />
        </div>
        {error ? (
          <p id={errorId} role="alert" className="mt-1.5 text-xs text-danger">{error}</p>
        ) : hint ? (
          <p id={hintId} className="mt-1.5 text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </div>
    );
  },
);
Input.displayName = 'Input';
