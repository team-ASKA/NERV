import { chromium } from 'playwright-core';
const SHELL = 'C:\\Users\\techn\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1248\\chrome-headless-shell-win64\\chrome-headless-shell.exe';
const browser = await chromium.launch({ executablePath: SHELL });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:4401/', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const wide = await page.evaluate(() => {
  const out = [];
  const de = document.documentElement;
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.right > de.clientWidth + 1 || r.left < -1) {
      out.push(`${el.tagName}.${(el.className?.baseVal ?? el.className ?? '').toString().slice(0, 60)} right=${Math.round(r.right)} left=${Math.round(r.left)}`);
    }
  }
  return out.slice(0, 12);
});
console.log(wide.join('\n') || 'nothing sticks out');
await browser.close();
