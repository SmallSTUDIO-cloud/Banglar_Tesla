/* Final tree placement and rendering checks; browser/SwiftShader, not phone FPS. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { ensureChromiumEnv, teardownHarness } from './chromium-env.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = 4284;
const server = spawn(path.join(root, 'node_modules/.bin/vite'),
  ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { cwd: root, stdio: 'ignore' });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}`)).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  if (!ready) throw Error('Build the game first');
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
    const g = window.__banglarTesla, city = g.city;
    // Check the actual collision OBB, not just a too-large rotated AABB.
    const building = city.colliders.filter(c => c.kind === 'building' && c.cx !== undefined);
    const clipped = city.treeSites.filter(site => building.some(c => {
      const dx = site.x - c.cx, dz = site.z - c.cz;
      if (Math.abs(dx) > Math.max(c.maxX - c.minX, 1) || Math.abs(dz) > Math.max(c.maxZ - c.minZ, 1)) return false;
      const co = Math.cos(c.yaw), si = Math.sin(c.yaw);
      return Math.abs(dx * co - dz * si) < c.halfX + 0.18 &&
        Math.abs(dx * si + dz * co) < c.halfZ + 0.18;
    }));
    const forestObjects = [];
    city.group.traverse(o => { if (/(?:^|\.)tree(?:\.|$)/i.test(o.name)) forestObjects.push(o.name); });
    g.state.markTutorialDone(); g.debugStartMode('free'); g.stop();
    g.camera.position.set(55, 2.65, 104); g.camera.lookAt(63.2, 3.5, 91.7);
    g.camera.fov = 48; g.camera.updateProjectionMatrix();
    g.renderer.render(g.scene, g.camera);
    return { trees: city.treeCount, clipped, separateTreeObjects: forestObjects,
      calls: g.renderer.info.render.calls, triangles: g.renderer.info.render.triangles,
      glError: g.renderer.getContext().getError() };
  });
  if (result.trees < 12 || result.trees > 180 || result.clipped.length ||
    result.separateTreeObjects.length || result.glError || errors.length) {
    throw Error(JSON.stringify({ result, errors }));
  }
  console.log('PASS sector-batched trees, no building/trunk overlap or GL errors', JSON.stringify(result));
} finally { await teardownHarness(browser, server); }
