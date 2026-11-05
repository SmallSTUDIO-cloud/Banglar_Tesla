/* Browser night-window regression; SwiftShader is not Android GPU evidence. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { ensureChromiumEnv, teardownHarness } from './chromium-env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = 4281;
const server = spawn(path.join(root, 'node_modules/.bin/vite'),
  ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}`)).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  if (!ready) throw Error('Run npm run build first');
  browser = await puppeteer.launch({
    args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
    executablePath: await chromium.executablePath(), headless: 'shell', env: ensureChromiumEnv(),
    defaultViewport: { width: 960, height: 540, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('!!window.__banglarTesla');
  const result = await page.evaluate(() => {
    const g = window.__banglarTesla;
    g.state.markTutorialDone(); g.debugStartMode('free'); g.stop();
    g.debugFreeCamera = true; g.ui.show(null); g.peds.group.visible = false;
    g.traffic.debugSetSimulationFrozen(true);
    for (const a of g.traffic.agents) a.visible = false;
    g.traffic.fleet.sync(g.traffic.agents);
    g.camera.position.set(42, 2.5, 112); g.camera.lookAt(55, 1.6, 95);
    g.camera.fov = 58; g.camera.updateProjectionMatrix();
    const group = g.city.group.getObjectByName('night-glow');
    const panes = group.children.filter(o => /^(?:sec\.\d+\.windowLights|lights\.district\.\d+)$/.test(o.name));
    const snapshot = (hour) => {
      g.debugSetTimeForTest(hour, 0); g.debugStepSim(1);
      g.renderer.render(g.scene, g.camera);
      return { hour, night: g.env.nightFactor, visible: group.visible,
        opacity: panes[0]?.material.opacity, calls: g.renderer.info.render.calls,
        geoms: g.renderer.info.memory.geometries, textures: g.renderer.info.memory.textures,
        glError: g.renderer.getContext().getError() };
    };
    const day = snapshot(12), dusk = snapshot(19), night = snapshot(0), dawn = snapshot(12);
    return { paneSectors: panes.length, paneTriangles: panes.reduce((n, o) => n + o.geometry.index.count / 3, 0),
      day, dusk, night, dawn };
  });
  const { day, dusk, night, dawn, paneSectors } = result;
  if (paneSectors < 4 || paneSectors > 16 || result.paneTriangles <= 0 ||
    day.night !== 0 || day.visible || day.opacity !== 0 ||
    !(dusk.night > 0 && dusk.opacity > 0 && dusk.opacity < night.opacity) ||
    night.night < 0.99 || !night.visible || Math.abs(night.opacity - 0.88) > 0.01 ||
    dawn.visible || dawn.opacity !== 0 ||
    !(night.calls > day.calls && night.calls - day.calls <= 20) ||
    [dusk, night, dawn].some(s => s.geoms !== day.geoms || s.textures !== day.textures || s.glError) || errors.length) {
    throw Error(JSON.stringify({ result, errors }));
  }
  console.log('PASS day → dusk → midnight → day occupied-window transition, stable GPU objects', JSON.stringify(result));
} finally { await teardownHarness(browser, server); }
