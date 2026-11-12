/**
 * Screenshot capture for the synthetic-road eviction audit.
 *
 * Real headless Chromium (the repo's own `puppeteer-core` + `@sparticuz/chromium`
 * pair), pointed at the diagnostic dev server. Nothing is mocked: every image is
 * produced by the page rendering the measured audit data.
 *
 *   node diagnostics/synthetic-road-audit/capture.mjs [baseUrl]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { ensureChromiumEnv, teardownHarness } from '../../tests/e2e/chromium-env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'out');
const BASE = process.argv[2] ?? 'http://127.0.0.1:4321';

fs.mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  executablePath: await chromium.executablePath(),
  headless: 'shell',
  env: ensureChromiumEnv(),
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
});

const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR ${String(e).slice(0, 300)}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`CONSOLE ${m.text().slice(0, 300)}`);
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 180_000 });
await page.waitForFunction('!!window.__audit && window.__audit.ready', { timeout: 300_000 });
await wait(600);

const summary = await page.evaluate(() => window.__audit.summary);
const rows = await page.evaluate(() => window.__audit.rows);
fs.writeFileSync(path.join(outDir, 'audit-rows.json'), JSON.stringify({ summary, rows }, null, 2));

const shots = [];
async function shot(name, note) {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  const size = fs.statSync(file).size;
  shots.push({ name, note, bytes: size });
  console.log(`shot ${name}.png (${size} bytes) — ${note}`);
}

// 1. whole city, everything painted by measured cause
await page.evaluate(() => window.__audit.setPlan('world'));
await wait(350);
await shot('01-plan-world', 'whole shipped city; evicted footprints painted by cause');

// 2. every eviction, numbered
await page.evaluate(() => window.__audit.setPlan('evictions'));
await wait(350);
await shot('02-plan-evictions', 'all 54 evicted footprints, numbered');

// 3. zoom on the densest cluster
const bounds = await page.evaluate(() => window.__audit.classBounds('carriageway-overlap'));
if (bounds) {
  const pad = 55;
  await page.evaluate(
    (b, p) => window.__audit.setRegion(b.minX - p, b.minZ - p, b.maxX + p, b.maxZ + p),
    bounds, pad,
  );
  await wait(350);
  await shot('03-plan-zoom-conflicts', 'zoom: footprints under the asphalt vs corridor-only rejections');
}

// 4-6. street level on the synthetic carriageway
for (const [i, u] of [0.18, 0.42, 0.62].entries()) {
  await page.evaluate((uu) => window.__audit.setStreet(uu), u);
  await wait(1400);
  await shot(`0${4 + i}-street-${Math.round(u * 100)}pct`, `street level at ${Math.round(u * 100)}% along the synthetic road`);
}

// 7. oblique 3D aerial: the road's real placement across the city
await page.evaluate(() => window.__audit.setBird());
await wait(1200);
await shot('07-bird-3d', 'oblique aerial; cyan wash is the synthetic carriageway');

fs.writeFileSync(path.join(outDir, 'capture-report.json'), JSON.stringify({ summary, shots, errors }, null, 2));
console.log('errors:', errors.length ? errors : 'none');

await teardownHarness(browser, null);
process.exit(errors.length ? 1 : 0);
