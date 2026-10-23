/**
 * End-to-end smoke test in a real (software-rendered) Chromium:
 * boots the game, plays a full passenger job, buys an item, saves and reloads.
 *
 * Run: node tests/e2e/run-e2e.mjs
 * Screenshots are written to artifacts/ for visual review.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const artifacts = path.join(root, 'artifacts');
const PORT = 4189;
const URL_BASE = `http://127.0.0.1:${PORT}`;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function main() {
  fs.mkdirSync(artifacts, { recursive: true });
  const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', () => {});

  const ready = await waitForServer(URL_BASE);
  if (!ready) {
    console.error('preview server did not start');
    server.kill('SIGTERM');
    process.exit(1);
  }

  const exe = await chromium.executablePath();
  const browser = await puppeteer.launch({
    args: [
      ...chromium.args,
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--no-sandbox',
      '--autoplay-policy=no-user-gesture-required',
    ],
    executablePath: exe,
    headless: 'shell',
    env: { ...process.env, LD_LIBRARY_PATH: '/tmp/tools/probe/libs/lib' },
    defaultViewport: { width: 900, height: 506, deviceScaleFactor: 1 },
  });

  const page = await browser.newPage();
  const errors = [];
  const consoleErrors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  try {
    await page.goto(URL_BASE, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForFunction('!!window.__banglarTesla', { timeout: 60000 });
    await new Promise((r) => setTimeout(r, 1500));

    // ---------------------------------------------------------- boot/menu
    const menuVisible = await page.evaluate(() => {
      const menu = document.querySelector('.menu-screen');
      return !!menu && !menu.classList.contains('hidden');
    });
    check('main menu visible after boot', menuVisible);
    await page.screenshot({ path: path.join(artifacts, '01-menu.png') });

    const snapshot0 = await page.evaluate(() => window.__banglarTesla.debugSnapshot());
    check('no page errors during boot', errors.length === 0, errors.join(' | ').slice(0, 300));

    // ------------------------------------------------------------ start job
    await page.evaluate(() => {
      const g = window.__banglarTesla;
      g.debugStartMode('duty');
    });
    await new Promise((r) => setTimeout(r, 900));
    const snap1 = await page.evaluate(() => window.__banglarTesla.debugSnapshot());
    check('passenger duty entered HUD', snap1.screen === 'hud', JSON.stringify(snap1));
    await page.screenshot({ path: path.join(artifacts, '02-hud-joboffer.png') });

    const offer = await page.evaluate(() => {
      const g = window.__banglarTesla;
      const el = document.getElementById('job-offer');
      return { has: !!el, text: el ? el.textContent : '' };
    });
    check('a passenger job offer appears', offer.has, offer.text.slice(0, 90));

    await page.evaluate(() => window.__banglarTesla.debugAcceptOffer());
    await new Promise((r) => setTimeout(r, 500));
    const snap2 = await page.evaluate(() => window.__banglarTesla.debugSnapshot());
    check('mission started (toPickup)', snap2.missionState === 'toPickup', snap2.missionState);

    // ---------------------------------------------------------- driving
    // Teleport next to the pickup, then stop inside the zone.
    await page.evaluate(() => {
      const g = window.__banglarTesla;
      g.debugTeleportToPickup();
      // Advance simulated time rather than wall clock: the software renderer
      // runs far below real time, which would otherwise mask real failures.
      g.debugStepUntil(() => g.debugSnapshot().missionState === 'toDropoff', 16);
    });
    await new Promise((r) => setTimeout(r, 300));
    const snap3 = await page.evaluate(() => window.__banglarTesla.debugSnapshot());
    check('pickup zone reached and passenger boarded', snap3.missionState === 'toDropoff', snap3.missionState);
    await page.screenshot({ path: path.join(artifacts, '03-passenger-boarded.png') });

    // Drive with the actual physics for a moment (pedal held).
    const before = await page.evaluate(() => window.__banglarTesla.debugSnapshot());
    await page.evaluate(() => {
      const g = window.__banglarTesla;
      g.debugStepSim(1.0);
      g.debugHoldInput({ throttle: 1, steer: 0 }, 6000);
      g.debugStepSim(3.0);
      g.debugHoldInput({ throttle: 0, steer: 0 }, 1);
      g.debugStepSim(0.5);
    });
    const after = await page.evaluate(() => window.__banglarTesla.debugSnapshot());
    const moved = Math.hypot(after.x - before.x, after.z - before.z);
    check('rickshaw moves under pedal input', moved > 0.5, `moved ${moved.toFixed(2)} m, speed ${after.speed.toFixed(2)}`);

    // Teleport to the drop-off and complete.
    await page.evaluate(() => {
      const g = window.__banglarTesla;
      g.debugTeleportToDropoff();
      g.debugStepUntil(() => g.debugSnapshot().missionState === 'complete', 10);
    });
    await new Promise((r) => setTimeout(r, 500));
    const snap4 = await page.evaluate(() => window.__banglarTesla.debugSnapshot());
    check('ride completed', snap4.rides === snapshot0.rides + 1, `rides ${snap4.rides}, state ${snap4.missionState}`);
    await page.screenshot({ path: path.join(artifacts, '04-result.png') });

    const earned = snap4.balance - snapshot0.balance;
    check('fare paid in taka', earned > 0, `balance ${snapshot0.balance} → ${snap4.balance} (+${earned})`);

    // ------------------------------------------------------------- garage
    await page.evaluate(() => {
      const g = window.__banglarTesla;
      g.debugOpenGarageForTest();
    });
    await new Promise((r) => setTimeout(r, 800));
    const garage = await page.evaluate(() => {
      const el = document.querySelector('.screen:not(.hidden)');
      return { cls: el ? el.className : '', text: el ? el.textContent.slice(0, 200) : '' };
    });
    check('garage screen opens', garage.cls.includes('screen'), garage.cls);
    await page.screenshot({ path: path.join(artifacts, '05-garage.png') });

    // buy the cheapest cosmetic through the real UI path
    const bought = await page.evaluate(() => window.__banglarTesla.debugBuyFirstCosmetic());
    check('cosmetic purchase succeeds and persists', bought.ok, JSON.stringify(bought));

    // ------------------------------------------------------------ settings
    await page.evaluate(() => window.__banglarTesla.debugOpenSettingsForTest());
    await new Promise((r) => setTimeout(r, 400));
    const settingsShown = await page.evaluate(() => {
      const el = document.querySelectorAll('.screen');
      return Array.from(el).some((e) => e.textContent.includes('সেটিংস') && !e.classList.contains('hidden'));
    });
    check('settings screen opens with Bangla labels', settingsShown);
    await page.screenshot({ path: path.join(artifacts, '06-settings.png') });

    const qualityChange = await page.evaluate(() => window.__banglarTesla.debugSetQuality('low'));
    check('quality preset changes real settings', qualityChange.quality === 'low' && qualityChange.shadows === false, JSON.stringify(qualityChange));

    const langChange = await page.evaluate(() => window.__banglarTesla.debugSetLanguage('en'));
    check('language switches to English', langChange.language === 'en', JSON.stringify(langChange));
    await page.evaluate(() => window.__banglarTesla.debugSetLanguage('bn'));

    // ------------------------------------------------------------- persistence
    const beforeReload = await page.evaluate(() => {
      const g = window.__banglarTesla;
      g.debugSaveNow();
      return { balance: g.debugSnapshot().balance, rides: g.debugSnapshot().rides };
    });
    await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForFunction('!!window.__banglarTesla', { timeout: 60000 });
    await new Promise((r) => setTimeout(r, 1200));
    const afterReload = await page.evaluate(() => {
      const g = window.__banglarTesla;
      return {
        balance: g.debugSnapshot().balance,
        rides: g.debugSnapshot().rides,
        quality: g.debugSnapshot().quality,
        cosmetics: g.debugOwnedCosmeticsCount(),
      };
    });
    check(
      'progress survives reload (balance + rides)',
      afterReload.balance === beforeReload.balance && afterReload.rides === beforeReload.rides,
      JSON.stringify({ beforeReload, afterReload }),
    );
    check('purchase survives reload', afterReload.cosmetics >= 2, `owned cosmetics: ${afterReload.cosmetics}`);
    check('settings survive reload', afterReload.quality === 'low', afterReload.quality);

    // free ride mode
    await page.evaluate(() => window.__banglarTesla.debugStartMode('free'));
    await new Promise((r) => setTimeout(r, 700));
    const freeSnap = await page.evaluate(() => window.__banglarTesla.debugSnapshot());
    check('free ride mode runs', freeSnap.mode === 'free', JSON.stringify(freeSnap));

    // pause freezes simulation
    await page.evaluate(() => window.__banglarTesla.pauseGame());
    const pausedSnap = await page.evaluate(() => window.__banglarTesla.debugSnapshot());
    check('pause menu opens', pausedSnap.paused === true && pausedSnap.screen === 'pause', JSON.stringify(pausedSnap));

    check('no page errors during the whole run', errors.length === 0, errors.slice(0, 3).join(' | '));
    const fatalConsole = consoleErrors.filter((e) => !e.includes('favicon') && !e.includes('WebGL'));
    check('no fatal console errors', fatalConsole.length === 0, fatalConsole.slice(0, 3).join(' | '));

    await page.screenshot({ path: path.join(artifacts, '07-final.png') });
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  fs.writeFileSync(path.join(artifacts, 'e2e-results.json'), JSON.stringify(results, null, 2));
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('E2E crashed:', err);
  process.exit(1);
});
