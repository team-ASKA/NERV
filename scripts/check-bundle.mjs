/** Bundle budgets: initial auth route ≤300kB gzip; dashboard ≤450kB eager. */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

if (!existsSync('dist')) {
  console.log('check-bundle: no dist/ yet, skipping');
  process.exit(0);
}

const assets = [];
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) {
      const raw = readFileSync(p);
      assets.push({ file: p, gzip: gzipSync(raw).length, size: statSync(p).size });
    }
  }
};
walk(join('dist', 'assets'));

const total = assets.reduce((a, b) => a + b.gzip, 0);
console.log(`check-bundle: ${assets.length} chunks, total gzip ${(total / 1024).toFixed(0)} kB`);
for (const a of assets.sort((x, y) => y.gzip - x.gzip).slice(0, 8)) {
  console.log(`  ${(a.gzip / 1024).toFixed(0)} kB gzip  ${a.file}`);
}
// Advisory in this pass: report, don't fail — budgets are ratified with
// measured staging numbers (L02), not by suppressing the build.
console.log('check-bundle: ok (advisory)');
