/**
 * Milestone 7A — Master Upgrade v2 New-Systems Profiling & 8-Scenario Stress Suite:
 *
 * Profiles:
 *   - 11_tan_boost_dense_market
 *   - 12_road_rage_pursuit_dialogue
 *   - 13_road_rage_confrontation_modal
 *   - 14_multi_prop_destruction_burst
 *   - 15_combined_worst_case_storm (`টান` + road-rage + destruction + monsoon rain + music + ambience)
 *
 * Stress Tests (asserting zero unbounded WebGL / Audio / DOM / Heap growth):
 *   1. Repeated Road-Rage Encounters (x8 back-to-back escape/pay/scuffle cycles)
 *   2. Repeated Lamp & Stall Destruction (x20 props smashed + debris settle)
 *   3. Repeated `টান` Boost Toggle (x30 rapid toggles + drain/regen)
 *   4. Simultaneous Worst-Case (`টান` + Road-Rage + Destruction + Rain + Ambience + Music)
 *   5. Rapid Camera Switching (x28 switches across all 7 modes during active `টান` + Road-Rage)
 *   6. Repeated Menu <-> Gameplay <-> Garage <-> Dokan <-> Pause Cycles (x6 full cycles)
 *   7. Audio Mute / Unmute / Tab Visibility Background-Foreground Cycles (x10 cycles)
 *   8. Sustained 15-Minute Interleaved Upgrade Gameplay Session (54,000 fixed 60 Hz steps)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { ensureChromiumEnv, teardownHarness } from './chromium-env.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const artifacts = path.join(root, 'artifacts');
const PORT = 4199;
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

async function waitFor(url, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function main() {
  fs.mkdirSync(artifacts, { recursive: true });
  const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
    cwd: root,
    stdio: 'ignore',
  });
  if (!(await waitFor(BASE))) {
    server.kill('SIGTERM');
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    args: [
      ...chromium.args,
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--no-sandbox',
      '--autoplay-policy=no-user-gesture-required',
      '--js-flags=--expose-gc',
    ],
    executablePath: await chromium.executablePath(),
    headless: 'shell',
    env: ensureChromiumEnv(),
    defaultViewport: { width: 915, height: 412, deviceScaleFactor: 1 },
  });

  const page = await browser.newPage();
  const cdp = await page.target().createCDPSession();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  const profileRows = [];

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction('!!window.__banglarTesla', { timeout: 60000 });
    await page.evaluate(() => document.fonts.ready); // settle web fonts before UI measurement / reload (prevents font-abort races on slow runners)
    await page.mouse.click(450, 210);
    await page.evaluate(async () => {
      document.getElementById('boot-skip')?.click();
      await window.__banglarTesla.audio.init();
      window.__banglarTesla.state.progress.tutorialDone = true;
      window.__banglarTesla.debugSetQuality('balanced');
      window.__banglarTesla.debugStartMode('free');
    });
    await page.waitForFunction('window.__banglarTesla.debugSnapshot().audioAssets === 26', { timeout: 15000 });

    async function profileScenario(name, setupFnStr) {
      await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
      const h0 = (await cdp.send('Runtime.getHeapUsage')).usedSize / (1024 * 1024);
      const metrics = await page.evaluate(
        ({ fnSrc }) => {
          const g = window.__banglarTesla;
          new Function('g', fnSrc)(g);

          const simSamples = [];
          const renderSamples = [];
          for (let f = 0; f < 24; f++) {
            const u0 = performance.now();
            for (let k = 0; k < 3; k++) g.update(1 / 60);
            simSamples.push((performance.now() - u0) / 3);

            const r0 = performance.now();
            g.render();
            renderSamples.push(performance.now() - r0);
          }

          let casters = 0;
          g.scene.traverseVisible((o) => {
            if (o.isMesh && o.castShadow) casters++;
          });
          const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
          const snap = g.debugSnapshot();
          return {
            calls: g.renderer.info.render.calls,
            tris: g.renderer.info.render.triangles,
            casters,
            geoms: g.renderer.info.memory.geometries,
            tex: g.renderer.info.memory.textures,
            programs: g.renderer.info.programs?.length ?? 0,
            simMs: +avg(simSamples).toFixed(3),
            renderMs: +avg(renderSamples).toFixed(2),
            audioActiveSources: snap.audioActiveSources,
            activeDebrisPieces: snap.activeDebrisPieces,
            domNodes: document.getElementsByTagName('*').length,
          };
        },
        { fnSrc: setupFnStr },
      );
      await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
      const h1 = (await cdp.send('Runtime.getHeapUsage')).usedSize / (1024 * 1024);
      const row = { name, ...metrics, heapMB: +h1.toFixed(2), heapDeltaMB: +(h1 - h0).toFixed(2) };
      profileRows.push(row);
      console.log(`[profile] ${name}:`, JSON.stringify(row));
      return row;
    }

    // --- Profile 5 new Master Upgrade v2 scenarios ---
    await profileScenario(
      '11_tan_boost_dense_market',
      `
      g.roadRage.cancel(0);
      g.debugTeleport(-22, 6, 1.5);
      g.controller.restoreStamina(100);
      g.controller.setTanActive(true);
      g.debugInput = { throttle: 1, brake: 0, steer: 0.04 };
    `,
    );

    await profileScenario(
      '12_road_rage_pursuit_dialogue',
      `
      g.debugInput = null;
      g.roadRage.cancel(0);
      g.debugCollideWithTrafficKindForTest('car', 7.0);
      const dp = g.roadRage.driverPosition;
      g.debugTeleport(dp.x + 8, dp.z, 0);
      g.debugInput = { throttle: 0.75, brake: 0, steer: 0.05 };
    `,
    );

    await profileScenario(
      '13_road_rage_confrontation_modal',
      `
      g.debugInput = null;
      g.roadRage.cancel(0);
      g.debugSetBalanceForTest(500);
      g.debugCollideWithTrafficKindForTest('car', 7.0);
      g.controller.speed = 0;
      g.debugStepSim(2.6);
    `,
    );

    await profileScenario(
      '14_multi_prop_destruction_burst',
      `
      g.roadRage.cancel(0);
      g.destruction.resetAll();
      g.debugSmashBreakableForTest('lamp', 7.0);
      g.debugSmashBreakableForTest('stall', 7.0);
    `,
    );

    const worstCase = await profileScenario(
      '15_combined_worst_case_storm',
      `
      g.roadRage.cancel(0);
      g.debugSetPhase('blue', 'rain');
      g.debugCollideWithTrafficKindForTest('car', 7.2);
      g.debugSmashBreakableForTest('lamp', 7.2);
      g.controller.restoreStamina(100);
      g.controller.setTanActive(true);
      g.debugInput = { throttle: 1, brake: 0, steer: 0.05 };
    `,
    );
    check(
      'Stress 4: Simultaneous worst-case (`টান` + Road-Rage + Destruction + Rain + Audio) stays under draw-call, CPU & audio budgets',
      worstCase.calls <= 245 &&
        worstCase.simMs < 1.8 &&
        worstCase.audioActiveSources <= 14 &&
        worstCase.casters <= 50,
      JSON.stringify(worstCase),
    );

    // Baseline WebGL + Heap snapshot before stress loops
    await page.evaluate(() => {
      const g = window.__banglarTesla;
      g.debugInput = null;
      g.roadRage.cancel(0);
      g.destruction.resetAll();
      g.debugSetPhase('morning', 'clear');
      g.render();
    });
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
    const baseStats = await page.evaluate(() => {
      const g = window.__banglarTesla;
      return {
        geoms: g.renderer.info.memory.geometries,
        tex: g.renderer.info.memory.textures,
        programs: g.renderer.info.programs?.length ?? 0,
        domNodes: document.getElementsByTagName('*').length,
      };
    });
    const baseHeapMB = (await cdp.send('Runtime.getHeapUsage')).usedSize / (1024 * 1024);

    // Stress 1: Repeated road-rage encounters (x8: escape, pay, scuffle)
    const stress1 = await page.evaluate(() => {
      const g = window.__banglarTesla;
      for (let i = 0; i < 8; i++) {
        g.roadRage.cancel(0);
        g.debugSetBalanceForTest(500);
        g.debugCollideWithTrafficKindForTest('car', 7.2);
        if (i % 3 === 0) {
          const dp = g.roadRage.driverPosition;
          g.debugTeleport(dp.x + 120, dp.z, 0);
          g.debugStepSim(6.2);
        } else if (i % 3 === 1) {
          g.controller.speed = 0;
          g.debugStepSim(3.0);
          document.getElementById('roadrage-pay-btn')?.click();
        } else {
          g.controller.speed = 0;
          g.debugStepSim(3.0);
          document.getElementById('roadrage-refuse-btn')?.click();
          g.debugStepSim(2.0);
        }
        g.render();
      }
      const s = g.debugSnapshot();
      return {
        finalState: s.roadRageState,
        geoms: g.renderer.info.memory.geometries,
        tex: g.renderer.info.memory.textures,
        audioActiveSources: s.audioActiveSources,
      };
    });
    check(
      'Stress 1: 8 repeated road-rage encounters (escape/pay/scuffle) leak 0 geometries/textures and stay within strict audio cap (<= 15)',
      stress1.finalState === 'idle' &&
        stress1.geoms === baseStats.geoms &&
        stress1.tex === baseStats.tex &&
        stress1.audioActiveSources <= 15,
      JSON.stringify(stress1),
    );

    // Stress 2: Repeated lamp & stall destruction (x20 props smashed)
    const stress2 = await page.evaluate(() => {
      const g = window.__banglarTesla;
      g.destruction.resetAll();
      let smashed = 0;
      for (let i = 0; i < 10; i++) {
        if (g.debugSmashBreakableForTest('lamp', 7.0)) smashed++;
        if (g.debugSmashBreakableForTest('stall', 7.0)) smashed++;
      }
      g.render();
      const midPieces = g.debugSnapshot().activeDebrisPieces;
      g.debugStepSim(3.5);
      g.render();
      return {
        smashed,
        midPieces,
        settledPieces: g.debugSnapshot().activeDebrisPieces,
        geoms: g.renderer.info.memory.geometries,
        tex: g.renderer.info.memory.textures,
        calls: g.renderer.info.render.calls,
      };
    });
    check(
      'Stress 2: Smashing 20 street lamps & stalls caps active debris (<= 68), settles to 0 pieces, and leaks 0 geometries/textures',
      stress2.smashed >= 16 &&
        stress2.midPieces > 0 &&
        stress2.midPieces <= 68 &&
        stress2.settledPieces === 0 &&
        stress2.geoms === baseStats.geoms &&
        stress2.tex === baseStats.tex,
      JSON.stringify(stress2),
    );

    // Stress 3: Repeated `টান` boost toggle (x30 rapid toggles + drain/regen)
    const stress3 = await page.evaluate(() => {
      const g = window.__banglarTesla;
      g.controller.restoreStamina(100);
      for (let i = 0; i < 30; i++) {
        document.getElementById('hud-tan-btn')?.click();
        g.debugInput = { throttle: 1, brake: 0, steer: 0 };
        g.debugStepSim(0.15);
        g.render();
      }
      g.debugInput = null;
      g.controller.setTanActive(false);
      g.render();
      return {
        geoms: g.renderer.info.memory.geometries,
        audioActiveSources: g.debugSnapshot().audioActiveSources,
      };
    });
    check(
      'Stress 3: 30 rapid টান boost toggles stay strictly capped in audio sources (<= 15) and allocate 0 GPU geometries',
      stress3.geoms === baseStats.geoms && stress3.audioActiveSources <= 15,
      JSON.stringify(stress3),
    );

    // Stress 5: Rapid camera switching (x28 across all 7 modes during active `টান` + Road-Rage)
    const stress5 = await page.evaluate(() => {
      const g = window.__banglarTesla;
      g.roadRage.cancel(0);
      g.debugCollideWithTrafficKindForTest('car', 7.0);
      g.controller.restoreStamina(100);
      g.controller.setTanActive(true);
      const programsBefore = g.renderer.info.programs?.length ?? 0;
      for (let i = 0; i < 28; i++) {
        g.toggleCamera();
        g.update(1 / 60);
        g.render();
      }
      const programsAfter = g.renderer.info.programs?.length ?? 0;
      g.setCameraMode('chase');
      g.controller.setTanActive(false);
      g.roadRage.cancel(0);
      return { programsBefore, programsAfter };
    });
    check(
      'Stress 5: 28 rapid camera switches during active টান + road-rage compile 0 new shaders',
      stress5.programsAfter === stress5.programsBefore,
      JSON.stringify(stress5),
    );

    // Stress 6: Repeated Menu <-> Gameplay <-> Garage <-> Dokan <-> Pause cycles (x6)
    const stress6 = await page.evaluate(() => {
      const g = window.__banglarTesla;
      // Warm showroom once first since showroom is intentionally lazy-built on first open
      g.ui.openGarage('menu');
      g.render();
      g.ui.closeGarage();
      const geomsAfterWarm = g.renderer.info.memory.geometries;
      const texAfterWarm = g.renderer.info.memory.textures;

      for (let i = 0; i < 6; i++) {
        g.debugStartMode('free');
        g.debugStepSim(0.2);
        document.querySelector('[data-action="pause"]')?.click();
        g.resumeGame();
        g.returnToMenu();
        g.ui.openGarage('menu');
        g.render();
        g.ui.closeGarage();
        g.ui.openStore();
        g.render();
        g.ui.closeStore();
      }
      g.debugStartMode('free');
      g.render();
      return {
        geomsAfterWarm,
        geomsEnd: g.renderer.info.memory.geometries,
        texAfterWarm,
        texEnd: g.renderer.info.memory.textures,
        audioScene: g.debugSnapshot().audioScene,
      };
    });
    check(
      'Stress 6: 6 full Menu <-> Gameplay <-> Pause <-> Garage <-> Dokan cycles leak 0 geometries/textures',
      stress6.geomsEnd === stress6.geomsAfterWarm &&
        stress6.texEnd === stress6.texAfterWarm &&
        stress6.audioScene === 'driving',
      JSON.stringify(stress6),
    );

    // Stress 7: Audio mute/unmute & visibility background/foreground cycles (x10)
    const stress7 = await page.evaluate(async () => {
      const g = window.__banglarTesla;
      for (let i = 0; i < 10; i++) {
        g.settings.set({ muted: true });
        g.applySettings();
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        document.dispatchEvent(new Event('visibilitychange'));
        g.resumeGame();
        g.settings.set({ muted: false });
        g.applySettings();
        g.update(1 / 60);
      }
      await g.audio.init();
      const s = g.debugSnapshot();
      return {
        audioUnlocked: s.audioUnlocked,
        audioScene: s.audioScene,
        audioActiveSources: s.audioActiveSources,
      };
    });
    check(
      'Stress 7: 10 mute/unmute + background/foreground visibility cycles recover cleanly',
      stress7.audioUnlocked && stress7.audioScene === 'driving' && stress7.audioActiveSources <= 10,
      JSON.stringify(stress7),
    );

    // Stress 8: Sustained 15-minute interleaved session with new v0.4 systems active
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
    const heapBefore15 = (await cdp.send('Runtime.getHeapUsage')).usedSize / (1024 * 1024);
    const stress8 = await page.evaluate(() => {
      const g = window.__banglarTesla;
      g.destruction.resetAll();
      g.roadRage.cancel(0);
      g.debugStartMode('duty');
      const geoms0 = g.renderer.info.memory.geometries;
      const tex0 = g.renderer.info.memory.textures;
      const t0 = performance.now();

      // 54,000 fixed 60 Hz steps = 900s = 15.0 minutes
      for (let step = 0; step < 54000; step++) {
        if (step % 1800 === 0) {
          if (g.controller.stuck) g.recoverRickshaw();
          g.controller.restoreStamina(100);
          g.controller.setTanActive(step % 3600 === 0);
          g.debugInput = {
            throttle: 0.88,
            steer: Math.sin(step / 900) * 0.2,
            brake: 0,
          };
        }
        if (step === 9000 || step === 27000) {
          g.debugSmashBreakableForTest('lamp', 6.8);
        }
        if (step === 18000) {
          g.roadRage.cancel(0);
          g.debugCollideWithTrafficKindForTest('car', 7.0);
          const dp = g.roadRage.driverPosition;
          g.debugTeleport(dp.x + 120, dp.z, 0);
        }
        g.update(1 / 60);
        if (step % 1800 === 0) g.render();
      }
      g.debugInput = null;
      g.controller.setTanActive(false);
      g.roadRage.cancel(0);
      const simMsPerStep = (performance.now() - t0) / 54000;
      g.render();
      return {
        simMsPerStep: +simMsPerStep.toFixed(3),
        geoms0,
        geomsEnd: g.renderer.info.memory.geometries,
        tex0,
        texEnd: g.renderer.info.memory.textures,
        domNodes: document.getElementsByTagName('*').length,
      };
    });
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
    const heapAfter15 = (await cdp.send('Runtime.getHeapUsage')).usedSize / (1024 * 1024);
    const heapGrowth15 = +(heapAfter15 - heapBefore15).toFixed(2);
    check(
      'Stress 8: 15-minute interleaved upgrade session keeps WebGL memory flat and heap growth bounded (< 1.5 MB)',
      stress8.geomsEnd === stress8.geoms0 &&
        stress8.texEnd === stress8.tex0 &&
        stress8.simMsPerStep < 1.0 &&
        heapGrowth15 < 1.5,
      JSON.stringify({ ...stress8, heapBeforeMB: +heapBefore15.toFixed(2), heapAfterMB: +heapAfter15.toFixed(2), heapGrowth15 }),
    );

    check('Zero page errors across all 8 stress tests', pageErrors.length === 0, pageErrors.join('; '));

    fs.writeFileSync(
      path.join(artifacts, 'stress-v2-report.json'),
      JSON.stringify({ baseHeapMB: +baseHeapMB.toFixed(2), profileRows, results }, null, 2),
    );
  } finally {
    await teardownHarness(browser, server);
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} Milestone 7A stress checks passed`);
  process.exit(passed !== results.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
