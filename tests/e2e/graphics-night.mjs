/* Browser time sweep with actual game scene. Fixture time changes are explicit
 * overrides, not a claim that a human waited through the full 24h cycle. */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { ensureChromiumEnv, teardownHarness } from './chromium-env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = 4229;
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
  const samples = [];
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  for (const [hour, minute] of [[17,30],[18,15],[19,0],[20,15],[23,50],[0,10],[3,0],[5,30],[6,30],[6,50],[7,10],[7,30]]) {
    await page.evaluate(([h, m]) => window.__banglarTesla.debugSetTimeForTest(h, m), [hour, minute]);
    await page.evaluate(() => window.__banglarTesla.debugStepSim(1 / 60));
    const sample = await page.evaluate(() => {
      const g = window.__banglarTesla;
      const glow = g.city.group.getObjectByName('night-glow');
      return { clock: g.gameTime.formatted, night: g.env.nightFactor,
        glow: glow?.children[0]?.material?.opacity, visible: glow?.visible,
        headlamp: g.player.rig.headlampLight?.intensity ?? 0,
        traffic: g.traffic.agents.length, peds: g.peds.activeCount };
    });
    samples.push(sample);
    if ((hour === 17 && minute === 30) || (hour === 20 && minute === 15) || (hour === 6 && minute === 30)) {
      await page.screenshot({ path: path.join(root, 'artifacts', `night-${hour}-${minute}.png`) });
    }
  }
  for (const i of [0, 1, 2, 3, 7, 8, 9]) {
    if (Math.abs(samples[i].night - samples[i].glow) > 0.02 || Math.abs(samples[i].headlamp / 2.3 - samples[i].night) > 0.12) {
      throw new Error(`world or vehicle light snapped at ${i}: ${JSON.stringify(samples[i])}`);
    }
  }
  if (!(samples[0].night < samples[1].night && samples[1].night < samples[2].night && samples[2].night < samples[3].night && samples[7].night > samples[8].night && samples[8].night > samples[9].night) || errors.length) {
    throw new Error(JSON.stringify({ samples, errors }));
  }
  console.log('PASS browser dusk/midnight/dawn lighting sweep', JSON.stringify(samples));
} finally { await teardownHarness(browser, server); }
