/** Profile, devices/preferences, privacy, account management. */
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { AppShell } from '../components/AppShell';
import { Button, Card, Input } from '../components/ui';

export default function Settings() {
  const { logout } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [duration, setDuration] = useState(10);
  const [inputMode, setInputMode] = useState('both');
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ displayName: string; preferences: Record<string, unknown> }>('/api/profile')
      .then((p) => {
        setDisplayName(p.displayName ?? '');
        if (p.preferences.durationMinutes === 5 || p.preferences.durationMinutes === 15) {
          setDuration(p.preferences.durationMinutes as number);
        }
        if (typeof p.preferences.inputMode === 'string') setInputMode(p.preferences.inputMode as string);
      })
      .catch(() => undefined);
  }, []);

  const save = async () => {
    setError(null);
    try {
      await apiFetch('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify({ displayName, preferences: { durationMinutes: duration, inputMode } }),
      });
      setSaved('Saved.');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl space-y-4 p-4">
        <p className="font-mono text-[12px] font-medium uppercase tracking-[0.16em] text-calm-faint">Control</p>
        <h1 className="font-montserrat text-[28px] font-bold tracking-[-0.02em] text-white">Settings</h1>
        <Card className="space-y-3 p-5">
          <h2 className="font-semibold">Profile</h2>
          <Input label="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={120} />
          <div className="flex gap-3">
            <label className="text-sm"> Round length
              <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="ml-2 h-10 rounded-lg border border-border bg-input-bg px-2 text-sm">
                <option value={5}>5 min</option>
                <option value={10}>10 min</option>
                <option value={15}>15 min</option>
              </select>
            </label>
            <label className="text-sm"> Input
              <select value={inputMode} onChange={(e) => setInputMode(e.target.value)} className="ml-2 h-10 rounded-lg border border-border bg-input-bg px-2 text-sm">
                <option value="both">Voice + text</option>
                <option value="voice">Voice</option>
                <option value="text">Text</option>
              </select>
            </label>
          </div>
          {error && <p className="text-sm text-red-300" role="alert">{error}</p>}
          {saved && <p className="text-sm text-green-300" role="status">{saved}</p>}
          <Button onClick={() => void save()}>Save</Button>
        </Card>
        <Card className="space-y-2 p-5" id="resume">
          <h2 className="font-semibold">Resume</h2>
          <p className="text-sm text-white/60">Upload and review happen on the dashboard. Replacement only switches after extraction succeeds.</p>
        </Card>
        <Card className="space-y-2 p-5">
          <h2 className="font-semibold">Privacy</h2>
          <p className="text-sm text-white/60">Camera analysis is optional and local by default. Cloud analysis needs your explicit opt-in per session.</p>
          <Button variant="secondary" onClick={() => void logout()}>Sign out</Button>
        </Card>
      </div>
    </AppShell>
  );
}
