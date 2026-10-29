/** Close-up visual QA fixtures, not evidence of a naturally driven race. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { ensureChromiumEnv, teardownHarness } from './chromium-env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'artifacts/vnext-player-rival-review');
const port = 4205, base = `http://127.0.0.1:${port}`;
fs.mkdirSync(out, { recursive: true });
const server = spawn(path.join(root, 'node_modules/.bin/vite'), ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
const start = Date.now();
while (true) {
  try { if ((await fetch(base)).ok) break; } catch {}
  if (Date.now() - start > 30000) { server.kill(); throw new Error('preview did not start'); }
  await new Promise((r) => setTimeout(r, 250));
}
let browser;
try {
  browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], executablePath: await chromium.executablePath(), headless: 'shell', env: ensureChromiumEnv(), defaultViewport: { width: 960, height: 720, deviceScaleFactor: 1 } });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('PAGEERROR', e.message));
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction('Boolean(window.__banglarTesla)', { timeout: 60000 });
  await page.evaluate(() => {
    const g = window.__banglarTesla;
    g.state.markTutorialDone(); g.debugStartMode('duty');
    g.debugAcceptOffer(); g.debugTeleportToPickup();
    if (!g.debugStepUntil(() => g.missions.state === 'toDropoff', 16)) throw new Error('Passenger did not board');
    g.debugTeleport(42, 106, 0);
    g.debugSetQuality('pc_high'); g.debugSetPhase('golden', 'sunny');
    g.ui.show(null); g.debugFreeCamera = true;
    g.renderer.setAnimationLoop(null);
    g.traffic.group.visible = false; g.peds.group.visible = false;
  });
  async function save(name, fn, options) {
    const data = await page.evaluate(fn, options);
    fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(data.split(',')[1], 'base64'));
  }
  const poses = [-0.55, 0, 0.55];
  const views = [['front', 0], ['quarter', 0.85], ['side', Math.PI / 2]];
  for (const steer of poses) for (const [view, angle] of views) {
    await save(`player-passenger-${steer}-${view}`, ({ steer, angle }) => {
      const g = window.__banglarTesla, v = g.player;
      v.root.rotation.set(0, 0, 0);
      v.rig.applyDynamics({ steerAngle: steer, wheelSpin: 0.3, pedalPhase: 0.6, roll: 0, pitch: 0, nightFactor: 0 });
      const p = v.root.position;
      g.camera.position.set(p.x + Math.sin(angle) * 4.0, p.y + 1.5, p.z + 0.1 + Math.cos(angle) * 4.0);
      g.camera.lookAt(p.x, p.y + 1.25, p.z + 0.1);
      g.camera.fov = 31; g.camera.updateProjectionMatrix();
      g.renderer.render(g.scene, g.camera);
      return g.renderer.domElement.toDataURL('image/png');
    }, { steer, angle });
  }
  // Low external views look through the open side of the canopy at the
  // passenger; no vehicle parts are hidden or clipped by the fixture.
  for (const [view, x, z] of [['front-quarter', 2.6, 1.3], ['side', 2.8, -0.74], ['opposite', -2.8, -0.35]]) {
    await save(`passenger-${view}`, ({ x, z }) => {
      const g = window.__banglarTesla, p = g.player.root.position;
      g.camera.position.set(p.x + x, p.y + 0.9, p.z + z);
      g.camera.lookAt(p.x, p.y + 1.2, p.z - 0.64);
      g.camera.fov = 30; g.camera.updateProjectionMatrix();
      g.renderer.render(g.scene, g.camera);
      return g.renderer.domElement.toDataURL('image/png');
    }, { x, z });
  }
  await page.evaluate(() => {
    const g = window.__banglarTesla;
    g.startRivalEvent('ev_duel_ring');
    g.ui.show(null); g.debugFreeCamera = true;
    g.renderer.setAnimationLoop(null);
    g.traffic.group.visible = false; g.peds.group.visible = false; g.player.root.visible = false;
    const racers = g.raceSystem.aiRacers;
    for (let i = 0; i < racers.length; i++) {
      racers[i].visual.root.position.set(i === 0 ? 42 : 150 + i * 20, g.city.heightAt(42, 106), 106);
      racers[i].visual.root.rotation.set(0, 0, 0);
    }
  });
  for (const steer of poses) for (const [view, angle] of views) for (const mode of ['batched', 'source']) {
    await save(`rival-${mode}-${steer}-${view}`, ({ steer, angle, mode }) => {
      const g = window.__banglarTesla, race = g.raceSystem;
      const batch = race.rivalBatch;
      for (const b of batch.batches) {
        b.mesh.visible = mode === 'batched';
        for (const source of b.sources) source.mesh.visible = mode === 'source';
      }
      const v = race.aiRacers[0].visual;
      v.rig.applyDynamics({ steerAngle: steer, wheelSpin: 0.3, pedalPhase: 0.6, roll: 0, pitch: 0, nightFactor: 0 });
      const p = v.root.position;
      g.camera.position.set(p.x + Math.sin(angle) * 4.0, p.y + 1.5, p.z + 0.1 + Math.cos(angle) * 4.0);
      g.camera.lookAt(p.x, p.y + 1.25, p.z + 0.1);
      g.camera.fov = 31; g.camera.updateProjectionMatrix();
      g.renderer.render(g.scene, g.camera);
      return g.renderer.domElement.toDataURL('image/png');
    }, { steer, angle, mode });
  }
  console.log('Saved 9 player, 3 passenger and 18 source/batched rival close-ups to', out);
} finally {
  if (browser) await teardownHarness(browser, server); else server.kill('SIGTERM');
}
