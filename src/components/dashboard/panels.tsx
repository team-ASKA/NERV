/** Focused dashboard panels: one CTA per panel, distinct empty/error states. */
import { Link } from 'react-router-dom';
import { Button, Card, EmptyState } from '../ui';
import type { DashboardData } from '../../hooks/useDashboardData';

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
      <Card className="p-6">
        <h2 className="text-lg font-semibold">Pick up where you left off</h2>
        <p className="mt-1 text-sm text-white/60">
          {data.activeSession.currentRound} round in progress.
        </p>
        <Button className="mt-4" onClick={() => onResume(data.activeSession!.id)}>
          Resume interview
        </Button>
      </Card>
    );
  }
  if (!data.currentResume) {
    return (
      <Card className="p-6">
        <h2 className="text-lg font-semibold">Upload your resume to begin</h2>
        <p className="mt-1 text-sm text-white/60">
          Questions are grounded in your experience. Up to 30 minutes; rounds may finish earlier.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button onClick={onUpload}>Upload resume</Button>
          <Button variant="ghost" onClick={onStart} disabled={starting}>
            Try a general interview
          </Button>
        </div>
      </Card>
    );
  }
  if (data.currentResume.reviewState === 'needs_review') {
    return (
      <Card className="p-6">
        <h2 className="text-lg font-semibold">Review your extracted facts</h2>
        <p className="mt-1 text-sm text-white/60">Check the skills and roles we found before starting.</p>
        <Link to="/settings#resume" className="mt-4 inline-block">
          <Button>Review resume</Button>
        </Link>
      </Card>
    );
  }
  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">Ready when you are</h2>
      <p className="mt-1 text-sm text-white/60">Up to 30 minutes; rounds may finish earlier.</p>
      <Button className="mt-4" onClick={onStart} disabled={starting}>
        {starting ? 'Starting…' : 'Start interview'}
      </Button>
    </Card>
  );
}

export function ResumeStatusCard({ data }: { data: DashboardData }) {
  if (!data.currentResume) return null;
  const r = data.currentResume;
  return (
    <Card className="p-5">
      <h3 className="text-sm font-semibold text-white/80">Resume</h3>
      <p className="mt-1 font-medium">{r.name || 'Your resume'}</p>
      <p className="text-sm text-white/60">{r.skills.slice(0, 5).join(' · ') || 'No skills extracted yet'}</p>
      {r.warnings.length > 0 && (
        <p className="mt-2 text-xs text-amber-300">{r.warnings[0]}</p>
      )}
      <Link to="/settings#resume" className="mt-3 inline-block text-sm text-indigo-300 hover:text-indigo-200">
        Replace resume
      </Link>
    </Card>
  );
}

export function LatestReportCard({ data }: { data: DashboardData }) {
  const r = data.latestReport;
  if (!r) {
    return (
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-white/80">Latest report</h3>
        <EmptyState title="No reports yet" description="Finish an interview to get evidence-based feedback." />
      </Card>
    );
  }
  return (
    <Card className="p-5">
      <h3 className="text-sm font-semibold text-white/80">Latest report</h3>
      <p className="mt-1 text-sm text-white/60">Status: {r.status}</p>
      <Link to={`/reports/${r.sessionId}`} className="mt-3 inline-block">
        <Button variant="secondary">View report</Button>
      </Link>
    </Card>
  );
}

export function RecentInterviewList({ data }: { data: DashboardData }) {
  if (data.recentSessions.length === 0) return null;
  return (
    <Card className="p-5">
      <h3 className="text-sm font-semibold text-white/80">Recent sessions</h3>
      <ul className="mt-2 space-y-2">
        {data.recentSessions.slice(0, 3).map((s) => (
          <li key={s.id} className="flex items-center justify-between text-sm">
            <span className="text-white/70">
              {s.currentRound} · {s.status}
            </span>
            <Link to={`/interviews/${s.id}`} className="text-indigo-300 hover:text-indigo-200">
              Open
            </Link>
          </li>
        ))}
      </ul>
      <Link to="/history" className="mt-3 inline-block text-sm text-indigo-300 hover:text-indigo-200">
        Full history
      </Link>
    </Card>
  );
}

export function SuggestedPractice({ data }: { data: DashboardData }) {
  const p = data.practiceSuggestion;
  if (!p) return null;
  return (
    <Card className="p-5">
      <h3 className="text-sm font-semibold text-white/80">Recommended practice</h3>
      <p className="mt-1 font-medium">{p.label}</p>
      <p className="text-sm text-white/60">{p.reason}</p>
      <Link
        to={`/training?topicId=${encodeURIComponent(p.topicId)}&action=explain`}
        className="mt-3 inline-block"
      >
        <Button variant="secondary">Practise topic</Button>
      </Link>
    </Card>
  );
}
