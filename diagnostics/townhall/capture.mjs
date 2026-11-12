/**
 * Town Hall visual capture — real browser, real game, no mock geometry.
 *
 * Boots the production build behind `vite preview`, starts free-roam, hides the
 * HUD and drives the actual camera to a list of viewpoints around Mohammadpur
 * Town Hall Market (world-unit positions, metres for elevation/fov).
 *
 *   node diagnostics/townhall/capture.mjs [outDir] [tag]
 *
 * Every image is the live render. Nothing here is drawn or composited: the
 * script only positions the camera and presses the shutter.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { ensureChromiumEnv, teardownHarness } from '../../tests/e2e/chromium-env.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const outDir = path.resolve(process.argv[2] ?? path.join(__dirname, 'out'));
const tag = process.argv[3] ?? '';
const PORT = 4211;
const BASE = `http://127.0.0.1:${PORT}`;

fs.mkdirSync(outDir, { recursive: true });

/**
 * Viewpoints. `pos`/`look` are world units (the coordinate space the game's
 * camera already uses); `fov` is degrees. Distances quoted in the comments are
 * measured from the market polygon centroid (64.93, 98.11).
 */
const VIEWS = [
  { name: '01-approach-west', pos: [24, 2.2, 110], look: [70, 6, 95], fov: 55,
    note: 'westbound approach along Asad Ave, market ahead-right' },
  { name: '02-approach-east', pos: [104, 2.2, 88], look: [62, 6, 99], fov: 55,
    note: 'eastbound approach along Asad Ave toward the market frontage' },
  { name: '03-frontage-street', pos: [58, 2.0, 104], look: [70, 7, 93], fov: 60,
    note: 'street level on the frontage, looking at the market elevation' },
  { name: '04-bazar-inside', pos: [62, 2.0, 96], look: [80, 4, 92], fov: 62,
    note: 'inside the market apron / kacha bazar' },
  { name: '05-junction', pos: [44, 2.2, 108], look: [66, 5, 99], fov: 58,
    note: 'Town Hall junction, looking into the market corner' },
  { name: '06-elevated', pos: [30, 34, 132], look: [78, 3, 96], fov: 50,
    note: 'elevated oblique: market block, frontage and surrounding streets' },
  { name: '07-aerial', pos: [64, 96, 190], look: [86, 2, 96], fov: 55,
    note: 'high aerial over the market and Asad Avenue corridor' },
];

async function waitFor(url, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const server = spawn(
  path.join(root, 'node_modules/.bin/vite'),
  ['preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
  { cwd: root, stdio: 'ignore' },
);
await waitFor(BASE);

const browser = await puppeteer.launch({
  args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  executablePath: await chromium.executablePath(),
  headless: 'shell',
  env: ensureChromiumEnv(),
  defaultViewport: { width: 1440, height: 810, deviceScaleFactor: 1 },
});

const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR ${String(e).slice(0, 300)}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`CONSOLE ${m.text().slice(0, 300)}`);
});

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction('!!window.__banglarTesla', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 1500));

// One-time scene setup: free roam, a fixed daylight phase, no HUD.
await page.evaluate(() => {
  const g = window.__banglarTesla;
  g.debugStartMode('free');
  g.debugSetPhase('noon', 'sunny');
});
await new Promise((r) => setTimeout(r, 1500));
await page.evaluate(() => {
  const g = window.__banglarTesla;
  g.ui.show(null);
  g.debugFreeCamera = true;
});

const shots = [];
for (const view of VIEWS) {
  await page.evaluate((v) => {
    const g = window.__banglarTesla;
    g.debugFreeCamera = true;
    g.camera.position.set(v.pos[0], v.pos[1], v.pos[2]);
    g.camera.lookAt(v.look[0], v.look[1], v.look[2]);
    g.camera.fov = v.fov;
    g.camera.updateProjectionMatrix();
  }, view);
  await new Promise((r) => setTimeout(r, 900));
  const file = path.join(outDir, `${view.name}${tag ? `-${tag}` : ''}.png`);
  await page.screenshot({ path: file });
  const bytes = fs.statSync(file).size;
  shots.push({ ...view, file: path.relative(root, file), bytes });
  console.log(`shot ${path.basename(file)} (${bytes} bytes) — ${view.note}`);
}

const report = { capturedAt: new Date().toISOString(), base: BASE, tag, shots, errors };
fs.writeFileSync(path.join(outDir, `capture-report${tag ? `-${tag}` : ''}.json`), JSON.stringify(report, null, 2));
console.log('errors:', errors.length ? errors : 'none');

await teardownHarness(browser, server);
process.exit(errors.length ? 1 : 0);
