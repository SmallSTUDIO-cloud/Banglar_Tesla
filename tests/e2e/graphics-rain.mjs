/* Browser fixture for weather transitions and fixed wheel-splash resources.
 * Not a real Android GPU test or a completed mission/race. */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { ensureChromiumEnv, teardownHarness } from './chromium-env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = 4230;
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
  const read = () => page.evaluate(() => {
    const g = window.__banglarTesla;
    return { weather: g.env.getWeather(), wetness: g.env.wetness,
      rainDrops: g.env.activeRainDrops, splashes: g.wheelSplashes.activeCount,
      poolChildren: g.wheelSplashes.group.children.length,
      visiblePuddleChunks: g.city.group.children.filter((o) => o.name.startsWith('roads.puddles') && o.visible).length,
      screenDrops: document.querySelectorAll('.rain-drop.on').length,
      rainOpacity: getComputedStyle(g.ui.root).getPropertyValue('--rain-opacity').trim(),
      geometries: g.renderer.info.memory.geometries, textures: g.renderer.info.memory.textures };
  });
  await page.evaluate(() => {
    const g = window.__banglarTesla;
    g.debugStartMode('free');
    g.settings.set({ weatherPreference: 'rain', rainMode: 'dynamic' });
    g.applySettings();
    const lane = g.traffic.graph.lanes.find((l) => l.segmentId === 'asad_2' && l.id.endsWith('fwd'));
    if (!lane) throw new Error('missing authored Asad road lane');
    g.debugTeleport(lane.ax + lane.ux * lane.length * 0.28,
      lane.az + lane.uz * lane.length * 0.28, lane.yaw);
    g.controller.speed = 6;
    g.debugInput = { throttle: 1, brake: 0, steer: 0 };
    g.debugStepSim(4);
    g.debugInput = null;
  });
  const rainy = await read();
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'artifacts', 'rain-dynamic-driving.png') });
  const storm = await page.evaluate(() => {
    const g = window.__banglarTesla;
    g.settings.set({ weatherPreference: 'storm' });
    g.applySettings();
    g.env.strike(0.8, true);
    const result = { weather: g.env.getWeather(), wind: g.env.getWindStrength(),
      lightning: g.env.lightningLevel, sun: g.env.sun.intensity,
      rainDrops: g.env.activeRainDrops };
    return result;
  });
  await page.screenshot({ path: path.join(root, 'artifacts', 'rain-storm-flash.png') });
  await page.evaluate(() => {
    const g = window.__banglarTesla;
    g.settings.set({ weatherPreference: 'sunny' });
    g.applySettings();
    g.debugStepSim(7);
  });
  const clear = await read();
  await page.screenshot({ path: path.join(root, 'artifacts', 'rain-cleared.png') });
  if (!(rainy.rainDrops > 100 && rainy.splashes > 0 && rainy.poolChildren === 1 && rainy.visiblePuddleChunks > 0 && rainy.screenDrops === 10 && clear.rainDrops === 0 && clear.visiblePuddleChunks === 0 && clear.screenDrops === 0 && clear.splashes === 0 && clear.wetness < rainy.wetness && clear.geometries <= rainy.geometries + 8 && rainy.textures === clear.textures) || errors.length) {
    throw new Error(JSON.stringify({ rainy, storm, clear, errors }));
  }
  console.log('PASS dynamic rain/wheel spray fade and stable browser resources', JSON.stringify({ rainy, storm, clear }));
} finally { await teardownHarness(browser, server); }
