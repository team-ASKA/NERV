/** Dashboard as a rehearsal room: poster greeting, one lit stage, ruled wings. */
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useDashboardData } from '../hooks/useDashboardData';
import { DashboardNextAction, WingsLedger } from '../components/dashboard/panels';
import { KnowledgeGraph } from '../components/KnowledgeGraph';
import { buildGraph } from '../lib/graph/buildGraph';
import { AppShell } from '../components/AppShell';
import { Button } from '../components/ui';
import SetupNotice from '../components/SetupNotice';
import { isFirebaseConfigured } from '../lib/firebase';
import { apiFetch } from '../lib/apiClient';
import { validateUpload, MAX_UPLOAD_BYTES } from '../../shared/ingestion';

export default function Dashboard() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const { data, loading, error, refresh } = useDashboardData();
  const [starting, setStarting] = useState(false);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [showGraph, setShowGraph] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const name = data.profile?.displayName?.split(' ')[0] || '';

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
      setUploadNote(check.error);
      return;
    }
    setUploadBusy(true);
    setUploadNote(`Reading ${f.name}. You can leave this page; progress is kept.`);
    try {
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
      setUploadNote(null);
      void refresh();
    } catch (e) {
      setUploadNote(`Upload failed: ${(e as Error).message}. Your current resume is untouched. Retry the same file.`);
    } finally {
      setUploadBusy(false);
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

  return (
    <AppShell>
      <div className="mx-auto max-w-[960px] px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
        {!isFirebaseConfigured() && <SetupNotice section="dashboard data" />}

        <header className="settle">
          <h1 className="max-w-[22ch] font-montserrat text-[34px] font-bold leading-[1.04] tracking-[-0.02em] text-white sm:text-[44px]">
            {name ? `Good to see you, ${name}.` : 'Good to see you.'}
          </h1>
          <p className="mt-3 max-w-[52ch] text-[16px] leading-[1.55] text-calm">
            {data.activeSession
              ? 'You have an interview in progress.'
              : data.currentResume
                ? 'Your resume is ready. Start when you are.'
                : 'Upload your resume to get questions grounded in your experience.'}
          </p>
        </header>

        <div className="mt-8">
          {loading ? (
            <div className="stage rounded-[14px] p-8" aria-busy="true">
              <div className="h-6 w-2/3 animate-pulse rounded bg-white/10" />
              <div className="mt-3 h-4 w-1/2 animate-pulse rounded bg-white/5" />
            </div>
          ) : error && !data.currentResume && !data.activeSession ? (
            <div className="rounded-[14px] border border-border bg-surface p-8">
              <p className="text-[15px] text-white" role="alert">The dashboard could not load: {error}</p>
              <Button className="mt-4" variant="secondary" onClick={() => void refresh()}>Retry</Button>
            </div>
          ) : (
            <div className="space-y-8">
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
              {uploadNote && (
                <div aria-live="polite">
                  <div
                    className="h-px w-full overflow-hidden bg-white/10"
                    role={uploadBusy ? 'progressbar' : undefined}
                    aria-label={uploadBusy ? 'Uploading resume' : undefined}
                  >
                    {uploadBusy && <div className="h-full w-1/3 animate-shimmer bg-white/50" />}
                  </div>
                  <p className="mt-2 text-[14px] text-calm">{uploadNote}</p>
                  <p className="mt-0.5 text-[13px] text-calm-faint">
                    Limit {(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)} MB PDF.
                  </p>
                </div>
              )}
              <WingsLedger data={data} />
              <section aria-label="Skill map" className="settle settle-2">
                <button
                  type="button"
                  onClick={() => setShowGraph((v) => !v)}
                  aria-expanded={showGraph}
                  className="group inline-flex items-center gap-2 text-[15px] font-medium text-white"
                >
                  <ChevronDown
                    className={`h-4 w-4 text-calm-faint transition-transform duration-200 ease-settle ${showGraph ? 'rotate-180' : ''}`}
                    aria-hidden
                  />
                  {showGraph ? 'Put the skill map away' : 'Look at the skill map'}
                </button>
                {showGraph && (
                  <div className="mt-4 h-96 overflow-hidden rounded-[14px] border border-border bg-surface">
                    <KnowledgeGraph
                      nodes={graph.nodes}
                      edges={graph.edges}
                      onAction={(sel) => navigate(`/training?topicId=${encodeURIComponent(sel.topicId)}&action=${sel.action}`)}
                    />
                  </div>
                )}
              </section>
            </div>
          )}
        </div>

        <p className="mt-12 text-[13px] text-calm-faint">Signed in as {currentUser?.email ?? 'demo user'}.</p>
      </div>
    </AppShell>
  );
}
