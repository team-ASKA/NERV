/** Paginated full history (server-side, 20/page, max 50). */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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
        <h1 className="text-xl font-bold">History</h1>
        {error && (
          <Card className="p-4">
            <p className="text-sm text-red-300" role="alert">{error}</p>
            <Button className="mt-2" variant="secondary" onClick={() => void load(null)}>Retry</Button>
          </Card>
        )}
        {items.length === 0 && !loading && !error && (
          <EmptyState title="No interviews yet" description="Your completed sessions will appear here." />
        )}
        {items.map((i) => (
          <Card key={i.id} className="flex items-center justify-between p-4">
            <div>
              <p className="font-medium">{i.created_at ? new Date(i.created_at).toLocaleString() : 'Session'}</p>
              <p className="text-sm text-white/60">{i.total_duration_minutes} min</p>
            </div>
            <Link to={`/reports/legacy/${i.id}`} className="text-sm text-indigo-300">View</Link>
          </Card>
        ))}
        {cursor && <Button variant="secondary" onClick={() => void load(cursor)} disabled={loading}>Load more</Button>}
      </div>
    </AppShell>
  );
}
