/** Validate required/production env configuration without printing values. */
const isProd = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
const need = (name) => (process.env[name] ?? '').trim() !== '';
const missing = [];

if (isProd) {
  for (const n of ['FIREBASE_PROJECT_ID', 'SUPABASE_URL', 'RESUME_BUCKET', 'REDIS_URL', 'DATABASE_URL']) {
    if (!need(n) && !(n === 'FIREBASE_PROJECT_ID' && need('VITE_FIREBASE_PROJECT_ID'))) missing.push(n);
  }
  if (!need('SUPABASE_SECRET_KEY') && !need('SUPABASE_SERVICE_ROLE_KEY')) missing.push('SUPABASE_SECRET_KEY');
  if (need('ALLOW_UNVERIFIED_AUTH') && process.env.ALLOW_UNVERIFIED_AUTH === 'true') {
    console.error('FAIL: ALLOW_UNVERIFIED_AUTH must never be true in production.');
    process.exit(1);
  }
  if (need('DEMO_MODE') && process.env.DEMO_MODE === 'mock') {
    console.error('FAIL: DEMO_MODE=mock is rejected in production.');
    process.exit(1);
  }
}

if (missing.length) {
  console.error(`FAIL: missing required production config: ${missing.join(', ')}`);
  process.exit(1);
}
console.log('check-env: ok');
