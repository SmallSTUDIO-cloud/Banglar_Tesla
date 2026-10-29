/** Visual QA: 20 distinct live traffic-agent IDs, three close-up angles each.
 * Positions and LODs are deliberately staged fixtures, not evidence of natural driving. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { ensureChromiumEnv, teardownHarness } from './chromium-env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'artifacts/vnext-driver-closeups');
const port = 4204, base = `http://127.0.0.1:${port}`;
fs.mkdirSync(out, { recursive: true });
const server = spawn(path.join(root, 'node_modules/.bin/vite'), ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
const start = Date.now();
while (true) {
  try { if ((await fetch(base)).ok) break; } catch {}
  if (Date.now() - start > 30000) { server.kill(); throw new Error('preview did not start'); }
  await new Promise((r) => setTimeout(r, 250));
}
let browser;
try {
  browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], executablePath: await chromium.executablePath(), headless: 'shell', env: ensureChromiumEnv(), defaultViewport: { width: 960, height: 720, deviceScaleFactor: 1 } });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('PAGEERROR', e.message));
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction('Boolean(window.__banglarTesla)', { timeout: 60000 });
  const drivers = await page.evaluate(() => {
    const g = window.__banglarTesla;
    g.state.markTutorialDone(); g.debugStartMode('free');
    g.debugSetQuality('pc_high'); g.debugSetPhase('golden', 'sunny');
    g.ui.show(null); g.debugFreeCamera = true; g.player.root.visible = false;
    g.renderer.setAnimationLoop(null); // one deliberate render per view; no competing RAF
    g.traffic.debugSetSimulationFrozen(true);
    const byType = ['rickshaw','cng','easybike'].map((kind) => g.traffic.agents.map((a,index) => ({kind:a.kind,index})).filter((a) => a.kind === kind));
    const chosen = [...byType[0].slice(0,10), ...byType[1].slice(0,5), ...byType[2].slice(0,5)];
    // If the seeded population contains fewer than five of a type, use other
    // distinct existing agents; never duplicate an ID to reach twenty.
    for (const list of byType) for (const a of list) if (chosen.length < 20 && !chosen.some((b) => b.index === a.index)) chosen.push(a);
    return chosen.map((a, i) => ({...a, lod: i % 2 ? 'far' : 'near', steer: [-0.5,-0.25,0,0.25,0.5][i % 5]}));
  });
  if (drivers.length < 20 || new Set(drivers.map((d) => d.index)).size !== 20) throw new Error(`Need 20 distinct agents, got ${JSON.stringify(drivers)}`);
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ note:'Live traffic agents staged individually at one road location; alternating LODs and precomputed steering angles.', drivers }, null, 2));
  for (let i = 0; i < drivers.length; i++) {
    for (const [view, angle] of [['front',0], ['three-quarter',0.85], ['side',Math.PI/2]]) {
      const data = await page.evaluate(({driver,angle}) => {
        const g = window.__banglarTesla;
        for (const a of g.traffic.agents) a.visible = false;
        const a = g.traffic.agents[driver.index];
        a.x = 42; a.z = 106; a.y = g.city.heightAt(a.x,a.z); a.yaw = 0;
        a.visible = true; a.nearLod = driver.lod === 'near'; a.steerAngle = driver.steer;
        g.traffic.fleet.sync(g.traffic.agents);
        const targetZ = a.kind === 'cng' ? 0.4 : 0.25;
        // CNG's roof is low: use an eye-level outside view through the real
        // windscreen rather than letting the roof obscure the driver's head.
        const cameraY = a.kind === 'cng' ? 1.12 : 1.7;
        const targetY = a.kind === 'cng' ? 1.12 : 1.24;
        g.camera.position.set(a.x + Math.sin(angle)*3.8, a.y + cameraY, a.z + targetZ + Math.cos(angle)*3.8);
        g.camera.lookAt(a.x, a.y + targetY, a.z + targetZ);
        g.camera.fov = 30; g.camera.updateProjectionMatrix();
        g.renderer.render(g.scene, g.camera);
        return g.renderer.domElement.toDataURL('image/png');
      }, {driver: drivers[i], angle});
      fs.writeFileSync(path.join(out, `${String(i+1).padStart(2,'0')}-${drivers[i].kind}-${drivers[i].lod}-${view}.png`), Buffer.from(data.split(',')[1], 'base64'));
    }
    console.log(`${i+1}/20: agent ${drivers[i].index} ${drivers[i].kind} ${drivers[i].lod}, steer ${drivers[i].steer}`);
  }
} finally {
  if (browser) await teardownHarness(browser, server); else server.kill('SIGTERM');
}
console.log('Close-ups and agent manifest written to', out);
