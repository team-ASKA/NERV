/** Fail if provider secrets appear in the browser bundle or tracked env files. */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SECRET_NAMES = ['GROQ_API_KEY', 'GEMINI_API_KEY', 'SARVAM_API_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'HUME_SECRET_KEY', 'DATABASE_URL', 'REDIS_URL'];
let failed = false;

// 1. dist/ must not contain secret values or (most) secret names.
if (existsSync('dist')) {
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|css|html|map)$/.test(e.name)) {
        const text = readFileSync(p, 'utf8');
        for (const name of SECRET_NAMES) {
          if (name === 'REDIS_URL' || name === 'DATABASE_URL') continue;
          if (text.includes(name) && !/VITE_/.test(name)) {
            console.error(`FAIL: dist bundle references ${name} (${p})`);
            failed = true;
          }
        }
      }
    }
  };
  walk('dist');
}

// 2. No tracked .env files with secrets.
for (const f of ['.env', '.env.local', '.env.production', 'worker/.env']) {
  if (existsSync(f)) {
    console.error(`FAIL: ${f} exists in the checkout; secrets belong in deployment secret stores.`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log('check-secrets: ok');
