/* Fixed street view / render-budget fixture for the static graphic pass. */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { ensureChromiumEnv, teardownHarness } from './chromium-env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = 4250;
const server = spawn(path.join(root, 'node_modules/.bin/vite'),
  ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}`)).ok) { ready = true; break; } } catch { /* starting */ }
    await new Promise(r => setTimeout(r, 150));
  }
  if (!ready) throw Error('preview did not start');
  browser = await puppeteer.launch({ args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'], executablePath: await chromium.executablePath(), headless: 'shell', env: ensureChromiumEnv(), defaultViewport: { width: 1280, height: 720 } });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('!!window.__banglarTesla');
  await page.evaluate(() => document.fonts.ready);
  const result = await page.evaluate(() => {
    const g = window.__banglarTesla;
    g.state.markTutorialDone(); g.debugStartMode('free');
    g.debugSetTimeForTest(9, 49); g.settings.set({ weatherPreference: 'sunny' }); g.applySettings();
    g.renderer.setAnimationLoop(null); g.debugFreeCamera = true;
    g.debugTeleport(-28, 82, -2.87);
    g.traffic.debugSetSimulationFrozen(true);
    g.peds.update(1 / 30, -28, 82, 0, -2.87);
    g.camera.position.set(-24, 3.1, 91);
    g.camera.lookAt(-35, 1.6, 48);
    g.camera.fov = 64; g.camera.updateProjectionMatrix();
    g.renderer.render(g.scene, g.camera);
    const info = g.renderer.info;
    return { calls: info.render.calls, triangles: info.render.triangles, textures: info.memory.textures,
      treeCount: g.city.treeCount, poleCount: g.city.utilityPoleSites.length,
      buildingCount: g.city.colliders.filter(c => c.kind === 'building').length };
  });
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  // Put the capture camera on the pavement rather than behind the player's
  // rickshaw canopy; preserve the original fixed-view renderer budget above.
  const tea = await page.evaluate(() => {
    const g = window.__banglarTesla;
    const stalls = [...g.destruction.props.values()].filter(p => p.kind === 'tea');
    const stall = stalls.sort((a, b) =>
      (a.x + 28) ** 2 + (a.z - 82) ** 2 - ((b.x + 28) ** 2 + (b.z - 82) ** 2))[0];
    g.camera.position.set(-24, 5.5, 91);
    g.camera.lookAt(-35, 1.6, 48);
    g.renderer.render(g.scene, g.camera);
    return stall && { x: stall.x, z: stall.z, yaw: stall.yaw, total: stalls.length };
  });
  await page.screenshot({ path: path.join(root, 'artifacts', 'graphic-upgrade-street.png') });
  if (tea) {
    await page.evaluate(({ x, z, yaw }) => {
      const g = window.__banglarTesla;
      const s = Math.sin(yaw), c = Math.cos(yaw);
      g.camera.position.set(x + 3.70 * s - 1.3 * c, 1.92, z + 3.70 * c + 1.3 * s);
      g.camera.lookAt(x + .50 * s, 1.40, z + .50 * c);
      g.renderer.render(g.scene, g.camera);
    }, tea);
    await page.screenshot({ path: path.join(root, 'artifacts', 'graphic-upgrade-tea.png') });
  }
  // The new hanging sign, bench and drinkers must all be part of the same
  // breakable stall. Test the actual merged vertex slices, not just its flag.
  const teaBreak = await page.evaluate((teaSite) => {
    const d = window.__banglarTesla.destruction;
    const stall = [...d.props.values()].find(p => p.kind === 'tea' &&
      p.x === teaSite?.x && p.z === teaSite?.z);
    if (!stall) return null;
    const active = () => stall.slices.reduce((total, slice) => {
      const a = slice.mesh.geometry.getAttribute('position').array;
      const begin = slice.startVertex * 3, end = begin + slice.vertexCount * 3;
      for (let i = begin; i < end; i++) if (a[i] !== 0) total++;
      return total;
    }, 0);
    const signTagged = stall.slices.some(s => s.mesh.name.startsWith('props.signs'));
    const before = active();
    const hit = d.tryBreak(stall.id, 5, stall.x + 2, stall.z, stall.yaw);
    const hidden = active() === 0 && stall.collider.disabled && stall.vendorSpot?.broken;
    d.resetAll();
    return { hit, hidden, restored: active() === before && !stall.collider.disabled &&
      !stall.vendorSpot?.broken, signTagged, before };
  }, tea);
  if (errors.length || result.treeCount < 50 || result.poleCount < 50 ||
      result.calls > 240 || !teaBreak?.hit || !teaBreak.hidden || !teaBreak.restored ||
      !teaBreak.signTagged || teaBreak.before < 100) {
    throw Error(JSON.stringify({ result, teaBreak, errors }));
  }
  console.log('PASS fixed street render and tea-stall break/restore',
    JSON.stringify({ ...result, teaStalls: tea.total, teaBreak }));
} finally { await teardownHarness(browser, server); }
