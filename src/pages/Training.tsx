/** Durable standalone training: backend-loaded context, scoped tutor, typed exercises. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiFetch } from '../lib/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { AppShell } from '../components/AppShell';
import { Button, Card } from '../components/ui';

type Action = 'explain' | 'quiz' | 'flashcards' | 'deep-dive';

interface QuizQ {
  question: string;
  options: string[];
  correct: number;
  explanation: string;
}

export default function Training() {
  const [params] = useSearchParams();
  const { currentUser } = useAuth();
  const topicId = params.get('topicId') ?? '';
  const action = (params.get('action') ?? 'explain') as Action;
  const reportId = params.get('reportId');
  const [contextLabel, setContextLabel] = useState(topicId);
  const [messages, setMessages] = useState<Array<{ role: string; text: string }>>([]);
  const [quiz, setQuiz] = useState<QuizQ[] | null>(null);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    if (!topicId || !currentUser) return;
    const q = new URLSearchParams({ topicId, action });
    if (reportId) q.set('reportId', reportId);
    apiFetch<{ label: string }>(`/api/training?${q.toString()}`)
      .then((c) => setContextLabel(c.label))
      .catch(() => setContextLabel(topicId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicId]);

  const ask = useCallback(async (message: string) => {
    const my = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ text: string; quiz?: QuizQ[] }>(`/api/tutor`, {
        method: 'POST',
        body: JSON.stringify({ topicId, action, message, requestId: crypto.randomUUID() }),
      });
      if (my !== reqId.current) return; // stale reply guard: topic reset wins
      setMessages((m) => [...m, { role: 'user', text: message }, { role: 'tutor', text: res.text }]);
      if (res.quiz) {
        setQuiz(res.quiz);
        setAnswers({});
        setSubmitted(false);
      }
    } catch (e) {
      if (my === reqId.current) setError((e as Error).message);
    } finally {
      if (my === reqId.current) setLoading(false);
    }
  }, [topicId, action]);

  const score = submitted && quiz ? quiz.filter((q, i) => answers[i] === q.correct).length : null;

  return (
    <AppShell>
      <div className="mx-auto grid max-w-5xl gap-4 p-4 md:grid-cols-[240px_1fr]">
        <Card className="h-fit p-4">
          <h1 className="font-bold">Practice</h1>
          <p className="mt-1 text-sm text-white/60">{contextLabel || 'Choose a topic from your skill map.'}</p>
          <p className="mt-1 text-xs text-white/40">Mode: {action}</p>
        </Card>
        <div className="space-y-3" style={{ minHeight: '100dvh' }}>
          {messages.map((m, i) => (
            <Card key={i} className="p-4">
              <p className="text-xs uppercase text-white/40">{m.role}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm">{m.text}</p>
            </Card>
          ))}
          {quiz && (
            <Card className="space-y-3 p-4">
              <h2 className="font-semibold">Quiz</h2>
              {quiz.map((q, qi) => (
                <fieldset key={qi} className="space-y-1">
                  <legend className="text-sm font-medium">{q.question}</legend>
                  {q.options.map((opt, oi) => (
                    <label key={oi} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name={`q${qi}`}
                        checked={answers[qi] === oi}
                        disabled={submitted}
                        onChange={() => setAnswers((a) => ({ ...a, [qi]: oi }))}
                      />
                      {opt}
                    </label>
                  ))}
                  {submitted && <p className="text-xs text-white/60">{q.explanation}</p>}
                </fieldset>
              ))}
              {!submitted ? (
                <Button onClick={() => setSubmitted(true)}>Submit answers</Button>
              ) : (
                <p className="text-sm" aria-live="polite">Score: {score} / {quiz.length} (graded locally — practice only, not an exam).</p>
              )}
            </Card>
          )}
          {error && <p className="text-sm text-red-300" role="alert">{error}</p>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const text = String(fd.get('message') ?? '').trim();
              if (!text) return;
              e.currentTarget.reset();
              void ask(text);
            }}
            className="flex gap-2"
          >
            <input name="message" aria-label="Message the tutor" placeholder="Ask about this topic…" className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-input-bg px-3 text-sm text-white" />
            <Button type="submit" disabled={loading}>{loading ? '…' : 'Send'}</Button>
          </form>
        </div>
      </div>
    </AppShell>
  );
}
