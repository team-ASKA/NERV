import { useEffect, useRef } from 'react';
import { Bot, User } from 'lucide-react';
import type { TranscriptTurn } from '../../types/interview';
import { cn } from '../../lib/cn';

export interface TranscriptViewProps {
  turns: TranscriptTurn[];
  /** Tokens of the question currently streaming in, if any. */
  liveText?: string;
  /** Shown as a typing row while the interviewer is thinking. */
  pending?: boolean;
  className?: string;
}

/** Scrolling conversation log. Auto-sticks to the bottom as turns arrive. */
export function TranscriptView({ turns, liveText, pending, className }: TranscriptViewProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns.length, liveText, pending]);

  return (
    <div className={cn('space-y-4 overflow-y-auto px-4 py-5 sm:px-6', className)}>
      {turns.length === 0 && !liveText && !pending && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          The interviewer will begin shortly.
        </p>
      )}

      {turns.map((turn, i) => (
        <Bubble key={`${turn.role}-${i}`} role={turn.role} text={turn.text} />
      ))}

      {liveText && <Bubble role="interviewer" text={liveText} streaming />}

      {pending && !liveText && (
        <div className="flex items-center gap-3">
          <Avatar role="interviewer" />
          <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm border border-border bg-surface-raised px-4 py-3">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted"
                style={{ animationDelay: `${i * 160}ms` }}
              />
            ))}
          </div>
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
}

function Avatar({ role }: { role: TranscriptTurn['role'] }) {
  const isAi = role === 'interviewer';
  return (
    <div
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border',
        isAi ? 'border-accent/30 bg-accent-muted text-accent-soft' : 'border-border bg-surface-raised text-muted',
      )}
    >
      {isAi ? <Bot size={15} /> : <User size={15} />}
    </div>
  );
}

function Bubble({
  role,
  text,
  streaming,
}: {
  role: TranscriptTurn['role'];
  text: string;
  streaming?: boolean;
}) {
  const isAi = role === 'interviewer';
  return (
    <div className={cn('flex animate-fade-in-up items-start gap-3', !isAi && 'flex-row-reverse')}>
      <Avatar role={role} />
      <div
        className={cn(
          'max-w-[85%] rounded-2xl border px-4 py-3 text-sm leading-relaxed',
          isAi
            ? 'rounded-tl-sm border-border bg-surface-raised text-white'
            : 'rounded-tr-sm border-accent/30 bg-accent-muted text-white',
        )}
      >
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {isAi ? 'Interviewer' : 'You'}
        </div>
        <p className="whitespace-pre-wrap">
          {text}
          {streaming && <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-accent-soft align-middle" />}
        </p>
      </div>
    </div>
  );
}

export default TranscriptView;
