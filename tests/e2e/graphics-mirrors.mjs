/* Real rendered world mirrors; no teleport race progression. Browser fixture positions
 * a traffic agent behind the player solely to confirm dynamic target content. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { ensureChromiumEnv, teardownHarness } from './chromium-env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = 4218;
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
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('!!window.__banglarTesla');
  await page.evaluate(() => {
    const g = window.__banglarTesla;
    g.debugStartMode('free');
    g.setCameraMode('cockpit');
    const x = g.controller.x - Math.sin(g.controller.yaw) * 8;
    const z = g.controller.z - Math.cos(g.controller.yaw) * 8;
    g.traffic.debugPositionAgentForTest('car', x, z, g.controller.yaw, 0);
  });
  await new Promise((r) => setTimeout(r, 1700));
  const cockpit = await page.evaluate(() => ({ renders: window.__banglarTesla.debugSnapshot().mirrorRenders, geometries: window.__banglarTesla.renderer.info.memory.geometries, textures: window.__banglarTesla.renderer.info.memory.textures }));
  await page.screenshot({ path: path.join(root, 'artifacts', 'v2-driver-mirrors.png') });
  await page.evaluate(() => window.__banglarTesla.setCameraMode('chase'));
  const countAfterSwitch = await page.evaluate(() => window.__banglarTesla.debugSnapshot().mirrorRenders);
  await new Promise((r) => setTimeout(r, 1000));
  const chase = await page.evaluate(() => ({ renders: window.__banglarTesla.debugSnapshot().mirrorRenders, geometries: window.__banglarTesla.renderer.info.memory.geometries, textures: window.__banglarTesla.renderer.info.memory.textures }));
  if (cockpit.renders < 2 || chase.renders !== countAfterSwitch || chase.geometries !== cockpit.geometries || chase.textures !== cockpit.textures || errors.length) throw new Error(JSON.stringify({ cockpit, chase, errors }));
  console.log('PASS cockpit mirrored world renders; chase has zero mirror updates and stable resources', JSON.stringify({ cockpit, chase }));
} finally { await teardownHarness(browser, server); }
