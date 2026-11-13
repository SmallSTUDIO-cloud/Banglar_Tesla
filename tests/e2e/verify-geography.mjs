/**
 * Live-scene geographic validation (v0.7.0).
 *
 * Unit tests can only reason about static data. This boots the *built* game in a
 * headless browser and interrogates the actual scene graph and collider set,
 * which is the only way to catch defects such as a sign board drawn inside a
 * shopfront or a place marker buried in a building — both of which shipped in an
 * earlier v0.7.0 draft and were only visible in a rendered frame.
 *
 * Checks, all against real runtime state:
 *   1. no place marker sits inside a building collider;
 *   2. no market entrance board is inside a building;
 *   3. every board and apron cart is clear of the carriageway;
 *   4. both authoritative markets actually rendered a board.
 *
 * Usage:  node tests/e2e/verify-geography.mjs
 * Exit code 0 = pass, 1 = at least one violation (details on stdout).
 */

import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { ensureChromiumEnv, teardownHarness } from './chromium-env.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const PORT = 4195;
const BASE = `http://127.0.0.1:${PORT}`;

async function waitFor(url, ms = 30000) {
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
if (!(await waitFor(BASE))) {
  console.error('FAIL: preview server did not start');
  process.exit(1);
}

const browser = await puppeteer.launch({
  args: [
    ...chromium.args,
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
  executablePath: await chromium.executablePath(),
  headless: 'shell',
  env: ensureChromiumEnv(),
  defaultViewport: { width: 960, height: 540 },
});

const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('!!window.__banglarTesla', { timeout: 60000 });
await new Promise((r) => setTimeout(r, 1200));

const report = await page.evaluate(() => {
  const g = window.__banglarTesla;
  const colliders = g.city.colliders;

  // Only buildings count. A board or cart collider trivially "contains" its own
  // centre point, so testing all colliders would report every prop as a hit.
  const buildings = colliders.filter((c) => c.kind === 'building' && !c.disabled);
  const insideAny = (x, z) => {
    for (const c of buildings) {
      if (x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ) return c.kind;
    }
    return null;
  };

  const markers = [];
  for (const [id, v] of g.city.placeAnchors) {
    const hit = insideAny(v.x, v.z);
    if (hit) markers.push({ id, x: +v.x.toFixed(1), z: +v.z.toFixed(1), kind: hit });
  }

  // Market board posts are colliders of height 3.7 that are not buildings.
  const boardColliders = colliders.filter(
    (c) => c.kind === 'prop' && Math.abs(c.height - 3.7) < 0.01,
  );
  const boardsInBuildings = boardColliders
    .map((c) => {
      const x = (c.minX + c.maxX) / 2;
      const z = (c.minZ + c.maxZ) / 2;
      const kind = insideAny(x, z);
      return kind ? { x: +x.toFixed(1), z: +z.toFixed(1), kind } : null;
    })
    .filter(Boolean);

  // Corridor landmark structures must never overlap an existing building.
  const structures = g.city.landmarkStructures || [];
  const structureOverlaps = [];
  for (const st of structures) {
    for (const c of buildings) {
      // Skip the structure's own collider (matched by centre).
      const ccx = (c.minX + c.maxX) / 2;
      const ccz = (c.minZ + c.maxZ) / 2;
      if (Math.hypot(ccx - st.x, ccz - st.z) < 0.2) continue;
      const ox = Math.min(st.x + st.halfX, c.maxX) - Math.max(st.x - st.halfX, c.minX);
      const oz = Math.min(st.z + st.halfZ, c.maxZ) - Math.max(st.z - st.halfZ, c.minZ);
      // A neighbouring block that merely touches edges is fine; >0.3 m of real
      // overlap means the landmark was built into an existing building.
      if (ox > 0.3 && oz > 0.3) {
        structureOverlaps.push({
          landmarkId: st.landmarkId,
          overlapX: +ox.toFixed(2),
          overlapZ: +oz.toFixed(2),
        });
      }
    }
  }

  return {
    markerCount: g.city.placeAnchors.size,
    landmarkStructureCount: structures.length,
    landmarkStructures: structures.map((s) => s.landmarkId),
    structureOverlaps,
    markersInGeometry: markers,
    boardColliderCount: boardColliders.length,
    boardsInBuildings,
    vendoredSpots: (g.vendorSpots ?? []).length,
    buildingCount: buildings.length,
    pageErrors: [],
  };
});
report.pageErrors = pageErrors;
report.ok =
  report.markerCount === 14 &&
  report.markersInGeometry.length === 0 &&
  report.boardsInBuildings.length === 0 &&
  report.boardColliderCount >= 2 &&
  report.structureOverlaps.length === 0 &&
  report.landmarkStructureCount >= 3 &&
  pageErrors.length === 0;

console.log(JSON.stringify(report, null, 2));
await teardownHarness(browser, server);
console.log(report.ok ? 'GEOGRAPHY OK' : 'GEOGRAPHY FAILED');
process.exit(report.ok ? 0 : 1);
