/** Addressable report: pending / failed+retry / ready / transcript-only. */
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiFetch } from '../lib/apiClient';
import { AppShell } from '../components/AppShell';
import { Button, Card, EmptyState } from '../components/ui';

interface ReportState {
  report: {
    evaluation?: { summary?: string; nextStep?: string; recommendations?: string[]; unassessedTopics?: string[]; expressionNotes?: string[]; quotes?: Array<{ quote: string }> };
    summary_markdown?: string;
  } | null;
  jobStatus: string;
  legacy?: boolean;
}

export default function ReportPage({ legacy }: { legacy?: boolean }) {
  const params = useParams();
  const id = legacy ? params.interviewId! : params.sessionId!;
  const [state, setState] = useState<ReportState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    const url = legacy ? `/api/reports/${id}` : `/api/reports/${id}`;
    apiFetch<ReportState>(url)
      .then(setState)
      .catch((e) => setError((e as Error).message));
  }, [id, legacy]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (state?.jobStatus !== 'queued' && state?.jobStatus !== 'running') return;
    const t = setTimeout(load, 4000);
    return () => clearTimeout(t);
  }, [state?.jobStatus, load]);

  const retry = async () => {
    setRetrying(true);
    try {
      await apiFetch(`/api/reports/${id}/retry`, { method: 'POST', body: '{}' });
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        {error && (
          <Card className="p-6">
            <h1 className="text-lg font-semibold">Report unavailable</h1>
            <p className="mt-1 text-sm text-white/60">{error}</p>
            <Button className="mt-4" onClick={load}>Retry</Button>
          </Card>
        )}
        {state?.jobStatus === 'queued' || state?.jobStatus === 'running' ? (
          <Card className="p-6">
            <h1 className="text-lg font-semibold">Your report is being written…</h1>
            <p className="mt-1 text-sm text-white/60">Your transcript is saved. This refreshes automatically.</p>
          </Card>
        ) : null}
        {state?.jobStatus === 'failed' ? (
          <Card className="p-6">
            <h1 className="text-lg font-semibold">Report generation failed</h1>
            <p className="mt-1 text-sm text-white/60">Your transcript is intact. Retry to generate the written evaluation.</p>
            <Button className="mt-4" onClick={() => void retry()} disabled={retrying}>
              {retrying ? 'Retrying…' : 'Retry report'}
            </Button>
          </Card>
        ) : null}
        {state?.report ? (
          <Card className="p-6 print:text-black">
            <h1 className="text-xl font-bold">Interview report</h1>
            {state.legacy && <p className="text-xs text-white/50">Historical report — original context preserved as stored.</p>}
            <p className="mt-3 whitespace-pre-wrap text-sm">
              {state.report.evaluation?.summary ?? state.report.summary_markdown ?? 'Transcript-only: the written evaluation is unavailable.'}
            </p>
            {state.report.evaluation?.nextStep && (
              <p className="mt-3 text-sm"><strong>Next step:</strong> {state.report.evaluation.nextStep}</p>
            )}
            {state.report.evaluation?.quotes?.length ? (
              <blockquote className="mt-4 border-l-2 border-white/40 pl-3 text-sm italic text-white/80">
                “{state.report.evaluation.quotes[0]!.quote}”
              </blockquote>
            ) : null}
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" onClick={() => window.print()}>Print / save PDF</Button>
              <Link to="/training"><Button variant="ghost">Practise a topic</Button></Link>
            </div>
          </Card>
        ) : null}
        {!state && !error && (
          <EmptyState title="Loading report…" description="Fetching your saved evaluation." />
        )}
      </div>
    </AppShell>
  );
}
