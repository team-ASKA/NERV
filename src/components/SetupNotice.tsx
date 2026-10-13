/** Rendered when required config is missing: honest setup/unavailable state. */
import { isFirebaseConfigured, firebaseConfigStatus } from '../lib/firebase';
import { isSupabaseConfigured, supabaseConfigStatus } from '../lib/supabase';
import { demoAllowed, appConfig } from '../lib/config';

export default function SetupNotice({ section }: { section: string }) {
  const fb = firebaseConfigStatus();
  const sb = supabaseConfigStatus();
  const demo = demoAllowed();
  const missing = [
    ...(!isFirebaseConfigured() ? fb.missing : []),
    ...(!isSupabaseConfigured() && section !== 'auth' ? sb.missing : []),
  ];
  return (
    <div className="rounded-[14px] border border-amber-500/30 bg-amber-500/10 px-5 py-4 text-sm" role="status">
      <p className="font-medium text-amber-200">
        {demo ? 'Demo mode. Synthetic data, clearly labelled.' : `Setup needed for ${section}.`}
      </p>
      {!demo && (
        <p className="mt-1 text-[13px] text-amber-100/80">
          Copy .env.example to .env and fill the missing values. Nothing here will silently fake live data.
        </p>
      )}
      {missing.length > 0 && (
        <details className="mt-2 text-[13px] text-amber-100/70">
          <summary className="cursor-pointer hover:text-amber-100">
            {missing.length} missing value{missing.length === 1 ? '' : 's'}
          </summary>
          <ul className="mt-1 list-disc pl-5">
            {missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </details>
      )}
      {appConfig.isProduction && demo && (
        <p className="mt-1 text-red-300">Demo mode is rejected in production builds.</p>
      )}
    </div>
  );
}
