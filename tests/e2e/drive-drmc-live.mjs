/* Actual keyboard-driven free-ride navigation from a western district to the
 * DRMC public road approach, with normal Game physics, no in-drive teleport. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { ensureChromiumEnv, teardownHarness } from './chromium-env.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = 4234;
const server = spawn(path.join(root, 'node_modules/.bin/vite'), ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
let browser;
try {
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  browser = await puppeteer.launch({ args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'], executablePath: await chromium.executablePath(), headless: 'shell', env: ensureChromiumEnv(), defaultViewport: { width: 960, height: 540 } });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('!!window.__banglarTesla');
  const result = await page.evaluate(() => {
    const g = window.__banglarTesla;
    g.state.markTutorialDone(); g.debugStartMode('free'); g.stop();
    g.eventDirector.clearAll();
    g.debugTeleport(-126, -136, Math.PI / 2);
    const nav = document.querySelector('#hud-drmc-nav');
    nav.click();
    const route = g.activeRoute.points.map(({ x, z }) => ({ x, z }));
    const destination = route.at(-1);
    const data = { start: { x: g.controller.x, z: g.controller.z }, destination, route, initialNav: g.drmcNavigation, initialButton: nav.getAttribute('aria-pressed'), traveled: 0, minDistance: 10000, recoveries: 0, hits: 0, trace: [] };
    let waypointIndex = 1, pressed = '', braking = false;
    const changeKey = (code) => {
      if (code === pressed) return;
      if (pressed) window.dispatchEvent(new KeyboardEvent('keyup', { code: pressed, bubbles: true }));
      pressed = code;
      if (code) window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
    };
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
    let stalled = 0;
    for (let n = 0; n < 1600 && g.drmcNavigation; n++) {
      const px = g.controller.x, pz = g.controller.z;
      while (waypointIndex < route.length - 1 && Math.hypot(px - route[waypointIndex].x, pz - route[waypointIndex].z) < 5) waypointIndex++;
      if (waypointIndex < route.length - 1) {
        const here = Math.hypot(px - route[waypointIndex].x, pz - route[waypointIndex].z);
        const next = Math.hypot(px - route[waypointIndex + 1].x, pz - route[waypointIndex + 1].z);
        if (next + 6 < here && next < 15) waypointIndex++;
      }
      const target = route[waypointIndex];
      const want = Math.atan2(target.x - px, target.z - pz);
      const error = Math.atan2(Math.sin(want - g.controller.yaw), Math.cos(want - g.controller.yaw));
      changeKey(error > 0.04 ? 'KeyA' : error < -0.04 ? 'KeyD' : '');
      const next = route[Math.min(waypointIndex + 1, route.length - 1)];
      const cornerYaw = Math.atan2(next.x - target.x, next.z - target.z);
      const turn = Math.abs(Math.atan2(Math.sin(cornerYaw - want), Math.cos(cornerYaw - want)));
      const toTurn = Math.hypot(px - target.x, pz - target.z);
      const shouldBrake = (toTurn < 15 && turn > 0.32 && g.controller.speed > 3.5) || (Math.abs(error) > 0.6 && g.controller.speed > 3.5);
      if (shouldBrake !== braking) {
        braking = shouldBrake;
        window.dispatchEvent(new KeyboardEvent(braking ? 'keydown' : 'keyup', { code: 'KeyS', bubbles: true }));
      }
      for (let j = 0; j < 6 && g.drmcNavigation; j++) g.debugStepSim(0.016667);
      const moved = Math.hypot(px - g.controller.x, pz - g.controller.z);
      data.traveled += moved;
      data.hits = Math.max(data.hits, g.controller.hits);
      data.minDistance = Math.min(data.minDistance, Math.hypot(destination.x - g.controller.x, destination.z - g.controller.z));
      stalled = moved < 0.05 ? stalled + 1 : 0;
      if (stalled > 45) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', bubbles: true }));
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyR', bubbles: true }));
        data.recoveries++; stalled = 0;
      }
      if (n % 100 === 0) data.trace.push({ x: +px.toFixed(1), z: +pz.toFixed(1), wp: waypointIndex, speed: +g.controller.speed.toFixed(1), dist: +data.minDistance.toFixed(1) });
    }
    changeKey('');
    if (braking) window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyS', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }));
    g.debugStepSim(0.12); // allow the ordinary HUD cadence to show the cleared destination
    g.render();
    return { ...data, arrived: !g.drmcNavigation, final: { x: g.controller.x, z: g.controller.z }, clearedRoute: g.activeRoute === null, button: nav.getAttribute('aria-pressed') };
  });
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'artifacts', 'drive-drmc-result.json'), JSON.stringify({ ...result, errors }, null, 2));
  await page.screenshot({ path: path.join(root, 'artifacts', 'drive-drmc-arrival.png') });
  if (!result.initialNav || result.initialButton !== 'true' || !result.arrived || result.button !== 'false' || !result.clearedRoute || result.minDistance >= 8 || result.traveled < 60 || errors.length) throw new Error(JSON.stringify({ ...result, errors }));
  console.log('PASS live keyboard-driven DRMC destination', JSON.stringify(result));
} finally { await teardownHarness(browser, server); }
