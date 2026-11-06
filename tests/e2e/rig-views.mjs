/* Real rendered player/NPC rig visual fixture. Near/far refer to player-based LOD,
 * camera is deliberately placed next to agent to inspect silhouette. */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { ensureChromiumEnv, teardownHarness } from './chromium-env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = 4233;
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
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  const checks = [];
  for (const kind of ['cng', 'easybike', 'rickshaw']) {
    for (const lod of ['near', 'far']) {
      const result = await page.evaluate(([kind, lod]) => {
        const g = window.__banglarTesla, t = g.traffic;
        const lane = t.graph.byId.get('asad_2:fwd');
        const s = lane.length * 0.36;
        const x = lane.ax + lane.ux * s, z = lane.az + lane.uz * s;
        const idx = t.debugPositionAgentForTest(kind, x, z, lane.yaw, 0);
        if (idx < 0) throw new Error('no traffic agent');
        const a = t.agents[idx];
        t.agents = [a];
        a.speed = 0; a.dwellTimer = 60;
        const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
        const rx = Math.cos(a.yaw), rz = -Math.sin(a.yaw);
        const dist = lod === 'near' ? 14 : 110;
        g.debugTeleport(x - fx * dist + rx * 9, z - fz * dist + rz * 9, a.yaw);
        g.debugFreeCamera = true;
        g.ui.show(null);
        g.camera.position.set(x + fx * 4.8 + rx * 1.85, 2.55, z + fz * 4.8 + rz * 1.85);
        g.camera.lookAt(x, 1.15, z);
        g.camera.fov = 44;
        g.camera.updateProjectionMatrix();
        g.debugStepSim(1 / 30);
        const steerCount = t.group.children.filter((c) => c.name.startsWith(`traffic.${kind}.steering.`)).reduce((n, c) => n + c.count, 0);
        const windshield = t.group.getObjectByName(`traffic.${kind}.windscreen`);
        return { kind, lod, steerCount, windscreenCount: windshield?.count ?? null, nearLod: a.nearLod, visible: a.visible };
      }, [kind, lod]);
      checks.push(result);
      await page.screenshot({ path: path.join(root, 'artifacts', `rig-${kind}-${lod}.png`) });
    }
  }
  if (checks.some((c) => c.steerCount !== 1 || !c.visible || c.nearLod !== (c.lod === 'near') || ((c.kind === 'cng' || c.kind === 'easybike') && c.windscreenCount !== 1)) || errors.length) throw new Error(JSON.stringify({ checks, errors }));
  console.log('PASS rendered NPC driver rig near/far fixture', JSON.stringify(checks));
} finally { await teardownHarness(browser, server); }
