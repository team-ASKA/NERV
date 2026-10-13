/**
 * Firestore → Supabase profile cutover (D03).
 *
 * Usage:
 *   node scripts/migrate-profiles.mjs --dry-run --export ./firestore-users.json
 *   node scripts/migrate-profiles.mjs --commit --export ./firestore-users.json
 *
 * --export: JSON array of { uid, displayName?, email?, ... } from a Firestore
 *   export (or firebase-admin read; this script takes the file so it never
 *   needs production credentials itself in review).
 * --dry-run (default): counts + shows first 10 planned upserts, writes nothing.
 * --commit: upserts into Supabase `profiles` via the SECRET key. Preserves
 *   nonempty existing Supabase data per UID; never deletes.
 *
 * New profile writes already go only to Supabase; any legacy Firestore reads
 * are backend-only during cutover and logged in the task ledger.
 */
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const commit = args.includes('--commit');
const exportIdx = args.indexOf('--export');
const exportPath = exportIdx >= 0 ? args[exportIdx + 1] : null;

if (!exportPath) {
  console.error('Usage: node scripts/migrate-profiles.mjs [--dry-run|--commit] --export <file.json>');
  process.exit(2);
}

const rows = JSON.parse(readFileSync(exportPath, 'utf8'));
if (!Array.isArray(rows)) {
  console.error('Export must be a JSON array.');
  process.exit(2);
}

const planned = rows
  .filter((r) => r && typeof r.uid === 'string' && r.uid)
  .map((r) => ({
    user_id: r.uid,
    display_name: typeof r.displayName === 'string' ? r.displayName.slice(0, 120) : '',
    profile: { email: typeof r.email === 'string' ? r.email : undefined },
    preferences: {},
  }));

console.log(`Profiles in export: ${rows.length}; plannable: ${planned.length}`);
for (const p of planned.slice(0, 10)) console.log(`  ${p.user_id} displayName=${JSON.stringify(p.display_name)}`);
if (!commit) {
  console.log('Dry run — no writes. Re-run with --commit to upsert.');
  process.exit(0);
}

const url = (process.env.SUPABASE_URL ?? '').trim();
const key = (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SECRET_KEY are required for --commit.');
  process.exit(2);
}

const { createClient } = await import('@supabase/supabase-js');
const db = createClient(url, key, { auth: { persistSession: false } });
let upserted = 0;
for (const p of planned) {
  const { data: existing } = await db.from('profiles').select('display_name,profile').eq('user_id', p.user_id).maybeSingle();
  const patch = { user_id: p.user_id, updated_at: new Date().toISOString() };
  if (!existing || !(existing.display_name ?? '').trim()) patch.display_name = p.display_name;
  const { error } = await db.from('profiles').upsert(patch, { onConflict: 'user_id' });
  if (error) {
    console.error(`FAILED ${p.user_id}: ${error.message}`);
  } else {
    upserted++;
  }
}
console.log(`Upserted ${upserted}/${planned.length} (existing nonempty data preserved).`);
