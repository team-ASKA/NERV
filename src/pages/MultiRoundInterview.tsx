/**
 * Interview setup — choose the format, confirm the resume is loaded, then hand
 * off to the round routes. The rounds themselves live in `/technical-round`,
 * `/core-round` and `/hr-round`; this page no longer runs an interview loop of
 * its own.
 */

import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  CheckCircle2,
  Clock,
  FileText,
  Mic,
  Users,
  Video,
} from 'lucide-react';
import { Badge, Button, Card, Spinner } from '../components/ui';
import { useResumeContext } from '../hooks/useResumeContext';
import type { InterviewFlowState } from '../lib/interviewFlow';
import { cn } from '../lib/cn';

const DURATIONS = [5, 10, 15] as const;

const ROUNDS = [
  {
    key: 'technical',
    name: 'Technical',
    icon: Brain,
    blurb: 'Engineering questions drawn from the skills on your resume, with a code scratchpad.',
  },
  {
    key: 'core',
    name: 'Core / Project',
    icon: FileText,
    blurb: 'A deep dive into your projects: architecture, trade-offs and what you owned.',
  },
  {
    key: 'hr',
    name: 'HR / Behavioural',
    icon: Users,
    blurb: 'Motivation, teamwork and communication, grounded in your experience.',
  },
] as const;

export default function MultiRoundInterview() {
  const navigate = useNavigate();
  const { resume, loading, missing } = useResumeContext();
  const [duration, setDuration] = useState<(typeof DURATIONS)[number]>(10);

  const start = () => {
    const state: InterviewFlowState = {
      roundDuration: duration,
      resumeData: resume,
      conversationId: `nerv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    };
    navigate('/technical-round', { state });
  };

  return (
    <div className="min-h-screen bg-primary px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 animate-fade-in-up">
          <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-accent-soft">
            Full interview
          </div>
          <h1 className="text-3xl font-bold text-white">Three rounds, one report</h1>
          <p className="mt-2 text-sm text-muted">
            A complete screening loop with an interviewer that reads your resume and follows up on
            your answers.
          </p>
        </div>

        {/* Resume status */}
        <Card className="mb-4 animate-fade-in-up">
          <div className="flex items-start gap-3">
            {loading ? (
              <Spinner size={18} />
            ) : missing ? (
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning" />
            ) : (
              <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-success" />
            )}
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-white">
                {loading ? 'Checking your resume…' : missing ? 'No resume found' : 'Resume loaded'}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {loading
                  ? 'One moment.'
                  : missing
                    ? 'Questions will be generic until you upload one. You can still run the interview.'
                    : `Grounding questions in ${resume?.skills.length ?? 0} skills, ${resume?.projects.length ?? 0} projects and ${resume?.experience.length ?? 0} roles.`}
              </p>
              {!loading && !missing && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {resume?.skills.slice(0, 8).map((s) => (
                    <Badge key={s} variant="outline">
                      {s}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            {missing && !loading && (
              <Button size="sm" variant="outline" onClick={() => navigate('/dashboard')}>
                Upload
              </Button>
            )}
          </div>
        </Card>

        {/* Rounds */}
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          {ROUNDS.map(({ key, name, icon: Icon, blurb }, i) => (
            <Card key={key} className="animate-fade-in-up" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-accent-muted">
                <Icon size={17} className="text-accent-soft" />
              </div>
              <h3 className="text-sm font-semibold text-white">{name}</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{blurb}</p>
            </Card>
          ))}
        </div>

        {/* Duration */}
        <Card className="mb-4 animate-fade-in-up">
          <div className="mb-3 flex items-center gap-2">
            <Clock size={15} className="text-muted" />
            <h2 className="text-sm font-semibold text-white">Time per round</h2>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {DURATIONS.map((d) => (
              <button
                key={d}
                onClick={() => setDuration(d)}
                className={cn(
                  'rounded-xl border px-4 py-3 text-center transition-colors',
                  duration === d
                    ? 'border-accent bg-accent-muted text-white'
                    : 'border-border bg-surface-raised text-muted hover:border-border-strong hover:text-white',
                )}
              >
                <div className="text-lg font-semibold tabular-nums">{d}</div>
                <div className="text-[11px] text-muted-foreground">minutes</div>
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            About {duration * 3} minutes in total. A round also ends once its questions are done.
          </p>
        </Card>

        {/* Requirements */}
        <Card className="mb-6 animate-fade-in-up">
          <h2 className="mb-3 text-sm font-semibold text-white">Before you start</h2>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Requirement icon={<Mic size={14} />} label="Microphone" detail="Required — you answer out loud." />
            <Requirement
              icon={<Video size={14} />}
              label="Camera"
              detail="Optional — enables expression analysis."
            />
          </div>
        </Card>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={() => navigate('/dashboard')}>
            Back to dashboard
          </Button>
          <Button size="lg" rightIcon={<ArrowRight size={16} />} onClick={start} disabled={loading}>
            Start interview
          </Button>
        </div>
      </div>
    </div>
  );
}

function Requirement({
  icon,
  label,
  detail,
}: {
  icon: ReactNode;
  label: string;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-border bg-surface-raised px-3 py-2.5">
      <span className="mt-0.5 text-muted">{icon}</span>
      <div>
        <div className="text-xs font-medium text-white">{label}</div>
        <div className="text-[11px] text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}
