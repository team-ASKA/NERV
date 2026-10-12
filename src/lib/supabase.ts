import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function readEnv(key: string): string {
  try {
    const meta = import.meta as unknown as { env?: Record<string, string | undefined> };
    return meta.env?.[key] ?? '';
  } catch {
    return '';
  }
}

const supabaseUrl = readEnv('VITE_SUPABASE_URL');
const supabaseAnonKey =
  readEnv('VITE_SUPABASE_ANON_KEY') || readEnv('VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY');

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

export function supabaseConfigStatus(): { configured: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!supabaseUrl) missing.push('VITE_SUPABASE_URL');
  if (!supabaseAnonKey) missing.push('VITE_SUPABASE_ANON_KEY');
  return { configured: missing.length === 0, missing };
}

function stubClient(): SupabaseClient {
  const err = () => {
    throw new Error(
      'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
    );
  };
  return new Proxy({} as SupabaseClient, {
    get(_t, prop) {
      if (prop === '__nervUnconfigured') return true;
      return err;
    },
    apply: err,
  });
}

// Never throws at import time: without config we export a stub that throws
// only when actually used, so the app can render a setup/unavailable screen.
export const supabase: SupabaseClient = isSupabaseConfigured()
  ? createClient(supabaseUrl, supabaseAnonKey)
  : stubClient();
