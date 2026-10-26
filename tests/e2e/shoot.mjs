/**
 * Visual inspection helper: boots the game, optionally runs an action list, and
 * writes screenshots. Used while iterating on art; not part of CI.
 *
 *   node tests/e2e/shoot.mjs menu,duty,hero
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'artifacts');
const PORT = 4191;
const BASE = `http://127.0.0.1:${PORT}`;
const shots = (process.argv[2] ?? 'menu').split(',');

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

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  cwd: root,
  stdio: 'ignore',
});
await waitFor(BASE);
const browser = await puppeteer.launch({
  args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  executablePath: await chromium.executablePath(),
  headless: 'shell',
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/tools/probe/libs/lib' },
  defaultViewport: process.env.PORTRAIT
    ? { width: 412, height: 892, deviceScaleFactor: 1, isMobile: true, hasTouch: true }
    : { width: 960, height: 540, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 400)));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300));
});
await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 120000 });
await page.waitForFunction('!!window.__banglarTesla', { timeout: 60000 });
await new Promise((r) => setTimeout(r, 1200));
fs.mkdirSync(out, { recursive: true });

for (const shot of shots) {
  if (shot === 'menu') {
    await new Promise((r) => setTimeout(r, 900));
    await page.screenshot({ path: path.join(out, process.env.PORTRAIT ? 'shot-menu-portrait.png' : 'shot-menu.png') });
  } else if (shot === 'hero') {
    await page.evaluate(() => window.__banglarTesla.debugHeroShot());
    await new Promise((r) => setTimeout(r, 700));
    await page.screenshot({ path: path.join(out, 'shot-hero.png') });
  } else if (shot === 'duty') {
    await page.evaluate(() => window.__banglarTesla.debugStartMode('duty'));
    await new Promise((r) => setTimeout(r, 500));
    await page.evaluate(() => window.__banglarTesla.debugAcceptOffer());
    await page.evaluate(() => window.__banglarTesla.debugHoldInput({ throttle: 1 }, 2200));
    await new Promise((r) => setTimeout(r, 2400));
    await page.screenshot({ path: path.join(out, process.env.PORTRAIT ? 'shot-duty-portrait.png' : 'shot-duty.png') });
  } else if (shot === 'chase') {
    await page.evaluate(() => window.__banglarTesla.debugStartMode('free'));
    await new Promise((r) => setTimeout(r, 600));
    await page.evaluate(() => window.__banglarTesla.debugTeleport(-1.5, 20, Math.PI));
    await page.evaluate(() => window.__banglarTesla.debugHoldInput({ throttle: 1 }, 2500));
    await new Promise((r) => setTimeout(r, 1400));
    await page.screenshot({ path: path.join(out, 'shot-chase.png') });
  } else if (shot === 'night') {
    await page.evaluate(() => window.__banglarTesla.debugStartMode('free'));
    await page.evaluate(() => window.__banglarTesla.debugSetPhase('night', 'clear'));
    await new Promise((r) => setTimeout(r, 1400));
    await page.screenshot({ path: path.join(out, 'shot-night.png') });
  } else if (shot === 'rain') {
    await page.evaluate(() => window.__banglarTesla.debugStartMode('free'));
    await page.evaluate(() => window.__banglarTesla.debugSetPhase('golden', 'rain'));
    await new Promise((r) => setTimeout(r, 2500));
    await page.screenshot({ path: path.join(out, 'shot-rain.png') });
  } else if (shot.startsWith('model')) {
    const angle = Number(shot.split(':')[1] ?? 0.9);
    await page.evaluate((a) => window.__banglarTesla.debugRickshawShot(a), angle);
    await new Promise((r) => setTimeout(r, 700));
    await page.screenshot({ path: path.join(out, `shot-model-${angle}.png`) });
  } else if (shot === 'rear') {
    await page.evaluate(() => window.__banglarTesla.debugStartMode('free'));
    await new Promise((r) => setTimeout(r, 600));
    await page.evaluate(() => window.__banglarTesla.debugRickshawShot(Math.PI, 3.2, 1.5, 40));
    await new Promise((r) => setTimeout(r, 600));
    await page.screenshot({ path: path.join(out, 'shot-rear.png') });
  } else if (shot === 'passenger') {
    await page.evaluate(() => {
      const g = window.__banglarTesla;
      g.debugStartMode('duty');
      g.debugAcceptOffer();
      g.debugTeleportToPickup();
      g.debugStepUntil(() => g.debugSnapshot().missionState === 'toDropoff', 16);
      g.debugRickshawShot(Math.PI * 0.72, 4.0, 1.75, 42);
    });
    await new Promise((r) => setTimeout(r, 900));
    await page.screenshot({ path: path.join(out, 'shot-passenger.png') });
  } else if (shot === 'garage') {
    await page.evaluate(() => window.__banglarTesla.debugOpenGarageForTest());
    await new Promise((r) => setTimeout(r, 1500));
    await page.screenshot({ path: path.join(out, process.env.PORTRAIT ? 'shot-garage-portrait.png' : 'shot-garage.png') });
  }
}
await browser.close();
server.kill('SIGTERM');
console.log('shots written to', out);
