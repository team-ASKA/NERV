/** Browser runtime config: validated, never throws at import, no secrets. */

export type DemoMode = 'off' | 'mock';

function env(key: string): string {
  try {
    const meta = import.meta as unknown as { env?: Record<string, string | undefined> };
    return (meta.env?.[key] ?? '').trim();
  } catch {
    return '';
  }
}

export const appConfig = {
  get demoMode(): DemoMode {
    return env('VITE_DEMO_MODE') === 'mock' ? 'mock' : 'off';
  },
  get apiBase(): string {
    return env('VITE_API_URL').replace(/\/$/, '');
  },
  get emotionProvider(): string {
    return env('VITE_EMOTION_PROVIDER') || 'mediapipe';
  },
  get isProduction(): boolean {
    try {
      return (import.meta as unknown as { env?: Record<string, unknown> }).env?.PROD === true;
    } catch {
      return false;
    }
  },
};

export function demoAllowed(): boolean {
  if (appConfig.isProduction && appConfig.demoMode !== 'off') return false;
  return appConfig.demoMode === 'mock';
}

export function apiUrl(path: string): string {
  if (!path.startsWith('/')) path = `/${path}`;
  return `${appConfig.apiBase}${path}`;
}
