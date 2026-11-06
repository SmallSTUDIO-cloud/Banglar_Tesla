/* Matched LIVE gameplay capture. Real fleet and pedestrians remain enabled;
 * only the player start/inputs and clock/weather are controlled. SwiftShader
 * browser evidence is not Android FPS. Refuses to replace earlier evidence. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { ensureChromiumEnv, teardownHarness } from './chromium-env.mjs';

const tag = process.argv.find(arg => arg.startsWith('--tag='))?.slice(6);
if (!['living-before', 'living-after'].includes(tag)) throw Error('Use --tag=living-before or --tag=living-after');
const root = path.resolve(import.meta.dirname, '../..');
const out = path.join(root, 'artifacts/living-mohammadpur', tag);
if (fs.existsSync(out)) throw Error(`Refusing to overwrite capture: ${out}`);
fs.mkdirSync(out, { recursive: true });
const port = 4291;
const server = spawn(path.join(root, 'node_modules/.bin/vite'),
  ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}`)).ok) { ready = true; break; } } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!ready) throw Error('Built preview did not start');
  browser = await puppeteer.launch({ args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--no-sandbox'], executablePath: await chromium.executablePath(),
  headless: 'shell', env: ensureChromiumEnv(), defaultViewport: { width: 960, height: 540, deviceScaleFactor: 1 } });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  const scenes = [
    { name: 'day-drive', hour: 12, weather: 'sunny', mode: 'drive' },
    { name: 'rain-drive', hour: 12, weather: 'rain', mode: 'drive' },
    { name: 'night-drive', hour: 0, weather: 'sunny', mode: 'drive' },
    { name: 'market-stop', hour: 12, weather: 'sunny', mode: 'market' },
    { name: 'wide-density', hour: 12, weather: 'sunny', mode: 'wide' },
  ];
  const results = [];
  for (const scene of scenes) {
    const bootAt = Date.now();
    await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction('!!window.__banglarTesla', { timeout: 90000 });
    const bootMs = Date.now() - bootAt;
    const result = await page.evaluate(s => {
      const g = window.__banglarTesla;
      g.state.markTutorialDone();
      g.settings.set({ quality: 'balanced', weatherPreference: s.weather });
      g.debugStartMode('free');
      g.stop(); // deterministic fixed-step Game.update; no competing RAF
      g.applySettings();
      g.debugSetTimeForTest(s.hour);
      g.env.setWeather(s.weather);
      let market = null;
      if (s.mode === 'market') {
        // Choose a REAL approved vendor and the nearest existing lane centre;
        // no vendor, vehicle or walker is staged for the photograph.
        const spots = g.vendorSpots.filter(v => !v.broken && (v.kind === 'tea' || v.kind === 'market'));
        spots.sort((a, b) => Math.hypot(a.x - 42, a.z - 106) - Math.hypot(b.x - 42, b.z - 106));
        const vendor = spots[0];
        if (!vendor) throw Error('No approved roadside vendor');
        const lane = g.traffic.graph.lanes.map(l => {
          const t = Math.max(0.15, Math.min(0.85, ((vendor.x-l.ax)*l.ux + (vendor.z-l.az)*l.uz)/l.length));
          return { l, x: l.ax + (l.bx-l.ax)*t, z: l.az + (l.bz-l.az)*t };
        }).sort((a,b) => Math.hypot(a.x-vendor.x,a.z-vendor.z)-Math.hypot(b.x-vendor.x,b.z-vendor.z))[0];
        g.debugTeleport(lane.x, lane.z, Math.atan2(vendor.x - lane.x, vendor.z - lane.z));
        market = { kind: vendor.kind, x: vendor.x, z: vendor.z,
          playerDistance: Math.hypot(vendor.x-lane.x, vendor.z-lane.z) };
      } else {
        g.debugTeleport(42, 106, Math.PI); // fixed on-road start, heading down the existing street
      }
      const start = { x: g.controller.x, z: g.controller.z };
      if (s.mode === 'drive') {
        g.debugInput = { throttle: 1, brake: 0, steer: 0 };
        g.debugStepSim(5);
        g.debugInput = null;
      } else {
        g.debugStepSim(7); // stopped at vendor, or normal ambient simulation for wide view
      }
      if (s.mode === 'wide') {
        g.debugFreeCamera = true;
        g.camera.position.set(g.controller.x, 23, g.controller.z + 29);
        g.camera.lookAt(g.controller.x, 1, g.controller.z - 20);
        g.camera.fov = 65;
        g.camera.updateProjectionMatrix();
      }
      const gl = g.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      const clip = (x, y, z) => {
        const v = g.tmpPlayerVec.set(x, y, z).project(g.camera);
        return Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z >= -1 && v.z <= 1;
      };
      g.camera.updateMatrixWorld(true);
      const byType = {}, nearbyByType = {};
      let vehicles = 0, pedestrians = 0, nearbyVehicles = 0, nearbyPedestrians = 0;
      for (const a of g.traffic.agents) {
        const d = Math.hypot(a.x-g.controller.x, a.z-g.controller.z);
        if (d < 65) { nearbyVehicles++; nearbyByType[a.kind] = (nearbyByType[a.kind] || 0) + 1; }
        if (a.visible && clip(a.x, a.y + 1, a.z)) { vehicles++; byType[a.kind] = (byType[a.kind] || 0) + 1; }
      }
      for (let i = 0; i < g.peds.activeCount; i++) {
        const p = g.peds.peds[i];
        if (!p || p.roadsideReserved) continue;
        const d = Math.hypot(p.worldX-g.controller.x, p.worldZ-g.controller.z);
        if (d < 65) nearbyPedestrians++;
        if (d <= 135 && clip(p.worldX, 1.15, p.worldZ)) pedestrians++;
      }
      const samples = [];
      for (let i=0; i<5; i++) {
        const t = performance.now(); g.renderer.render(g.scene, g.camera);
        samples.push(performance.now()-t);
      }
      samples.sort((a,b) => a-b);
      const info = g.renderer.info;
      return { gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        resolution: [g.renderer.domElement.width, g.renderer.domElement.height],
        scene: s.name, simulatedSeconds: s.mode === 'drive' ? 5 : 7,
        start, end: { x:g.controller.x, z:g.controller.z, speed:g.controller.speed },
        travel: Math.hypot(g.controller.x-start.x, g.controller.z-start.z), market,
        visibleVehicles: vehicles, vehicleTypes: byType, visiblePedestrians: pedestrians,
        nearbyVehicles, nearbyTypes: nearbyByType, nearbyPedestrians,
        fleetTotal: g.traffic.vehicleCount, pedestrianTotal: g.peds.activePedestrianCount,
        wetness: g.env.wetness, night: g.env.nightFactor,
        calls: info.render.calls, triangles: info.render.triangles,
        geometries: info.memory.geometries, textures: info.memory.textures,
        renderWallMedianMs: +samples[2].toFixed(2), glError: gl.getError() };
    }, scene);
    await page.screenshot({ path: path.join(out, `${scene.name}.png`) });
    results.push({ ...result, bootMs });
  }
  fs.writeFileSync(path.join(out, 'metrics.json'), JSON.stringify({ results, errors }, null, 2));
  if (errors.length || results.some(r => r.glError || !r.fleetTotal || !r.pedestrianTotal ||
    (r.scene.includes('drive') && r.travel < 1))) throw Error(JSON.stringify({ results, errors }));
  console.log(JSON.stringify({ results, errors }, null, 2));
} finally { await teardownHarness(browser, server); }
