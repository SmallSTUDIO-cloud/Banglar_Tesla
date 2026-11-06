import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { ensureChromiumEnv, teardownHarness } from './chromium-env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = 4208;
const base = `http://127.0.0.1:${port}${process.env.GITHUB_PAGES === 'true' ? '/Banglar_Tesla/' : '/'}`;
const server = spawn(path.join(root, 'node_modules/.bin/vite'),
  ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { cwd: root, stdio: 'ignore' });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(base)).ok) { ready = true; break; } } catch { /* boot */ }
    await new Promise(r => setTimeout(r, 250));
  }
  if (!ready) throw new Error('Preview did not start');
  browser = await puppeteer.launch({
    args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--no-sandbox'],
    executablePath: await chromium.executablePath(), headless: 'shell',
    env: ensureChromiumEnv(), defaultViewport: { width: 915, height: 412 },
  });
  const page = await browser.newPage();
  const failures = [];
  page.on('pageerror', e => failures.push(e.message));
  page.on('requestfailed', req => failures.push(req.url()));
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction('!!window.__banglarTesla', { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  const data = await page.evaluate(async () => {
    const g = window.__banglarTesla;
    g.debugStartMode('free');
    // Inspect resident assets and merged world geometry, not source strings.
    await new Promise(r => setTimeout(r, 1100));
    const meshes = [];
    g.city.group.traverse(obj => { if (obj.isMesh) meshes.push(obj); });
    const photos = meshes.filter(m => m.name.startsWith('education.district.'));
    const packets = meshes.filter(m => m.name.startsWith('snacks.district.'));
    const tex = photos[0]?.material.map;
    const loaded = tex?.image?.width === 1024 && tex.image.height === 2048;
    // Compare the old full-array camera query with the new spatial candidate
    // query in the SAME software-browser process. This is CPU query time,
    // never a claim of real-phone FPS/GPU throughput.
    const points = Array.from({ length: 4000 }, (_, i) => [
      g.controller.x + ((i * 11) % 130) / 10 - 6.5,
      g.controller.z + ((i * 17) % 130) / 10 - 6.5,
    ]);
    const oldPointBlocked = (x, z) => g.city.colliders.some(c => {
      if (c.disabled || c.height < 1.85 ||
        x <= c.minX - .46 || x >= c.maxX + .46 ||
        z <= c.minZ - .46 || z >= c.maxZ + .46) return false;
      if (c.cx !== undefined && c.cz !== undefined) {
        const cy = Math.cos(c.yaw ?? 0), sy = Math.sin(c.yaw ?? 0);
        const wx = x - c.cx, wz = z - c.cz;
        if (Math.abs(wx * cy - wz * sy) >= c.halfX + .46 ||
            Math.abs(wx * sy + wz * cy) >= c.halfZ + .46) return false;
      }
      return true;
    });
    const sample = (fn) => {
      const t = performance.now(); let hits = 0;
      for (const [x, z] of points) if (fn(x, z)) hits++;
      return { ms: +(performance.now() - t).toFixed(2), hits };
    };
    // JIT warmup is the same workload on both sides.
    sample((x, z) => oldPointBlocked(x, z));
    sample((x, z) => g.chase.pointBlocked(x, 2, z, g.city.colliders, .46));
    const oldScan = sample((x, z) => oldPointBlocked(x, z));
    const indexed = sample((x, z) => g.chase.pointBlocked(x, 2, z, g.city.colliders, .46));
    return {
      infill: g.city.infillCount, courtyards: g.city.courtyardCount,
      interiors: g.city.interiorCount, grocery: g.city.groceryCount,
      educationPosters: g.city.educationPosterCount,
      photoBatches: photos.length, snackBatches: packets.length,
      photoLoaded: loaded, photoUrl: tex?.image?.src ?? '',
      photoTriangles: photos.reduce((n, m) => n + m.geometry.index.count / 3, 0),
      packets: packets.reduce((n, m) => n + m.geometry.index.count / 6, 0),
      calls: g.renderer.info.render.calls,
      cameraQueryCpu: { oldScan, indexed },
      colliders: g.city.colliders.length,
      cameraCellCandidates: g.chase.cameraCells.get(g.chase.cameraCellKey(
        Math.floor(g.controller.x / 16), Math.floor(g.controller.z / 16)))?.length ?? 0,
    };
  });
  if (data.infill < 65 || data.grocery < 20 || data.educationPosters < 10 ||
    !data.photoLoaded || data.photoBatches > 4 || data.snackBatches > 4 ||
    data.packets < data.grocery * 9 || data.calls > 195 ||
    data.cameraQueryCpu.oldScan.hits !== data.cameraQueryCpu.indexed.hits ||
    (process.env.GITHUB_PAGES === 'true' &&
      !data.photoUrl.includes('/Banglar_Tesla/posters/')) || failures.length) {
    throw new Error(JSON.stringify({ data, failures }));
  }
  console.log('PASS street density, supplied posters, batched grocery packets:', data);
} finally {
  await teardownHarness(browser, server);
}
