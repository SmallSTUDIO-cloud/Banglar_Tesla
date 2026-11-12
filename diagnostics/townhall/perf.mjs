/**
 * Renderer-cost probe for the Town Hall reconstruction.
 *
 * Reports draw calls, triangles, geometries and texture count at three fixed
 * viewpoints. Run it against two builds (market enabled / disabled) and diff the
 * numbers to get the market's own per-frame cost.
 *
 *   node diagnostics/townhall/perf.mjs [label]
 *
 * Honest note on frame time: this runs Chromium's SwiftShader (CPU)
 * rasteriser, so the millisecond figures are **not** phone performance. Only the
 * draw-call and triangle counts are meaningful as a device-cost proxy; the wall
 * clock is reported so nobody mistakes it for a mobile benchmark.
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
const label = process.argv[2] ?? 'run';
const PORT = 4217;
const BASE = `http://127.0.0.1:${PORT}`;

const VIEWS = [
  { name: 'frontage', pos: [67.0, 2.0, 98.8], look: [70.8, 5.5, 83.1], fov: 64 },
  { name: 'hall', pos: [57.4, 1.8, 80.2], look: [84.3, 3.5, 72.4], fov: 66 },
  { name: 'aerial', pos: [84.9, 62, 124.8], look: [71.0, 2, 76.8], fov: 55 },
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
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction('!!window.__banglarTesla', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 1500));
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

const rows = [];
for (const v of VIEWS) {
  await page.evaluate((view) => {
    const g = window.__banglarTesla;
    g.debugFreeCamera = true;
    g.camera.position.set(view.pos[0], view.pos[1], view.pos[2]);
    g.camera.lookAt(view.look[0], view.look[1], view.look[2]);
    g.camera.fov = view.fov;
    g.camera.updateProjectionMatrix();
  }, v);
  await new Promise((r) => setTimeout(r, 700));
  const stats = await page.evaluate(async () => {
    const g = window.__banglarTesla;
    const frames = [];
    let last = performance.now();
    await new Promise((done) => {
      let n = 0;
      const tick = () => {
        const now = performance.now();
        frames.push(now - last);
        last = now;
        if (++n >= 10) done();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    frames.shift();
    return {
      drawCalls: g.renderer.info.render.calls,
      triangles: g.renderer.info.render.triangles,
      geometries: g.renderer.info.memory.geometries,
      textures: g.renderer.info.memory.textures,
      programs: g.renderer.info.programs?.length ?? 0,
      meanFrameMs: +(frames.reduce((a, b) => a + b, 0) / frames.length).toFixed(1),
    };
  });
  rows.push({ view: v.name, ...stats });
  console.log(`${label} ${v.name.padEnd(9)} calls=${String(stats.drawCalls).padStart(4)} tris=${String(stats.triangles).padStart(8)} geos=${stats.geometries} progs=${stats.programs} frame=${stats.meanFrameMs}ms`);
}

const out = path.join(__dirname, `perf-${label}.json`);
fs.writeFileSync(out, JSON.stringify({ label, captureNote: 'SwiftShader CPU rasteriser — frame times are not device measurements', rows }, null, 2));
console.log(`wrote ${path.relative(root, out)}`);
await teardownHarness(browser, server);
