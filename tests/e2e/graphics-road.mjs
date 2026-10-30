/* Browser fixture: inspect generated road geometry and drive through an authored pothole.
 * Not evidence of human driving or physical-device frame rate. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { ensureChromiumEnv, teardownHarness } from './chromium-env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = 4219;
const server = spawn(path.join(root, 'node_modules/.bin/vite'), ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
let browser;
try {
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}`)).ok) break; } catch { /* boot */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  browser = await puppeteer.launch({ args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'], executablePath: await chromium.executablePath(), headless: 'shell', env: ensureChromiumEnv(), defaultViewport: { width: 915, height: 412 } });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('!!window.__banglarTesla');
  const result = await page.evaluate(() => {
    const g = window.__banglarTesla;
    const holes = g.city.potholes;
    const badHole = holes.find((p) => !(p.depth > 0 && g.city.potholeDepthAt(p.x, p.z) > 0));
    const near = holes[0];
    g.debugStartMode('free');
    g.setCameraMode('chase');
    // Fixture positioning is not a completed race. It only probes a road contact.
    g.controller.reset(near.x, near.z - 2.5, 0);
    g.controller.speed = 6;
    g.debugHoldInput({ throttle: 0, brake: 0, steer: 0 }, 1300);
    return { potholes: holes.length, infill: g.city.infillCount, courtyard: g.city.courtyardCount, pocket: g.city.pocketPlazaCount, badHole: !!badHole,
      originDepth: g.city.potholeDepthAt(near.x, near.z),
      terrain: g.city.heightAt(near.x, near.z) };
  });
  await new Promise((r) => setTimeout(r, 1150));
  const driven = await page.evaluate(() => ({ speed: window.__banglarTesla.controller.speed,
    x: window.__banglarTesla.controller.x, z: window.__banglarTesla.controller.z,
    splashParticles: window.__banglarTesla.debugSnapshot().splashParticles }));
  await page.screenshot({ path: path.join(root, 'artifacts', 'v2-pothole-drive.png') });
  if (result.potholes < 4 || result.potholes > 8 || result.infill < 1 || result.badHole || errors.length) {
    throw new Error(JSON.stringify({ result, driven, errors }));
  }
  console.log('PASS browser pothole/city fixture', JSON.stringify({ result, driven }));
} finally { await teardownHarness(browser, server); }
