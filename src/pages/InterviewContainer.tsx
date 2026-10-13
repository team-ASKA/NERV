/** Recoverable interview container: round comes from the durable session. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '../lib/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { useInterviewSession } from '../hooks/useInterviewSession';
import type { InterviewSession, RoundKind } from '../../shared/session';
import { AppShell } from '../components/AppShell';
import { Button, Card } from '../components/ui';

const ROUNDS: RoundKind[] = ['technical', 'core', 'hr'];

export default function InterviewContainer() {
  const { sessionId } = useParams();
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [round, setRound] = useState<RoundKind>('technical');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const elapsedBase = useRef(0);
  const elapsedStart = useRef(Date.now());

  useEffect(() => {
    if (!sessionId || !currentUser) return;
    let cancelled = false;
    setLoading(true);
    apiFetch<{ session: InterviewSession }>(`/api/sessions/${sessionId}`)
      .then(({ session: s }) => {
        if (cancelled) return;
        setSession(s);
        setRound(s.currentRound);
        elapsedBase.current = s.rounds[s.currentRound]?.elapsedMs ?? 0;
        elapsedStart.current = Date.now();
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, currentUser]);

  const live = useInterviewSession({
    round,
    resume: session?.resume ? { skills: session.resume.skills } as never : null,
    maxQuestions: 6,
  });

  const checkpoint = useCallback(async () => {
    if (!session || !sessionId) return;
    try {
      await apiFetch(`/api/sessions/${sessionId}/round`, {
        method: 'PATCH',
        body: JSON.stringify({
          expectedRevision: session.revision,
          round,
          appendTurns: live.transcript.slice(-4).map((t) => ({
            turnId: crypto.randomUUID(),
            role: t.role,
            text: t.text,
          })),
          elapsedMs: elapsedBase.current + (Date.now() - elapsedStart.current),
        }),
      });
    } catch {
      /* autosave is best-effort; recovery uses last acked checkpoint */
    }
  }, [session, sessionId, round, live.transcript]);

  useEffect(() => {
    const t = setInterval(() => {
      void checkpoint();
    }, 15000);
    return () => clearInterval(t);
  }, [checkpoint]);

  const finalize = useCallback(async () => {
    if (!sessionId) return;
    setFinishing(true);
    try {
      await checkpoint();
      const { reportUrl } = await apiFetch<{ reportUrl: string }>(`/api/sessions/${sessionId}/finalize`, { method: 'POST', body: '{}' });
      navigate(reportUrl);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFinishing(false);
    }
  }, [sessionId, checkpoint, navigate]);

  if (loading) return <AppShell><p className="p-8 text-white/60">Restoring your session…</p></AppShell>;
  if (error || !session) {
    return (
      <AppShell>
        <Card className="m-8 p-6">
          <h1 className="text-lg font-semibold">Could not open that interview</h1>
          <p className="mt-1 text-sm text-white/60">{error ?? 'Not found.'}</p>
          <Link to="/dashboard" className="mt-4 inline-block"><Button>Back to dashboard</Button></Link>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl space-y-4 p-4" style={{ minHeight: '100dvh' }}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-2" role="tablist" aria-label="Rounds">
            {ROUNDS.map((r) => (
              <button
                key={r}
                type="button"
                role="tab"
                aria-selected={round === r}
                onClick={() => setRound(r)}
                className={`h-10 rounded-lg px-4 text-sm font-medium ${round === r ? 'bg-white font-bold text-black' : 'bg-white/5 text-white/70'}`}
              >
                {r}
              </button>
            ))}
          </div>
          <Button variant="secondary" onClick={() => void finalize()} disabled={finishing}>
            {finishing ? 'Finishing…' : 'Finish'}
          </Button>
        </div>

        <Card className="p-6">
          <p className="text-xs uppercase tracking-wide text-white/40">{live.phase}</p>
          {live.currentQuestion ? (
            <p className="mt-2 text-lg">{live.currentQuestion}</p>
          ) : (
            <p className="mt-2 text-white/60">Press Start to hear the first question.</p>
          )}
          {live.liveText && <p className="mt-2 text-sm text-white/50">{live.liveText}</p>}
          {live.error && (
            <p className="mt-2 text-sm text-red-300" role="alert">
              {live.error} <button type="button" onClick={live.retry} className="underline">Retry</button>
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {live.phase === 'idle' && <Button onClick={() => void live.start()}>Start</Button>}
            <Button variant="secondary" onClick={live.repeat} disabled={!live.currentQuestion}>Repeat question</Button>
            <Button variant="ghost" onClick={live.end}>Pause & exit</Button>
          </div>
        </Card>

        <Card className="p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              live.submitText(String(fd.get('answer') ?? ''));
              e.currentTarget.reset();
            }}
            className="flex gap-2"
          >
            <input
              name="answer"
              aria-label="Your answer"
              placeholder="Type your answer, or use the mic"
              className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-input-bg px-3 text-sm text-white"
            />
            <Button type="submit">Send</Button>
          </form>
        </Card>
      </div>
    </AppShell>
  );
}
