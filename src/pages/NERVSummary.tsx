/**
 * The interview report.
 *
 * One page for both a just-finished interview (navigation state) and a stored
 * one (dashboard history) — `reportData` normalises the two into the same
 * shape, so nothing here has to know which it is looking at.
 *
 * On honesty: every emotional number on this page comes from a real captured
 * Hume reading. When facial analysis didn't run, or ran but produced nothing,
 * the emotion surfaces say so plainly instead of showing invented values. The
 * previous version of this page seeded a full emotion breakdown from a hash of
 * the question id and floored the results "for readability"; none of that
 * survives.
 */

import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Clock,
  Download,
  FileText,
  GraduationCap,
  ListChecks,
  MessageSquare,
  Network,
  Share2,
  Sparkles,
  Target,
  VideoOff,
} from 'lucide-react';

import { AppShell } from '../components/AppShell';
import { KnowledgeGraph, type GraphData } from '../components/KnowledgeGraph';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Markdown,
  ProgressBar,
  SectionHeader,
  Spinner,
  StatTile,
  useToast,
} from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { supabaseInterviewService } from '../services/supabaseInterviewService';
import { getResumeData, type ResumeData } from '../services/firebaseResumeService';
import {
  buildReport,
  reportFromRecord,
  toPersistedMetrics,
  toPersistedReport,
  type QuestionRecord,
  type ReportData,
  type RoundRecord,
} from '../lib/reportData';
import { BAND_TONE, type AggregateSignal, type EmotionSignal } from '../lib/emotionSummary';
import { cn } from '../lib/cn';
import { logger } from '../lib/logger';

const EmotionTimeline = React.lazy(() =>
  import('../components/summary/EmotionTimeline').then((m) => ({ default: m.EmotionTimeline })),
);

type TabId = 'overview' | 'transcript' | 'emotions' | 'skills' | 'graph' | 'report';

const TABS: Array<{ id: TabId; label: string; icon: React.ElementType }> = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'transcript', label: 'Transcript', icon: MessageSquare },
  { id: 'emotions', label: 'Composure', icon: Activity },
  { id: 'skills', label: 'Skills', icon: Target },
  { id: 'graph', label: 'Knowledge graph', icon: Network },
  { id: 'report', label: 'AI report', icon: FileText },
];

// ---------------------------------------------------------------------------
// Small presentational pieces
// ---------------------------------------------------------------------------

/** The "we didn't measure this" surface. Used everywhere emotion is missing. */
function EmotionUnavailable({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <VideoOff size={12} />
        No reading
      </span>
    );
  }
  return (
    <EmptyState
      icon={<VideoOff size={22} />}
      title="Facial analysis didn't run for this session"
      description="Composure metrics need camera access and a working connection to the expression service. Nothing was captured here, so there is nothing to report — these numbers are never estimated."
    />
  );
}

function SignalBars({ signal }: { signal: AggregateSignal | EmotionSignal }) {
  const rows: Array<{ label: string; value: number; tone: 'accent' | 'success' | 'warning' | 'danger' }> = [
    { label: 'Composure', value: signal.composure, tone: 'success' },
    { label: 'Nervousness', value: signal.nervousness, tone: 'warning' },
    { label: 'Strain', value: signal.strain, tone: 'danger' },
  ];
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="text-muted">{r.label}</span>
            <span className="font-medium text-white">{r.value}%</span>
          </div>
          <ProgressBar value={r.value} tone={r.tone} />
        </div>
      ))}
    </div>
  );
}

function ShareList({ shares }: { shares: Array<{ name: string; share: number }> }) {
  if (!shares.length) return null;
  return (
    <div className="space-y-2.5">
      {shares.map((s) => (
        <div key={s.name} className="flex items-center gap-3">
          <span className="w-28 shrink-0 truncate text-sm text-muted">{s.name}</span>
          <div className="min-w-0 flex-1">
            <ProgressBar value={s.share} tone="accent" />
          </div>
          <span className="w-10 shrink-0 text-right text-xs font-medium text-white">{s.share}%</span>
        </div>
      ))}
    </div>
  );
}

function BandBadge({ signal }: { signal: AggregateSignal }) {
  return (
    <Badge variant={BAND_TONE[signal.band]} dot>
      {signal.band} · {signal.confidence}%
    </Badge>
  );
}

function QuestionBlock({ q, showRound }: { q: QuestionRecord; showRound?: boolean }) {
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">Q{q.number}</Badge>
        {showRound && <Badge variant="default">{q.roundLabel}</Badge>}
        <span className="ml-auto">
          {q.signal ? (
            <Badge variant={BAND_TONE[q.signal.confidence >= 70 ? 'Strong' : q.signal.confidence >= 55 ? 'Steady' : q.signal.confidence >= 40 ? 'Mixed' : 'Unsettled']}>
              {q.signal.dominant} · {q.signal.confidence}%
            </Badge>
          ) : (
            <EmotionUnavailable compact />
          )}
        </span>
      </div>
      <p className="text-sm font-medium leading-relaxed text-white">{q.question}</p>
      {q.answer ? (
        <div className="rounded-xl border border-border bg-surface-raised/60 p-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Your answer
          </p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted">{q.answer}</p>
        </div>
      ) : (
        <p className="text-sm italic text-muted-foreground">No answer was recorded for this question.</p>
      )}
    </Card>
  );
}

function RoundSummaryCard({ round }: { round: RoundRecord }) {
  return (
    <Card className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-montserrat text-base font-semibold text-white">{round.label}</h3>
          <p className="text-xs text-muted">
            {round.questionCount} question{round.questionCount === 1 ? '' : 's'}
            {round.durationMinutes > 0 && ` · ${round.durationMinutes} min`}
          </p>
        </div>
        {round.signal ? <BandBadge signal={round.signal} /> : <EmotionUnavailable compact />}
      </div>
      {round.signal ? (
        <>
          <SignalBars signal={round.signal} />
          <p className="text-xs text-muted-foreground">
            Most frequent expression: <span className="text-muted">{round.signal.dominant}</span> · from{' '}
            {round.signal.samples} measured answer{round.signal.samples === 1 ? '' : 's'}
          </p>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          Composure wasn't measured in this round, so only the transcript is available.
        </p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Knowledge graph data
// ---------------------------------------------------------------------------

const CATEGORY_KEYWORDS: Array<[string, string[]]> = [
  ['Frontend', ['react', 'vue', 'angular', 'css', 'html', 'typescript', 'javascript', 'next', 'tailwind', 'redux', 'ui', 'ux', 'frontend', 'svelte']],
  ['Backend', ['node', 'express', 'python', 'java', 'spring', 'django', 'flask', 'rust', 'go', 'c++', 'c#', '.net', 'fastapi', 'backend', 'api', 'graphql']],
  ['Data', ['sql', 'mongo', 'postgres', 'mysql', 'redis', 'firebase', 'supabase', 'dynamodb', 'database', 'pandas', 'spark', 'etl']],
  ['ML / AI', ['ml', 'machine learning', 'deep learning', 'pytorch', 'tensorflow', 'nlp', 'llm', 'transformer', 'cv', 'opencv']],
  ['Cloud / DevOps', ['docker', 'kubernetes', 'aws', 'gcp', 'azure', 'ci', 'cd', 'linux', 'nginx', 'terraform', 'devops', 'cloud']],
];

function buildSkillGraph(
  skills: string[],
  mentions: Record<string, number>,
  totalQuestions: number,
): GraphData {
  if (!skills.length) return { nodes: [], edges: [] };

  const buckets = new Map<string, string[]>();
  for (const skill of skills) {
    const low = skill.toLowerCase();
    const match = CATEGORY_KEYWORDS.find(([, kws]) => kws.some((k) => low.includes(k)));
    const cat = match ? match[0] : 'Other';
    buckets.set(cat, [...(buckets.get(cat) ?? []), skill]);
  }

  const nodes: GraphData['nodes'] = [{ id: 'root', label: 'Your profile', level: 0 }];
  const edges: GraphData['edges'] = [];

  for (const [cat, catSkills] of buckets) {
    const catId = `cat_${cat}`;
    nodes.push({ id: catId, label: cat, level: 1 });
    edges.push({ from: 'root', to: catId });
    for (const skill of catSkills) {
      nodes.push({
        id: `skill_${skill}`,
        label: skill,
        level: 2,
        mentionCount: mentions[skill] ?? 0,
        totalQuestions: totalQuestions || 1,
      });
      edges.push({ from: catId, to: `skill_${skill}` });
    }
  }

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface HistoricalState {
  isHistorical?: boolean;
  interviewData?: unknown;
}

const NERVSummary: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { currentUser } = useAuth();

  const state = (location.state ?? null) as (HistoricalState & Record<string, unknown>) | null;
  const isHistorical = Boolean(state?.isHistorical && state?.interviewData);

  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const savedRef = useRef(false);

  // ---- build the report ----------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!state) {
        setReport(null);
        setLoading(false);
        return;
      }

      if (isHistorical) {
        // A stored row carries no resume, so fetch the current one for the
        // skills view. Failure is fine — the rest of the report still renders.
        let resume: ResumeData | null = null;
        try {
          if (currentUser) resume = await getResumeData(currentUser.uid);
        } catch (err) {
          logger.warn('[summary] resume fetch failed', (err as Error)?.message);
        }
        if (cancelled) return;
        setReport(reportFromRecord(state.interviewData, resume));
      } else {
        setReport(buildReport(state));
      }
      setLoading(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
    // `state` is a stable navigation snapshot for the life of this route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHistorical, currentUser]);

  // ---- persist a freshly finished interview, exactly once -------------------
  useEffect(() => {
    if (!report || isHistorical || savedRef.current) return;
    if (!currentUser || report.totalQuestions === 0) return;

    savedRef.current = true;
    supabaseInterviewService
      .saveInterviewSummary({
        user_id: currentUser.uid,
        total_duration_minutes: Math.round(report.totalDurationMinutes),
        // Stored as -1 when nothing was measured, so history can tell "not
        // measured" apart from "measured, and it was zero".
        overall_confidence: report.overall ? report.overall.confidence : -1,
        summary_markdown: report.summaryMarkdown,
        questions_data: toPersistedReport(report),
        metrics: toPersistedMetrics(report),
      })
      .catch((err) => {
        logger.warn('[summary] save failed', (err as Error)?.message);
        toast.warning('This report could not be saved to your history.');
      });
  }, [report, isHistorical, currentUser, toast]);

  const graphData = useMemo(
    () =>
      report
        ? buildSkillGraph(
            [...report.skills.covered, ...report.skills.gaps],
            report.skills.mentions,
            report.totalQuestions,
          )
        : { nodes: [], edges: [] },
    [report],
  );

  // ---- actions -------------------------------------------------------------
  const handlePrint = () => {
    const prev = document.title;
    document.title = `NERV_Report_${new Date().toISOString().slice(0, 10)}`;
    window.print();
    document.title = prev;
  };

  const handleShare = async () => {
    if (!report) return;
    const lines = [
      'My NERV interview report',
      `${report.totalQuestions} questions · ${report.totalDurationMinutes} min`,
      report.overall
        ? `Composure: ${report.overall.band} (${report.overall.confidence}%)`
        : 'Composure: not measured this session',
      report.skills.total > 0 ? `Skill coverage: ${report.skills.coverage}%` : '',
    ].filter(Boolean);
    const text = lines.join('\n');

    try {
      if (navigator.share) {
        await navigator.share({ title: 'NERV interview report', text, url: window.location.origin });
      } else {
        await navigator.clipboard.writeText(`${text}\n${window.location.origin}`);
        toast.success('Report summary copied to clipboard.');
      }
    } catch {
      /* user dismissed the share sheet — nothing to report */
    }
  };

  const goTrain = (topic?: string) => {
    if (!report) return;
    navigate('/training-session', {
      state: {
        summaryMarkdown: report.summaryMarkdown,
        resumeSkills: [...report.skills.covered, ...report.skills.gaps],
        skillMentions: report.skills.mentions,
        totalQuestions: report.totalQuestions,
        resumeData: report.resume ?? undefined,
        focusTopic: topic,
      },
    });
  };

  // ---- loading / empty -----------------------------------------------------
  if (loading) {
    return (
      <AppShell>
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
          <Spinner size={28} />
          <p className="text-sm text-muted">Building your report…</p>
        </div>
      </AppShell>
    );
  }

  if (!report || report.totalQuestions === 0) {
    return (
      <AppShell>
        <EmptyState
          icon={<FileText size={24} />}
          title="No interview data to report on"
          description="Finish an interview round and its report will appear here. If you arrived from history, that session may not have recorded any questions."
          action={<Button onClick={() => navigate('/dashboard')}>Back to dashboard</Button>}
        />
      </AppShell>
    );
  }

  const { overall } = report;
  const measuredQuestions = report.questions.filter((q) => q.signal);

  return (
    <AppShell>
      {/* Header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<ArrowLeft size={16} />}
            onClick={() => navigate('/dashboard')}
            className="mb-3 -ml-2 print:hidden"
          >
            Dashboard
          </Button>
          <h1 className="font-montserrat text-3xl font-bold tracking-tight text-white">
            Interview report
          </h1>
          <p className="mt-1 text-sm text-muted">
            {report.rounds.map((r) => r.label).join(' · ')}
            {isHistorical && ' · from your history'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button variant="secondary" size="sm" leftIcon={<Share2 size={16} />} onClick={handleShare}>
            Share
          </Button>
          <Button variant="secondary" size="sm" leftIcon={<Download size={16} />} onClick={handlePrint}>
            Export PDF
          </Button>
          <Button size="sm" leftIcon={<GraduationCap size={16} />} onClick={() => goTrain()}>
            Train on gaps
          </Button>
        </div>
      </div>

      {/* Headline stats */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Questions" value={report.totalQuestions} icon={<MessageSquare size={16} />} />
        <StatTile
          label="Duration"
          value={`${report.totalDurationMinutes} min`}
          icon={<Clock size={16} />}
        />
        <StatTile
          label="Skill coverage"
          value={report.skills.total > 0 ? `${report.skills.coverage}%` : '—'}
          icon={<Target size={16} />}
          hint={
            report.skills.total > 0
              ? `${report.skills.covered.length} of ${report.skills.total} resume skills discussed`
              : 'No resume skills on file'
          }
        />
        <StatTile
          label="Composure"
          value={overall ? `${overall.confidence}%` : 'Not measured'}
          icon={<Activity size={16} />}
          hint={
            overall
              ? `${overall.band} · ${overall.samples} of ${report.totalQuestions} answers measured`
              : 'Facial analysis did not run'
          }
        />
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-border print:hidden">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={cn(
              'flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors',
              activeTab === id
                ? 'border-accent text-white'
                : 'border-transparent text-muted hover:text-white',
            )}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      {/* ---------------------------------------------------------------- */}
      {activeTab === 'overview' && (
        <div className="space-y-8 animate-fade-in">
          <section>
            <SectionHeader
              title="Round by round"
              description="How each stage went, with composure shown only where it was actually measured."
            />
            <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {report.rounds.map((r) => (
                <RoundSummaryCard key={r.round} round={r} />
              ))}
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <SectionHeader
                title="What to work on next"
                eyebrow="Recommendations"
                description="Derived from your answers, your resume and — where available — your measured composure."
              />
              <ul className="mt-4 space-y-3">
                {report.suggestions.map((s, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-muted text-[11px] font-semibold text-accent-soft">
                      {i + 1}
                    </span>
                    <span className="text-sm leading-relaxed text-muted">{s}</span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card className="space-y-4">
              <SectionHeader
                title="Resume strength"
                eyebrow="Profile"
                description="How complete your resume sections are — a structural check, not an ATS engine."
              />
              <div className="flex items-center gap-4">
                <div className="relative flex h-20 w-20 shrink-0 items-center justify-center">
                  <svg viewBox="0 0 36 36" className="h-20 w-20 -rotate-90">
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
                    <circle
                      cx="18"
                      cy="18"
                      r="15.5"
                      fill="none"
                      stroke="#6366F1"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeDasharray={`${(report.resumeScore / 100) * 97.4} 97.4`}
                    />
                  </svg>
                  <span className="absolute font-montserrat text-lg font-bold text-white">
                    {report.resumeScore}
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-muted">
                  {report.resumeScore >= 80
                    ? 'Well-rounded — every major section carries real content.'
                    : report.resumeScore >= 60
                      ? 'Solid, with room to expand your projects and achievements.'
                      : 'Thin in places. Fuller experience and project sections will give an interviewer more to work with.'}
                </p>
              </div>
            </Card>
          </section>

          {report.code && (
            <section>
              <SectionHeader title="Scratchpad" description="What you wrote during the technical round." />
              <Card className="mt-4 overflow-x-auto" padded={false}>
                <pre className="p-4 text-xs leading-relaxed text-muted">
                  <code>{report.code}</code>
                </pre>
              </Card>
            </section>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {activeTab === 'transcript' && (
        <div className="space-y-8 animate-fade-in">
          {report.rounds.map((round) => (
            <section key={round.round}>
              <SectionHeader
                title={round.label}
                description={`${round.questionCount} question${round.questionCount === 1 ? '' : 's'}`}
              />
              <div className="mt-4 space-y-4">
                {round.questions.length > 0 ? (
                  round.questions.map((q) => <QuestionBlock key={q.id} q={q} />)
                ) : (
                  <Card>
                    <p className="text-sm text-muted">No questions were recorded for this round.</p>
                  </Card>
                )}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {activeTab === 'emotions' && (
        <div className="space-y-8 animate-fade-in">
          {!report.emotionAvailable || !overall ? (
            <EmotionUnavailable />
          ) : (
            <>
              <Card className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <SectionHeader
                    title="Overall composure"
                    eyebrow="Facial expression analysis"
                    description={`Averaged over the ${overall.samples} answer${overall.samples === 1 ? '' : 's'} where a reading was captured — out of ${report.totalQuestions} total.`}
                  />
                  <BandBadge signal={overall} />
                </div>
                <div className="grid gap-6 md:grid-cols-2">
                  <SignalBars signal={overall} />
                  <div>
                    <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Strongest expressions
                    </p>
                    <ShareList shares={overall.top} />
                  </div>
                </div>
              </Card>

              {measuredQuestions.length > 1 && (
                <Card>
                  <SectionHeader
                    title="Composure over time"
                    description="Gaps are answers where no reading was captured — they are left blank rather than estimated."
                  />
                  <div className="mt-4">
                    <Suspense
                      fallback={
                        <div className="flex h-[240px] items-center justify-center">
                          <Spinner size={22} />
                        </div>
                      }
                    >
                      <EmotionTimeline questions={report.questions} />
                    </Suspense>
                  </div>
                </Card>
              )}

              <section>
                <SectionHeader
                  title="Per answer"
                  description="Only answers with a captured reading are listed."
                />
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {measuredQuestions.map((q) => (
                    <Card key={q.id} className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">
                          {q.roundLabel} · Q{q.number}
                        </Badge>
                        <span className="ml-auto text-sm font-semibold text-white">
                          {q.signal?.confidence}%
                        </span>
                      </div>
                      <p className="line-clamp-2 text-sm text-muted">{q.question}</p>
                      {q.signal && <ShareList shares={q.signal.top.slice(0, 3)} />}
                    </Card>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {activeTab === 'skills' && (
        <div className="space-y-6 animate-fade-in">
          {report.skills.total === 0 ? (
            <EmptyState
              icon={<Target size={22} />}
              title="No resume skills on file"
              description="Upload a resume from the dashboard and your next report will show which of your skills actually came up in conversation."
              action={<Button onClick={() => navigate('/dashboard')}>Go to dashboard</Button>}
            />
          ) : (
            <>
              <Card className="space-y-4">
                <SectionHeader
                  title="Skill coverage"
                  eyebrow={`${report.skills.covered.length} of ${report.skills.total} discussed`}
                  description="Counted from your own answers only — a skill doesn't count just because the interviewer said it."
                />
                <ProgressBar
                  value={report.skills.coverage}
                  tone={report.skills.coverage >= 60 ? 'success' : report.skills.coverage >= 35 ? 'warning' : 'danger'}
                  showLabel
                />
              </Card>

              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <SectionHeader title="Came up in your answers" eyebrow="Covered" />
                  <div className="mt-4 flex flex-wrap gap-2">
                    {report.skills.covered.length > 0 ? (
                      report.skills.covered.map((s) => (
                        <Badge key={s} variant="success">
                          {s} · {report.skills.mentions[s]}×
                        </Badge>
                      ))
                    ) : (
                      <p className="text-sm text-muted">None of your listed skills came up in what you said.</p>
                    )}
                  </div>
                </Card>

                <Card>
                  <SectionHeader title="Never mentioned" eyebrow="Gaps" />
                  <div className="mt-4 flex flex-wrap gap-2">
                    {report.skills.gaps.length > 0 ? (
                      report.skills.gaps.map((s) => (
                        <button key={s} type="button" onClick={() => goTrain(s)} title={`Train on ${s}`}>
                          <Badge variant="warning">{s}</Badge>
                        </button>
                      ))
                    ) : (
                      <p className="text-sm text-muted">You touched on every skill from your resume. Well covered.</p>
                    )}
                  </div>
                  {report.skills.gaps.length > 0 && (
                    <p className="mt-3 text-xs text-muted-foreground">Tap a skill to start a training session on it.</p>
                  )}
                </Card>
              </div>
            </>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {activeTab === 'graph' && (
        <div className="animate-fade-in">
          {graphData.nodes.length > 1 ? (
            <Card className="space-y-4">
              <SectionHeader
                title="Your skill map"
                eyebrow="Knowledge graph"
                description="Node size reflects how often each skill came up in your answers. Right-click a node to explain it or quiz yourself."
              />
              <div className="h-[540px] overflow-hidden rounded-xl border border-border bg-surface-raised/40">
                <KnowledgeGraph
                  data={graphData}
                  onNodeSelect={(_, label) => goTrain(label)}
                  onNodeExplain={(label) => goTrain(label)}
                  onNodeQuiz={(label) => goTrain(label)}
                />
              </div>
            </Card>
          ) : (
            <EmptyState
              icon={<Network size={22} />}
              title="Not enough skill data to draw a map"
              description="Upload a resume so NERV knows what to map, then run an interview."
              action={<Button onClick={() => navigate('/dashboard')}>Go to dashboard</Button>}
            />
          )}
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {activeTab === 'report' && (
        <div className="animate-fade-in">
          {report.summaryMarkdown ? (
            <Card>
              <Markdown size="base">{report.summaryMarkdown}</Markdown>
            </Card>
          ) : (
            <EmptyState
              icon={<Sparkles size={22} />}
              title="The written report isn't available"
              description="The summary model couldn't be reached for this session. Everything else on this page is built from your transcript and still applies."
              action={
                <Button variant="secondary" leftIcon={<ListChecks size={16} />} onClick={() => setActiveTab('overview')}>
                  See the overview
                </Button>
              }
            />
          )}
        </div>
      )}
    </AppShell>
  );
};

export default NERVSummary;
