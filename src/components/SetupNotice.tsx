/** Rendered when required config is missing: honest setup/unavailable state. */
import { isFirebaseConfigured, firebaseConfigStatus } from '../lib/firebase';
import { isSupabaseConfigured, supabaseConfigStatus } from '../lib/supabase';
import { demoAllowed, appConfig } from '../lib/config';

export default function SetupNotice({ section }: { section: string }) {
  const fb = firebaseConfigStatus();
  const sb = supabaseConfigStatus();
  const demo = demoAllowed();
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm" role="status">
      <p className="font-semibold text-amber-200">Setup needed for {section}</p>
      <ul className="mt-2 list-disc pl-5 text-amber-100/90">
        {!isFirebaseConfigured() && <li>Missing: {fb.missing.join(', ')}</li>}
        {!isSupabaseConfigured() && section !== 'auth' && <li>Missing: {sb.missing.join(', ')}</li>}
      </ul>
      <p className="mt-2 text-amber-100/80">
        {demo
          ? 'Demo mode is on: you can explore with synthetic data, clearly labelled.'
          : 'Copy .env.example to .env and fill the missing values. Nothing here will silently fake live data.'}
      </p>
      {appConfig.isProduction && demo && (
        <p className="mt-1 text-red-300">Demo mode is rejected in production builds.</p>
      )}
    </div>
  );
}
