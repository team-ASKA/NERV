/** Paginated full history (server-side, 20/page, max 50). */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { supabaseInterviewService, type InterviewRecord } from '../services/supabaseInterviewService';
import { AppShell } from '../components/AppShell';
import { Button, Card, EmptyState } from '../components/ui';

export default function History() {
  const [items, setItems] = useState<InterviewRecord[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (c?: string | null) => {
    setLoading(true);
    try {
      const page = await supabaseInterviewService.getHistoryPage(c ?? undefined, 20);
      setItems((prev) => (c ? [...prev, ...page.items] : page.items));
      setCursor(page.nextCursor);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(null);
  }, []);

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-3 p-4">
        <p className="font-mono text-[12px] font-medium uppercase tracking-[0.16em] text-calm-faint">Archive</p>
        <h1 className="font-montserrat text-[28px] font-bold tracking-[-0.02em] text-white">History</h1>
        {error && (
          <Card className="p-4">
            <p className="text-sm text-red-300" role="alert">{error}</p>
            <Button className="mt-2" variant="secondary" onClick={() => void load(null)}>Retry</Button>
          </Card>
        )}
        {items.length === 0 && !loading && !error && (
          <EmptyState
            title="No interviews yet"
            description="Each finished session lands here as one ruled row: date, length, and the evidence behind your report."
            action={
              <Link to="/dashboard">
                <Button rightIcon={<ArrowRight className="h-4 w-4" />}>Start a practice interview</Button>
              </Link>
            }
          />
        )}
        {items.map((i) => (
          <Card key={i.id} className="flex items-center justify-between p-4">
            <div>
              <p className="font-medium">{i.created_at ? new Date(i.created_at).toLocaleString() : 'Session'}</p>
              <p className="text-sm text-white/60">{i.total_duration_minutes} min</p>
            </div>
            <Link to={`/reports/legacy/${i.id}`} className="text-sm font-bold text-white">View</Link>
          </Card>
        ))}
        {cursor && <Button variant="secondary" onClick={() => void load(cursor)} disabled={loading}>Load more</Button>}
      </div>
    </AppShell>
  );
}
