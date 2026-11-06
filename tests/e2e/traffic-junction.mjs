/* Rendered NPC turning fixture using the real traffic update and road graph.
 * Artificially positions one fleet agent and spectator camera; not a race. */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { ensureChromiumEnv, teardownHarness } from './chromium-env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = 4231;
const server = spawn(path.join(root, 'node_modules/.bin/vite'), ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
let browser;
try {
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}`)).ok) break; } catch { /* boot */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  browser = await puppeteer.launch({ args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'], executablePath: await chromium.executablePath(), headless: 'shell', env: ensureChromiumEnv(), defaultViewport: { width: 960, height: 540 } });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('!!window.__banglarTesla');
  await page.evaluate(() => window.__banglarTesla.debugStartMode('free'));
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  const results = [];
  for (const [kind, fromId, toId] of [['car','asad_0:rev','ring_0:fwd'], ['bus','ring_0:rev','asad_0:fwd']]) {
    const result = await page.evaluate(([kind, fromId, toId]) => {
      const g = window.__banglarTesla;
      const t = g.traffic;
      const lane = t.graph.byId.get(fromId);
      const next = t.graph.byId.get(toId);
      if (!lane || !next) throw new Error('missing traffic road graph lane');
      // Reuse one existing pool instance, keeping the original route and physics.
      const idx = t.debugPositionAgentForTest(kind,
        lane.ax + lane.ux * (lane.length - 8),
        lane.az + lane.uz * (lane.length - 8), lane.yaw, 4);
      if (idx < 0) throw new Error('no available NPC pool instance');
      const a = t.agents[idx];
      t.agents = [a];
      a.lane = lane;
      a.plannedLaneId = null;
      a.s = lane.length - 8;
      a.speed = 4;
      a.cruise = 6.5;
      a.dwellTimer = a.dwellCooldown = a.stuckTimer = a.roadRageHold = 0;
      a.lateralOffset = a.targetLateral = a.turnOffsetX = a.turnOffsetZ = 0;
      a.x = lane.ax + lane.ux * a.s;
      a.z = lane.az + lane.uz * a.s;
      a.yaw = lane.yaw;
      // Keep spectator/player away from the junction so it does not brake AI.
      g.debugTeleport(a.x + 45, a.z + 45, 0);
      g.debugFreeCamera = true;
      g.ui.show(null);
      g.camera.position.set(lane.bx - lane.ux * 12, 5.6, lane.bz - lane.uz * 12);
      g.camera.lookAt(lane.bx, 0.8, lane.bz);
      g.camera.fov = 55;
      g.camera.updateProjectionMatrix();
      let maxStep = 0, maxYaw = 0, changed = false;
      for (let i = 0; i < 150; i++) {
        const x = a.x, z = a.z, yaw = a.yaw;
        g.debugStepSim(1 / 30);
        maxStep = Math.max(maxStep, Math.hypot(a.x - x, a.z - z));
        maxYaw = Math.max(maxYaw, Math.abs(Math.atan2(Math.sin(a.yaw-yaw), Math.cos(a.yaw-yaw))));
        if (a.lane.id === toId) changed = true;
        if (changed && a.s > 5) break;
      }
      return { kind, fromId, toId, lane: a.lane.id, changed, maxStep, maxYaw };
    }, [kind, fromId, toId]);
    results.push(result);
    await page.screenshot({ path: path.join(root, 'artifacts', `turn-${kind}.png`) });
  }
  if (results.some((r) => !r.changed || r.maxStep > 0.9 || r.maxYaw > 0.13) || errors.length) throw new Error(JSON.stringify({ results, errors }));
  console.log('PASS rendered NPC car and bus junction fixtures', JSON.stringify(results));
} finally { await teardownHarness(browser, server); }
