import { useState } from 'react';
import { AlertCircle, Mic, RotateCcw, Send, Square, Volume2 } from 'lucide-react';
import type { InterviewPhase } from '../../hooks/useInterviewSession';
import { Button } from '../ui';
import { cn } from '../../lib/cn';

export interface AnswerControlsProps {
  phase: InterviewPhase;
  isUserSpeaking: boolean;
  micActive: boolean;
  recording: boolean;
  manualMode: boolean;
  error: string | null;
  onToggleRecording: () => void;
  onSubmitText: (text: string) => void;
  onRepeat: () => void;
  onRetry: () => void;
  className?: string;
}

const STATUS: Record<InterviewPhase, string> = {
  idle: 'Ready when you are.',
  connecting: 'Connecting to your interviewer…',
  speaking: 'Interviewer is speaking…',
  listening: 'Listening — answer out loud.',
  transcribing: 'Transcribing your answer…',
  thinking: 'Interviewer is considering your answer…',
  ended: 'Round complete.',
  error: 'Something went wrong.',
};

/**
 * The answer surface: live status, the VAD mic indicator (or a push-to-talk
 * button when VAD is unavailable) and an always-present typed fallback.
 */
export function AnswerControls({
  phase,
  isUserSpeaking,
  micActive,
  recording,
  manualMode,
  error,
  onToggleRecording,
  onSubmitText,
  onRepeat,
  onRetry,
  className,
}: AnswerControlsProps) {
  const [draft, setDraft] = useState('');
  const canAnswer = phase === 'listening';
  const busy = phase === 'connecting' || phase === 'thinking' || phase === 'transcribing';

  const submit = () => {
    const text = draft.trim();
    if (!text || !canAnswer) return;
    setDraft('');
    onSubmitText(text);
  };

  return (
    <div className={cn('border-t border-border bg-surface-raised px-4 py-3 sm:px-6', className)}>
      {/* Status row */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 text-sm">
          <MicIndicator active={micActive} speaking={isUserSpeaking} recording={recording} busy={busy} />
          <span className={cn(canAnswer ? 'text-white' : 'text-muted')}>{STATUS[phase]}</span>
        </div>

        <div className="flex items-center gap-1.5">
          {manualMode && phase !== 'ended' && (
            <span className="mr-1 text-[11px] text-muted-foreground">Push-to-talk mode</span>
          )}
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<Volume2 size={14} />}
            onClick={onRepeat}
            disabled={!canAnswer}
          >
            Repeat
          </Button>
          {phase === 'error' && (
            <Button size="sm" variant="outline" leftIcon={<RotateCcw size={14} />} onClick={onRetry}>
              Retry
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-muted px-3 py-2 text-xs text-warning">
          <AlertCircle size={14} className="mt-px shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Input row */}
      <div className="flex items-center gap-2">
        {manualMode && (
          <Button
            variant={recording ? 'danger' : 'primary'}
            leftIcon={recording ? <Square size={15} /> : <Mic size={15} />}
            onClick={onToggleRecording}
            disabled={!canAnswer && !recording}
          >
            {recording ? 'Stop & send' : 'Hold the floor'}
          </Button>
        )}

        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={canAnswer ? 'Or type your answer…' : 'Wait for the interviewer…'}
          disabled={!canAnswer}
          className={cn(
            'h-10 flex-1 rounded-lg border border-border bg-input-bg px-3 text-sm text-white placeholder:text-muted-foreground',
            'outline-none transition-colors focus:border-accent disabled:opacity-50',
          )}
        />

        <Button size="icon" onClick={submit} disabled={!canAnswer || !draft.trim()} aria-label="Send answer">
          <Send size={15} />
        </Button>
      </div>
    </div>
  );
}

function MicIndicator({
  active,
  speaking,
  recording,
  busy,
}: {
  active: boolean;
  speaking: boolean;
  recording: boolean;
  busy: boolean;
}) {
  const live = active || recording;
  const tone = speaking || recording ? 'bg-success' : live ? 'bg-accent' : busy ? 'bg-warning' : 'bg-muted';

  return (
    <span className="relative flex h-7 w-7 shrink-0 items-center justify-center">
      {(speaking || recording) && (
        <span className={cn('absolute inset-0 rounded-full bg-success/30 animate-pulse-ring')} />
      )}
      <span
        className={cn(
          'relative flex h-7 w-7 items-center justify-center rounded-full transition-colors',
          live ? 'bg-white/8' : 'bg-white/5',
        )}
      >
        <Mic size={14} className={cn(live ? 'text-white' : 'text-muted-foreground')} />
        <span className={cn('absolute -bottom-0 -right-0 h-2 w-2 rounded-full ring-2 ring-surface-raised', tone)} />
      </span>
    </span>
  );
}

export default AnswerControls;
