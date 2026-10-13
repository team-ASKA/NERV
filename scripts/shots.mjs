/** Minimal QA screenshots: desktop + phone + reduced-motion + focus. */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const SHELL = 'C:\\Users\\techn\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1248\\chrome-headless-shell-win64\\chrome-headless-shell.exe';
const BASE = process.argv[2] ?? 'http://127.0.0.1:4400';
const ROUTES = ['/', '/login', '/dashboard', '/training', '/history', '/settings', '/nope'];
const OUT = '.shots/calm';

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: SHELL });
const errors = [];

for (const route of ROUTES) {
  const name = route === '/' ? 'home' : route.slice(1).replace('/', '-');
  for (const [vp, w, h] of [['d', 1440, 900], ['m', 390, 844]]) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: h },
      reducedMotion: vp === 'm' ? 'reduce' : 'no-preference',
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    const consoleErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)); });
    page.on('pageerror', (e) => consoleErrors.push(String(e).slice(0, 160)));
    await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 30000 }).catch((e) => errors.push(`${vp}-${name}: nav ${String(e).slice(0, 120)}`));
    await page.waitForTimeout(1200);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.screenshot({ path: `${OUT}/${vp}-${name}.png` });
    // keyboard: tab a few stops, screenshot focus
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.screenshot({ path: `${OUT}/k-${vp}-${name}.png` });
    console.log(`${vp}-${name}: overflow=${overflow}px errors=${consoleErrors.length}${consoleErrors.length ? ' :: ' + consoleErrors.join(' | ') : ''}`);
    if (overflow > 0) errors.push(`${vp}-${name}: horizontal overflow ${overflow}px`);
    if (consoleErrors.length) errors.push(`${vp}-${name}: console ${consoleErrors.join(' | ')}`);
    await ctx.close();
  }
}
await browser.close();
console.log(errors.length ? `\nFAILURES:\n${errors.join('\n')}` : '\nALL CLEAN');
process.exit(errors.length ? 1 : 0);
