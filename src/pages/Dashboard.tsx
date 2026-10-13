/** Minimal next-action dashboard (plan §5): one CTA, compact panels, honest states. */
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useDashboardData } from '../hooks/useDashboardData';
import { deriveDashboardState } from '../lib/dashboardState';
import {
  DashboardNextAction,
  LatestReportCard,
  RecentInterviewList,
  ResumeStatusCard,
  SuggestedPractice,
} from '../components/dashboard/panels';
import { KnowledgeGraph } from '../components/KnowledgeGraph';
import { buildGraph } from '../lib/graph/buildGraph';
import { AppShell } from '../components/AppShell';
import { Button, Card } from '../components/ui';
import SetupNotice from '../components/SetupNotice';
import { isFirebaseConfigured } from '../lib/firebase';
import { apiFetch } from '../lib/apiClient';
import { validateUpload, MAX_UPLOAD_BYTES } from '../../shared/ingestion';

export default function Dashboard() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const { data, loading, error, refresh } = useDashboardData();
  const [starting, setStarting] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [showGraph, setShowGraph] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const firstName = data.profile?.displayName?.split(' ')[0] || 'there';

  const startInterview = async (generic = false) => {
    setStarting(true);
    try {
      const payload: Record<string, unknown> = {
        requestId: crypto.randomUUID(),
        durationMinutes: 10,
        inputMode: 'both',
      };
      if (generic) payload.genericMode = true;
      else if (data.currentResume) payload.resumeId = data.currentResume.id;
      else payload.genericMode = true;
      const { session } = await apiFetch<{ session: { id: string } }>('/api/sessions', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      navigate(`/interviews/${session.id}`);
    } catch {
      setStarting(false);
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const check = validateUpload({ byteSize: f.size, mimeType: f.type || 'application/pdf' });
    if (!check.ok) {
      setUploading(check.error);
      return;
    }
    setUploading(`Uploading ${f.name}…`);
    try {
      // Signed-URL upload stays direct to Storage; API mints the URL.
      const { uploadUrl, storagePath } = await apiFetch<{ uploadUrl: string; storagePath: string }>(
        '/api/resume/upload-url',
        { method: 'POST', body: JSON.stringify({ filename: f.name, byteSize: f.size, mimeType: 'application/pdf' }) },
      );
      await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: f });
      const { createHash } = await import('../lib/hash');
      const hash = await createHash(f);
      await apiFetch('/api/resume/ingest', {
        method: 'POST',
        body: JSON.stringify({ contentHash: hash, storagePath, filename: f.name, byteSize: f.size, mimeType: 'application/pdf' }),
      });
      setUploading(null);
      void refresh();
    } catch (e) {
      setUploading(`Upload failed: ${(e as Error).message}. Your previous resume (if any) is untouched — retry the same file.`);
    }
  };

  const graph = buildGraph({
    resumeVersion: data.currentResume?.id ?? 'demo',
    skills: data.currentResume?.skills ?? [],
    projects: [],
    experience: [],
    education: [],
    achievements: [],
  });

  const state = deriveDashboardState({
    hasResume: Boolean(data.currentResume),
    resumeReviewNeeded: data.currentResume?.reviewState === 'needs_review',
    ingesting: uploading !== null && !uploading.startsWith('Upload failed'),
    activeSessionId: data.activeSession?.id ?? null,
    latestReportStatus: data.latestReport ? (data.latestReport.status as 'pending' | 'ready') : 'none',
    loadFailed: Boolean(error),
  });
  void state;

  return (
    <AppShell>
      <div className="mx-auto max-w-[1120px] space-y-6 p-4 sm:p-6">
        {!isFirebaseConfigured() && <SetupNotice section="dashboard data" />}
        <header>
          <h1 className="text-2xl font-bold">Good to see you, {firstName}.</h1>
          <p className="mt-1 text-sm text-white/60">
            {data.activeSession
              ? 'You have an interview in progress.'
              : data.currentResume
                ? 'Your resume is ready — start when you are.'
                : 'Upload your resume to get questions grounded in your experience.'}
          </p>
        </header>

        {loading ? (
          <Card className="p-6"><p className="text-white/60">Loading…</p></Card>
        ) : error && !data.currentResume && !data.activeSession ? (
          <Card className="space-y-3 p-6">
            <p className="text-sm text-red-300" role="alert">Couldn’t load your dashboard: {error}</p>
            <Button variant="secondary" onClick={() => void refresh()}>Retry</Button>
          </Card>
        ) : (
          <>
            <DashboardNextAction
              data={data}
              starting={starting}
              onUpload={() => fileRef.current?.click()}
              onStart={() => void startInterview(false)}
              onResume={(id) => navigate(`/interviews/${id}`)}
            />
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              aria-label="Choose a PDF resume"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            {uploading && (
              <Card className="p-4" aria-live="polite">
                <p className="text-sm">{uploading}</p>
                <p className="mt-1 text-xs text-white/50">Limit {(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)} MB PDF. Progress survives reload via job status.</p>
              </Card>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              <ResumeStatusCard data={data} />
              <LatestReportCard data={data} />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <RecentInterviewList data={data} />
              <SuggestedPractice data={data} />
            </div>
            <Card className="p-4">
              <button type="button" onClick={() => setShowGraph((v) => !v)} aria-expanded={showGraph} className="text-sm font-semibold text-indigo-300">
                {showGraph ? 'Hide skill map' : 'View skill map'}
              </button>
              {showGraph && (
                <div className="mt-3 h-96">
                  <KnowledgeGraph
                    nodes={graph.nodes}
                    edges={graph.edges}
                    onAction={(sel) => navigate(`/training?topicId=${encodeURIComponent(sel.topicId)}&action=${sel.action}`)}
                  />
                </div>
              )}
            </Card>
          </>
        )}
        <p className="text-xs text-white/40">Signed in as {currentUser?.email ?? 'demo user'}.</p>
      </div>
    </AppShell>
  );
}
