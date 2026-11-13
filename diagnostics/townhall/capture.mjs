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
  { name: '01-approach-west', pos: [49.4, 2.2, 102.8], look: [67.5, 6, 86.1], fov: 58,
    note: 'approach from the Town Hall junction: frontage running away to the east' },
  { name: '02-approach-east', pos: [96.1, 2.2, 91.4], look: [67.5, 6, 86.1], fov: 58,
    note: 'approach from the Post Office end, looking back along the frontage' },
  { name: '03-frontage-street', pos: [67.0, 2.0, 98.8], look: [70.8, 5.5, 83.1], fov: 64,
    note: 'from the carriageway: the shopfront terrace head-on' },
  // Road-local s 48, v 19.8 looking back west down the bazaar street at eye
  // height: the hall arcade, its fish/vegetable boards and the stall rows.
  { name: '04-bazar-inside', pos: [81.9, 1.7, 74.4], look: [60.9, 2.2, 79.0], fov: 70,
    note: 'down the centre of the bazaar aisle: stallholders, counters, produce' },
  { name: '05-junction', pos: [51.0, 2.2, 101.3], look: [67.2, 5, 85.2], fov: 62,
    note: 'Town Hall junction, three-quarter view of the market corner' },
  { name: '06-market-hall', pos: [57.4, 1.8, 80.2], look: [84.3, 3.5, 72.4], fov: 66,
    note: 'inside the bazaar street: stalls, hall arcade, tin roof' },
  // Directly over the Asad Avenue carriageway looking north-east across the
  // block. The previous 26 m southern viewpoint sat behind a roofline and
  // showed a white roof instead of the market.
  { name: '07-elevated', pos: [45.8, 34, 104.9], look: [71.8, 5, 72.4], fov: 54,
    note: 'elevated over the road: frontage, bazaar spine, halls, mosque' },
  // The working yard is on the far side of the halls and is invisible from the
  // road, so it needs its own frame: trucks at the loading bays, stacked crates,
  // the compound wall and the corrugated hall roof from above.
  { name: '09-north-yard', pos: [84.9, 20, 45.7], look: [66.3, 3, 67.7], fov: 58,
    note: 'over the yard behind the halls: deliveries, refuse, compound wall' },
  // Street level at the kerb among the produce, with the crowd and the traffic.
  { name: '10-kerb-activity', pos: [64.2, 1.9, 96.4], look: [77.8, 2.1, 85.7], fov: 62,
    note: 'driving past at eye level: produce heaps, awnings, shoppers on the kerb' },
  { name: '08-aerial', pos: [84.9, 62, 124.8], look: [71.0, 2, 76.8], fov: 55,
    note: 'aerial over the market block' },
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
});

/**
 * Put the RIDER on Asad Avenue at the market before shooting.
 *
 * The pedestrian system culls walkers more than ~135 units from the rickshaw and
 * only staffs the bazaar while the rider is in the district. Moving the camera
 * alone would therefore photograph an empty market that no player would ever
 * see. `debugTeleport` is the game's own "drive here" primitive, so this is the
 * arrival state, not a special one.
 */
const PLAYER_ANCHOR = { x: 67.0, z: 98.8, yaw: 1.85 };
await page.evaluate((a) => {
  const g = window.__banglarTesla;
  g.debugTeleport(a.x, a.z, a.yaw);
}, PLAYER_ANCHOR);
await new Promise((r) => setTimeout(r, 2500));
await page.evaluate(() => {
  window.__banglarTesla.debugFreeCamera = true;
});

/**
 * Renderer cost at a viewpoint. `info.render.calls` is the draw-call count for
 * the frame just submitted, and the frame-time figure is the mean of the next
 * 30 frames — measured in the same process the game runs in, not estimated.
 */
async function measure() {
  return page.evaluate(async () => {
    const g = window.__banglarTesla;
    const frames = [];
    let last = performance.now();
    await new Promise((done) => {
      let n = 0;
      const tick = () => {
        const now = performance.now();
        frames.push(now - last);
        last = now;
        if (++n >= 12) done();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    frames.shift();
    const sorted = [...frames].sort((a, b) => a - b);
    return {
      drawCalls: g.renderer.info.render.calls,
      triangles: g.renderer.info.render.triangles,
      geometries: g.renderer.info.memory.geometries,
      textures: g.renderer.info.memory.textures,
      programs: g.renderer.info.programs?.length ?? 0,
      meanFrameMs: +(frames.reduce((a, b) => a + b, 0) / frames.length).toFixed(2),
      p95FrameMs: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2),
    };
  });
}

/** Views sampled for renderer cost: street, interior and aerial. */
const PERF_VIEWS = new Set(['03-frontage-street', '06-market-hall', '08-aerial']);

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
  await page.screenshot({ path: file, timeout: 120000 });
  const bytes = fs.statSync(file).size;
  // Full renderer stats on three representative views; a 12-frame sample each is
  // enough to catch a regression without stalling the software renderer.
  const perf = PERF_VIEWS.has(view.name) ? await measure() : null;
  shots.push({ ...view, file: path.relative(root, file), bytes, perf });
  console.log(`shot ${path.basename(file)} (${bytes} bytes) — ${view.note}`);
}

const measured = shots.filter((s) => s.perf);
const summary = measured.reduce(
  (acc, s) => ({
    maxDrawCalls: Math.max(acc.maxDrawCalls, s.perf.drawCalls),
    maxTriangles: Math.max(acc.maxTriangles, s.perf.triangles),
    worstMeanFrameMs: Math.max(acc.worstMeanFrameMs, s.perf.meanFrameMs),
    measuredViews: acc.measuredViews + 1,
  }),
  { maxDrawCalls: 0, maxTriangles: 0, worstMeanFrameMs: 0, measuredViews: 0 },
);

const live = await page.evaluate(() => {
  const g = window.__banglarTesla;
  return {
    pedestrians: g.peds?.activePedestrianCount ?? null,
    marketCrew: g.peds?.marketCrewCount ?? null,
    marketPosts: g.city?.marketVendorPosts?.length ?? null,
  };
});

const report = {
  capturedAt: new Date().toISOString(),
  base: BASE,
  tag,
  playerAnchor: PLAYER_ANCHOR,
  live,
  summary,
  shots,
  errors,
};
fs.writeFileSync(path.join(outDir, `capture-report${tag ? `-${tag}` : ''}.json`), JSON.stringify(report, null, 2));
console.log('errors:', errors.length ? errors : 'none');

await teardownHarness(browser, server);
process.exit(errors.length ? 1 : 0);
