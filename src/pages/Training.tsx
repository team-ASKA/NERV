/** Practice as a quiet dialogue: marquee topic, ruled conversation, sticky composer. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../lib/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { AppShell } from '../components/AppShell';
import { Button } from '../components/ui';
import { cn } from '../lib/cn';

type Action = 'explain' | 'quiz' | 'flashcards' | 'deep-dive';

const MODES: Array<{ id: Action; label: string }> = [
  { id: 'explain', label: 'Explain' },
  { id: 'quiz', label: 'Quiz' },
  { id: 'flashcards', label: 'Flashcards' },
  { id: 'deep-dive', label: 'Deep dive' },
];

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
  const [topicChoices, setTopicChoices] = useState<string[]>([]);
  const [messages, setMessages] = useState<Array<{ role: string; text: string }>>([]);
  const [quiz, setQuiz] = useState<QuizQ[] | null>(null);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (topicId) {
      if (!currentUser) return;
      const q = new URLSearchParams({ topicId, action });
      if (reportId) q.set('reportId', reportId);
      apiFetch<{ label: string }>(`/api/training?${q.toString()}`)
        .then((c) => setContextLabel(c.label))
        .catch(() => setContextLabel(topicId));
    } else {
      // The picker must work before any context exists, including demo mode
      // with no signed-in user. Failure stays silent: no topics listed.
      apiFetch<{ resume: { skills?: string[] } | null }>('/api/resume/current')
        .then(({ resume }) => setTopicChoices((resume?.skills ?? []).slice(0, 12)))
        .catch(() => setTopicChoices([]));
    }
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length, loading]);

  const score = submitted && quiz ? quiz.filter((q, i) => answers[i] === q.correct).length : null;

  const modeHref = (m: Action) => {
    const q = new URLSearchParams();
    if (topicId) q.set('topicId', topicId);
    q.set('action', m);
    if (reportId) q.set('reportId', reportId);
    return `/training?${q.toString()}`;
  };

  const chipHref = (topic: string) => {
    const q = new URLSearchParams({ topicId: topic, action });
    if (reportId) q.set('reportId', reportId);
    return `/training?${q.toString()}`;
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-[860px] px-4 pb-40 pt-8 sm:px-6 sm:pt-12">
        <header className="settle">
          <p className="font-mono text-[12px] font-medium uppercase tracking-[0.16em] text-calm-faint">Practice</p>
          <h1 className="mt-3 max-w-[18ch] font-montserrat text-[30px] font-bold leading-[1.06] tracking-[-0.02em] text-white sm:text-[38px]">
            {contextLabel || 'Choose a topic from your skill map.'}
          </h1>
          {!topicId && (
            <div className="mt-3 max-w-[52ch]">
              <p className="text-[15px] leading-[1.55] text-calm">
                Open the skill map on your dashboard and pick something to work on.
              </p>
              {topicChoices.length > 0 && (
                <>
                  <p className="mt-4 text-[13px] text-calm-faint">Or start with one of these:</p>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {topicChoices.map((t) => (
                      <li key={t}>
                        <Link
                          to={chipHref(t)}
                          className="inline-block rounded-full border border-border px-3.5 py-2 text-[14px] text-calm transition-colors hover:border-white/25 hover:text-white"
                        >
                          {t}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </header>

        <nav aria-label="Practice mode" className="settle settle-1 mt-6">
          <div className="inline-flex rounded-[10px] border border-border bg-surface p-1" role="list">
            {MODES.map((m) => {
              const active = action === m.id;
              return (
                <Link
                  key={m.id}
                  role="listitem"
                  to={modeHref(m.id)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'whitespace-nowrap rounded-[7px] px-2.5 py-2 text-[14px] font-medium transition-colors duration-180 ease-settle sm:px-4',
                    active ? 'bg-white/10 text-white' : 'text-calm hover:text-white',
                  )}
                >
                  {m.label}
                </Link>
              );
            })}
          </div>
        </nav>

        <div className="mt-8" aria-live="polite">
          {messages.length === 0 && !quiz && !loading && (
            <p className="border-t border-white/10 pt-6 text-[15px] leading-[1.55] text-calm">
              Ask anything about this topic to begin. Short questions get the best answers.
            </p>
          )}
          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="flex justify-end border-t border-white/10 py-5">
                <p className="max-w-[85%] whitespace-pre-wrap text-right text-[15px] leading-[1.55] text-calm">
                  {m.text}
                </p>
              </div>
            ) : (
              <div key={i} className="border-t border-white/10 py-5">
                <p className="max-w-[62ch] whitespace-pre-wrap text-[15px] leading-[1.6] text-white/90">{m.text}</p>
              </div>
            ),
          )}
          {loading && (
            <div className="border-t border-white/10 py-5" aria-label="Tutor is writing">
              <div className="h-4 w-40 animate-pulse rounded bg-white/10" />
            </div>
          )}

          {quiz && (
            <section aria-label="Quiz" className="stage mt-6 rounded-[14px] p-6 sm:p-8">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-montserrat text-[20px] font-semibold tracking-[-0.01em] text-white">Quiz</h2>
                {submitted && score !== null && (
                  <p className="tnum text-[14px] text-calm" aria-live="polite">
                    {score} of {quiz.length} correct
                  </p>
                )}
              </div>
              <ol className="mt-4 space-y-6">
                {quiz.map((q, qi) => (
                  <li key={qi} className="border-t border-white/10 pt-5 first:border-t-0 first:pt-1">
                    <p className="text-[15px] font-medium leading-[1.5] text-white">
                      <span className="tnum mr-2 text-calm-faint">{qi + 1}.</span>
                      {q.question}
                    </p>
                    <div className="mt-3 space-y-1" role="radiogroup" aria-label={`Question ${qi + 1}`}>
                      {q.options.map((opt, oi) => {
                        const picked = answers[qi] === oi;
                        const reveal = submitted && oi === q.correct;
                        return (
                          <label
                            key={oi}
                            className={cn(
                              'flex cursor-pointer items-baseline gap-3 rounded-[10px] px-3 py-2.5 text-[15px] transition-colors duration-180 ease-settle',
                              picked && !submitted && 'bg-white/5 text-white',
                              reveal && 'bg-success-muted text-white',
                              !picked && !reveal && 'text-calm hover:bg-white/5 hover:text-white',
                              submitted && 'cursor-default',
                            )}
                          >
                            <input
                              type="radio"
                              name={`q${qi}`}
                              className="mt-1 accent-white"
                              checked={picked}
                              disabled={submitted}
                              onChange={() => setAnswers((a) => ({ ...a, [qi]: oi }))}
                            />
                            <span>{opt}</span>
                          </label>
                        );
                      })}
                    </div>
                    {submitted && <p className="mt-2 text-[14px] leading-[1.55] text-calm">{q.explanation}</p>}
                  </li>
                ))}
              </ol>
              {!submitted ? (
                <Button className="mt-6" onClick={() => setSubmitted(true)}>Check answers</Button>
              ) : (
                <p className="mt-6 text-[14px] text-calm-faint">Practice only, not an exam. Run it again from the skill map any time.</p>
              )}
            </section>
          )}
          {error && <p className="mt-4 text-[14px] text-red-300" role="alert">{error}</p>}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#080808]/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const text = String(fd.get('message') ?? '').trim();
            if (!text) return;
            e.currentTarget.reset();
            void ask(text);
          }}
          className="mx-auto flex max-w-[860px] items-center gap-2 px-4 py-3 sm:px-6"
        >
          <label htmlFor="tutor-message" className="sr-only">Message the tutor</label>
          <input
            id="tutor-message"
            name="message"
            autoComplete="off"
            placeholder={topicId ? `Ask about ${contextLabel || 'this topic'}` : 'Pick a topic first, then ask'}
            className="h-11 min-w-0 flex-1 rounded-[10px] border border-border bg-input-bg px-4 text-[15px] text-white"
          />
          <Button type="submit" disabled={loading}>{loading ? 'Thinking' : 'Send'}</Button>
        </form>
      </div>
    </AppShell>
  );
}
