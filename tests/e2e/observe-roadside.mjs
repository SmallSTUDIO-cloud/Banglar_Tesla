/** Observational free-roam smoke: no teleports, forced rolls, or injected caller.
 * It advances normal game updates faster than wall time; it is not a human playtest. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { ensureChromiumEnv, teardownHarness } from './chromium-env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = path.join(root, 'artifacts/roadside-observation');
fs.mkdirSync(dir, { recursive: true });
const port = 4206, base = `http://127.0.0.1:${port}`;
const server = spawn(path.join(root, 'node_modules/.bin/vite'), ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
const deadline = Date.now() + 30000;
while (true) {
  try { if ((await fetch(base)).ok) break; } catch {}
  if (Date.now() > deadline) { server.kill(); throw new Error('preview failed to start'); }
  await new Promise((r) => setTimeout(r, 250));
}
let browser;
try {
  browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'], executablePath: await chromium.executablePath(), headless: 'shell', env: ensureChromiumEnv(), defaultViewport: { width: 960, height: 720, deviceScaleFactor: 1 } });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction('Boolean(window.__banglarTesla)', { timeout: 60000 });
  const result = await page.evaluate(async () => {
    const g = window.__banglarTesla;
    g.state.markTutorialDone(); g.debugStartMode('free');
    g.renderer.setAnimationLoop(null);
    await g.audio.init();
    const start = { x: g.controller.x, z: g.controller.z, time: g.simClockSec };
    const found = g.debugStepUntil(() => !!g.roadsideRequest, 240);
    const req = g.roadsideRequest;
    const snapshot = g.debugSnapshot();
    g.renderer.render(g.scene, g.camera);
    return { found, elapsed: g.simClockSec-start.time, start, end:{x:g.controller.x,z:g.controller.z},
      pedestrianId:req?.pedestrianId, stop:req?.stop, crowdReserved:req ? g.peds.peds[req.pedestrianId].roadsideReserved : false,
      speechText:snapshot.speechLastText, speechBackend:snapshot.speechBackend, audioUnlocked:snapshot.audioUnlocked,
      policeState:snapshot.policeState, activeDirectorEvents:snapshot.activeDirectorEvents,
      screen:snapshot.screen, paused:snapshot.paused };
  });
  await page.screenshot({ path: path.join(dir, 'unforced-call.png') });
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ ...result, errors }, null, 2));
  console.log(JSON.stringify({ ...result, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  if (browser) await teardownHarness(browser, server); else server.kill('SIGTERM');
}
