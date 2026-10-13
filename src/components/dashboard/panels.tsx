/** Rehearsal room panels: one lit stage, quiet ruled wings. */
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { Button, EmptyState } from '../ui';
import type { DashboardData } from '../../hooks/useDashboardData';

function StageShell({
  eyebrow,
  title,
  body,
  children,
  status,
}: {
  eyebrow: string;
  title: string;
  body: string;
  children: React.ReactNode;
  status?: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="stage settle rounded-[14px] p-5 sm:p-6">
      <p className="font-mono text-[12px] font-medium uppercase tracking-[0.16em] text-calm-faint">{eyebrow}</p>
      <h2 className="mt-2 font-montserrat text-[22px] font-bold leading-[1.08] tracking-[-0.02em] text-white sm:text-[26px]">
        {title}
      </h2>
      <p className="mt-1.5 max-w-[52ch] text-[14px] leading-[1.5] text-calm">{body}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">{children}</div>
      {status && <div className="mt-4 border-t border-white/10 pt-3">{status}</div>}
    </section>
  );
}

export function DashboardNextAction({
  data,
  onUpload,
  onStart,
  onResume,
  starting,
}: {
  data: DashboardData;
  onUpload: () => void;
  onStart: () => void;
  onResume: (id: string) => void;
  starting: boolean;
}) {
  if (data.activeSession) {
    return (
      <StageShell
        eyebrow="Next step"
        title="Pick up where you left off"
        body={`Your ${data.activeSession.currentRound} round is waiting. Nothing was lost.`}
        status={
          <p className="text-[13px] text-calm-faint" aria-live="polite">
            Paused interviews keep their transcript. Resume when ready.
          </p>
        }
      >
        <Button size="lg" onClick={() => onResume(data.activeSession!.id)} rightIcon={<ArrowRight className="h-4 w-4" />}>
          Resume interview
        </Button>
      </StageShell>
    );
  }
  if (!data.currentResume) {
    return (
      <StageShell
        eyebrow="Next step"
        title="Upload your resume to begin"
        body="Every question is grounded in your experience. Up to 30 minutes. Rounds may finish earlier."
      >
        <Button size="lg" onClick={onUpload} rightIcon={<ArrowRight className="h-4 w-4" />}>
          Upload resume
        </Button>
        <Button size="lg" variant="outline" onClick={onStart} disabled={starting}>
          General interview
        </Button>
      </StageShell>
    );
  }
  if (data.currentResume.reviewState === 'needs_review') {
    return (
      <StageShell
        eyebrow="Next step"
        title="Check what was extracted"
        body="A quick look at the skills and roles found in your resume, then you can start."
      >
        <Link to="/settings#resume">
          <Button size="lg" rightIcon={<ArrowRight className="h-4 w-4" />}>Review resume</Button>
        </Link>
      </StageShell>
    );
  }
  return (
    <StageShell
      eyebrow="Next step"
      title="Ready when you are"
      body="Up to 30 minutes. Rounds may finish earlier, and you can pause any time."
      status={
        <p className="text-[13px] text-calm-faint">
          {data.latestReport ? 'Your latest report is in the ledger below.' : 'Your first report will appear here after you finish.'}{' '}
          <span className="font-cursive text-[17px] text-calm">pause anytime, no pressure</span>
        </p>
      }
    >
      <Button size="lg" onClick={onStart} loading={starting} rightIcon={<ArrowRight className="h-4 w-4" />}>
        {starting ? 'Starting' : 'Start interview'}
      </Button>
    </StageShell>
  );
}

function WingRow({
  label,
  children,
  action,
}: {
  label: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="wing-row grid grid-cols-[110px_1fr_auto] items-baseline gap-3 py-2.5 sm:grid-cols-[150px_1fr_auto]">
      <p className="font-mono text-[12px] uppercase tracking-[0.12em] text-calm-faint">{label}</p>
      <div className="min-w-0 text-[15px] leading-[1.5] text-white/90">{children}</div>
      <div className="text-[14px]">{action}</div>
    </div>
  );
}

function WingLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 text-[14px] font-bold text-white transition-colors hover:text-calm"
    >
      {children}
      <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
    </Link>
  );
}

/** The wings: one ruled ledger, not a grid of competing cards. */
export function WingsLedger({ data }: { data: DashboardData }) {
  const r = data.currentResume;
  const rep = data.latestReport;
  const sessions = data.recentSessions.slice(0, 3);
  const practice = data.practiceSuggestion;
  if (!r && !rep && sessions.length === 0 && !practice) return null;
  return (
    <section aria-label="Your ledger" className="settle settle-1 rounded-[14px] border border-border bg-surface px-4 sm:px-5">
      {r && (
        <WingRow
          label="Resume"
          action={<WingLink to="/settings#resume">Replace</WingLink>}
        >
          <p className="truncate font-medium text-white">{r.name || 'Your resume'}</p>
          <p className="truncate text-[14px] text-calm">{r.skills.slice(0, 5).join('  ·  ') || 'No skills extracted yet'}</p>
          {r.warnings.length > 0 && <p className="mt-1 text-[13px] text-warning">{r.warnings[0]}</p>}
        </WingRow>
      )}
      <WingRow
        label="Report"
        action={rep ? <WingLink to={`/reports/${rep.sessionId}`}>View</WingLink> : undefined}
      >
        {rep ? (
          <p>
            Latest report <span className="text-calm">is {rep.status}</span>
          </p>
        ) : (
          <p className="text-calm">No reports yet. One appears here after your first interview.</p>
        )}
      </WingRow>
      {sessions.length > 0 && (
        <WingRow label="Sessions" action={<WingLink to="/history">History</WingLink>}>
          <ul className="divide-y divide-white/5">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-baseline justify-between gap-3 py-1.5">
                <span className="tnum text-[14px] capitalize text-calm">
                  {s.currentRound} <span aria-hidden>·</span> {s.status}
                </span>
                <Link to={`/interviews/${s.id}`} className="shrink-0 text-[14px] font-bold text-white hover:text-calm">
                  Open
                </Link>
              </li>
            ))}
          </ul>
        </WingRow>
      )}
      {practice && (
        <WingRow
          label="Practice"
          action={
            <WingLink to={`/training?topicId=${encodeURIComponent(practice.topicId)}&action=explain`}>
              Practise
            </WingLink>
          }
        >
          <p className="font-medium text-white">{practice.label}</p>
          <p className="text-[14px] text-calm">{practice.reason}</p>
        </WingRow>
      )}
    </section>
  );
}

// Kept for compatibility with secondary surfaces; the dashboard uses WingsLedger.
export function ResumeStatusCard({ data }: { data: DashboardData }) {
  if (!data.currentResume) return null;
  return <WingsLedger data={{ ...data, latestReport: null, recentSessions: [], practiceSuggestion: null }} />;
}

export function LatestReportCard({ data }: { data: DashboardData }) {
  if (data.latestReport) return null;
  return <EmptyState title="No reports yet" description="Finish an interview to get evidence-based feedback." />;
}

export function RecentInterviewList() {
  return null;
}

export function SuggestedPractice() {
  return null;
}
