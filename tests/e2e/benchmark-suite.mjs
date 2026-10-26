/**
 * Reproducible 10-scenario + Phase-2 Bottleneck Ablation Benchmark Suite
 * for Banglar Tesla — বাংলার টেসলা.
 *
 * Environment note:
 *   Runs in Headless Chromium + SwiftShader (software WebGL2) on Linux.
 *   SwiftShader render wall-time reflects software vertex/fragment execution +
 *   GL command submission, NOT physical Samsung Galaxy M21 Mali-G72 MP3 silicon.
 *   We therefore record separated CPU subsystem timings, draw calls, triangles,
 *   shadow-caster counts, shader compile spikes, async GPU query availability,
 *   heap allocation churn, DOM/listener counts, and 15-minute sustained stability.
 *
 * Usage:
 *   node tests/e2e/benchmark-suite.mjs --tag=baseline --ablation
 *   node tests/e2e/benchmark-suite.mjs --tag=opt1
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

const args = process.argv.slice(2);
const tagArg = args.find((a) => a.startsWith('--tag='))?.split('=')[1] ?? 'run';
const runAblation = args.includes('--ablation');

async function waitFor(url, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {
      /* wait */
    }
    await new Promise((r) => setTimeout(r, 200));
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
    console.error('Preview server failed to start');
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
    ],
    executablePath: await chromium.executablePath(),
    headless: 'shell',
    env: ensureChromiumEnv(),
    // 915 x 412 matches Samsung Galaxy M21 CSS viewport aspect (2340x1080 @ ~2.55-2.625x)
    defaultViewport: { width: 915, height: 412, deviceScaleFactor: 1 },
  });

  const page = await browser.newPage();
  const cdp = await page.target().createCDPSession();
  await cdp.send('Performance.enable');

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction('!!window.__banglarTesla', { timeout: 60000 });
    await page.evaluate(() => document.getElementById('boot-skip')?.click());
    await new Promise((r) => setTimeout(r, 600));

    // Install non-intrusive subsystem timing & longtask hooks in page context
    const envCapabilities = await page.evaluate(() => {
      const g = window.__banglarTesla;
      g.stop(); // Drive loop deterministically during benchmark sampling

      window.__btLongTasks = [];
      if (typeof PerformanceObserver !== 'undefined') {
        try {
          const obs = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              window.__btLongTasks.push(entry.duration);
            }
          });
          obs.observe({ entryTypes: ['longtask'] });
        } catch {
          /* longtask observer optional */
        }
      }

      const gl = g.renderer.getContext();
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      const glRenderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      const timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');

      // Wrap subsystem methods cleanly to accumulate exact CPU timings
      const stats = {
        trafficMs: 0,
        pedsMs: 0,
        physicsMs: 0,
        routeMs: 0,
        hudMs: 0,
        envMs: 0,
        calls: 0,
      };
      window.__btSubStats = stats;

      const wrap = (obj, method, bucket) => {
        if (!obj || typeof obj[method] !== 'function' || obj[method].__wrapped) return;
        const orig = obj[method].bind(obj);
        const fn = (...a) => {
          const t0 = performance.now();
          const r = orig(...a);
          stats[bucket] += performance.now() - t0;
          return r;
        };
        fn.__wrapped = true;
        obj[method] = fn;
      };

      wrap(g.traffic, 'update', 'trafficMs');
      wrap(g.peds, 'update', 'pedsMs');
      wrap(g.controller, 'step', 'physicsMs');
      wrap(g, 'recomputeRoute', 'routeMs');
      wrap(g.ui, 'updateHud', 'hudMs');
      wrap(g.env, 'update', 'envMs');

      return {
        glRenderer,
        hasDisjointTimerQuery: !!timerExt,
        userAgent: navigator.userAgent,
      };
    });

    console.log(`[env] Tag=${tagArg} | Renderer=${envCapabilities.glRenderer} | AsyncGPUTimer=${envCapabilities.hasDisjointTimerQuery}`);

    async function measureScenario(name, framesToRender, simFramesPerRender, setupFn) {
      await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
      const heapStart = await cdp.send('Runtime.getHeapUsage');

      const raw = await page.evaluate(
        ({ framesToRender: nRender, simFramesPerRender: nSim, setupSrc }) => {
          const g = window.__banglarTesla;
          window.__btLongTasks.length = 0;
          const s = window.__btSubStats;
          s.trafficMs = s.pedsMs = s.physicsMs = s.routeMs = s.hudMs = s.envMs = 0;

          // Execute scenario setup
          const fn = new Function('g', setupSrc);
          fn(g);

          // Measure first cold render frame separately (captures shader compile spikes!)
          const cold0 = performance.now();
          g.render();
          const coldRenderMs = performance.now() - cold0;

          // Reset subsystem accumulators after setup
          s.trafficMs = s.pedsMs = s.physicsMs = s.routeMs = s.hudMs = s.envMs = 0;

          const frameTimes = [];
          const simTimes = [];
          const renderTimes = [];

          // Optional non-blocking WebGL2 async GPU timer query if supported
          const gl = g.renderer.getContext();
          const timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
          const pendingQueries = [];
          const gpuSamplesNs = [];

          const totalSimSteps = nRender * nSim;
          for (let f = 0; f < nRender; f++) {
            const f0 = performance.now();
            const u0 = performance.now();
            for (let k = 0; k < nSim; k++) {
              g.update(1 / 60);
            }
            const uMs = (performance.now() - u0) / nSim;

            let q = null;
            if (timerExt) {
              q = gl.createQuery();
              gl.beginQuery(timerExt.TIME_ELAPSED_EXT, q);
            }
            const r0 = performance.now();
            g.render();
            const rMs = performance.now() - r0;
            if (timerExt && q) {
              gl.endQuery(timerExt.TIME_ELAPSED_EXT);
              pendingQueries.push(q);
            }

            // Harvest completed queries non-blockingly
            if (timerExt && pendingQueries.length > 0) {
              while (pendingQueries.length > 0) {
                const head = pendingQueries[0];
                const avail = gl.getQueryParameter(head, gl.QUERY_RESULT_AVAILABLE);
                const disjoint = gl.getParameter(timerExt.GPU_DISJOINT_EXT);
                if (!avail) break;
                pendingQueries.shift();
                if (!disjoint) {
                  gpuSamplesNs.push(gl.getQueryParameter(head, gl.QUERY_RESULT_EXT));
                }
                gl.deleteQuery(head);
              }
            }

            simTimes.push(uMs);
            renderTimes.push(rMs);
            frameTimes.push(uMs + rMs);
          }

          // Clean up any remaining queries without blocking
          if (timerExt) {
            for (const q of pendingQueries) gl.deleteQuery(q);
          }

          const pct = (arr, p) => {
            if (arr.length === 0) return 0;
            const sorted = [...arr].sort((a, b) => a - b);
            return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
          };
          const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

          const info = g.renderer.info;
          const activeScene = g.showroomVisible ? g.showroom.scene : g.scene;
          let totalObjects = 0;
          let visibleObjects = 0;
          let shadowCasters = 0;
          const seenTex = new Set();
          let texBytes = 0;
          const mats = new Set();

          const countScene = (rootNode, isVisibleAnc = true) => {
            totalObjects++;
            const vis = isVisibleAnc && rootNode.visible;
            if (vis) visibleObjects++;
            if (vis && rootNode.isMesh && rootNode.castShadow) shadowCasters++;
            const mList = Array.isArray(rootNode.material)
              ? rootNode.material
              : rootNode.material
                ? [rootNode.material]
                : [];
            for (const m of mList) {
              mats.add(m.uuid);
              for (const slot of ['map', 'emissiveMap', 'roughnessMap', 'normalMap']) {
                const tex = m[slot];
                if (tex && !seenTex.has(tex.uuid)) {
                  seenTex.add(tex.uuid);
                  const img = tex.image;
                  const w = img?.width || img?.videoWidth || 0;
                  const h = img?.height || img?.videoHeight || 0;
                  if (w && h) texBytes += w * h * 4 * 1.33;
                }
              }
            }
            for (let i = 0; i < rootNode.children.length; i++) {
              countScene(rootNode.children[i], vis);
            }
          };
          countScene(activeScene, true);

          const avgFrameMs = avg(frameTimes);
          const p50FrameMs = pct(frameTimes, 0.5);
          const p95FrameMs = pct(frameTimes, 0.95);
          const p99FrameMs = pct(frameTimes, 0.99);

          return {
            coldRenderMs: +coldRenderMs.toFixed(2),
            avgFps: +(1000 / Math.max(0.01, avgFrameMs)).toFixed(1),
            medianFps: +(1000 / Math.max(0.01, p50FrameMs)).toFixed(1),
            low1PctFps: +(1000 / Math.max(0.01, p99FrameMs)).toFixed(1),
            frameP50Ms: +p50FrameMs.toFixed(2),
            frameP95Ms: +p95FrameMs.toFixed(2),
            frameP99Ms: +p99FrameMs.toFixed(2),
            simAvgMs: +avg(simTimes).toFixed(3),
            simP95Ms: +pct(simTimes, 0.95).toFixed(3),
            renderSubmitAvgMs: +avg(renderTimes).toFixed(2),
            renderSubmitP95Ms: +pct(renderTimes, 0.95).toFixed(2),
            gpuAsyncMs: gpuSamplesNs.length > 0 ? +(avg(gpuSamplesNs) / 1e6).toFixed(2) : null,
            subsystemsMsPerSimStep: {
              traffic: +(s.trafficMs / totalSimSteps).toFixed(3),
              pedestrians: +(s.pedsMs / totalSimSteps).toFixed(3),
              physicsCollision: +(s.physicsMs / totalSimSteps).toFixed(3),
              routing: +(s.routeMs / totalSimSteps).toFixed(3),
              hudMinimap: +(s.hudMs / totalSimSteps).toFixed(3),
              worldEnv: +(s.envMs / totalSimSteps).toFixed(3),
            },
            drawCalls: info.render.calls,
            triangles: info.render.triangles,
            geometries: info.memory.geometries,
            textures: info.memory.textures,
            materials: mats.size,
            programs: info.programs ? info.programs.length : 0,
            texMemMB: +(texBytes / (1024 * 1024)).toFixed(2),
            visibleObjects,
            totalObjects,
            shadowCasters,
            longTasks: window.__btLongTasks.length,
            maxLongTaskMs: window.__btLongTasks.length ? +Math.max(...window.__btLongTasks).toFixed(1) : 0,
          };
        },
        { framesToRender, simFramesPerRender, setupSrc: `(${setupFn.toString()})(g);` },
      );

      const heapBeforeGC = await cdp.send('Runtime.getHeapUsage');
      await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
      const heapAfterGC = await cdp.send('Runtime.getHeapUsage');
      const dom = await cdp.send('Memory.getDOMCounters').catch(() => ({ nodes: 0, jsEventListeners: 0 }));

      const row = {
        scenario: name,
        ...raw,
        jsHeapBeforeGcMB: +(heapBeforeGC.usedSize / (1024 * 1024)).toFixed(2),
        jsHeapRetainedMB: +(heapAfterGC.usedSize / (1024 * 1024)).toFixed(2),
        allocDeltaMB: +((heapBeforeGC.usedSize - heapStart.usedSize) / (1024 * 1024)).toFixed(2),
        domNodes: dom.nodes,
        listeners: dom.jsEventListeners,
      };
      console.log(
        `[${name}] calls=${row.drawCalls} tris=${row.triangles} casters=${row.shadowCasters} ` +
          `sim=${row.simAvgMs}ms (traf=${row.subsystemsMsPerSimStep.traffic} ped=${row.subsystemsMsPerSimStep.pedestrians} hud=${row.subsystemsMsPerSimStep.hudMinimap}) ` +
          `render=${row.renderSubmitAvgMs}ms (cold=${row.coldRenderMs}ms) p50=${row.frameP50Ms}ms p95=${row.frameP95Ms}ms ` +
          `heap=${row.jsHeapRetainedMB}MB (+${row.allocDeltaMB}MB churn) dom=${row.domNodes}/${row.listeners}`,
      );
      return row;
    }

    const scenarios = [];

    // 1. Main menu (Balanced)
    scenarios.push(
      await measureScenario('1_main_menu', 24, 3, (g) => {
        g.debugSetQuality('balanced');
        g.returnToMenu();
      }),
    );

    // 2. Normal street driving (Balanced)
    scenarios.push(
      await measureScenario('2_normal_street_driving', 28, 4, (g) => {
        g.debugSetQuality('balanced');
        g.debugStartMode('free');
        g.debugTeleport(-62, 74, 0.45);
        g.debugInput = { throttle: 0.85, steer: 0.04, brake: 0 };
      }),
    );

    // 3. Dense Town Hall Market (Balanced)
    scenarios.push(
      await measureScenario('3_dense_town_hall_market', 28, 4, (g) => {
        g.debugSetQuality('balanced');
        g.debugStartMode('free');
        g.debugTeleport(2, 92, 1.2);
        g.debugInput = { throttle: 0.75, steer: -0.05, brake: 0 };
      }),
    );

    // 4. Heavy traffic jam (Balanced — converge queue around Asad Ave x Sher Shah Suri Rd)
    scenarios.push(
      await measureScenario('4_heavy_traffic_jam', 28, 4, (g) => {
        g.debugSetQuality('balanced');
        g.debugStartMode('duty');
        if (!g.pendingOffer) g.requestJob(false);
        g.debugAcceptOffer();
        g.debugTeleport(-22, 96, 1.35);
        for (let i = 0; i < 240; i++) g.update(1 / 60);
        g.debugInput = { throttle: 0.65, steer: 0.08, brake: 0 };
      }),
    );

    // 5. Maximum current pedestrian & vehicle density (High preset: 46 vehicles, 98 pedestrians, 1536 shadow map)
    scenarios.push(
      await measureScenario('5_max_density_high', 24, 4, (g) => {
        g.debugSetQuality('high');
        g.debugStartMode('free');
        g.debugTeleport(-18, 98, 1.3);
        g.debugInput = { throttle: 0.85, steer: 0.03, brake: 0 };
      }),
    );

    // 6. All 7 camera modes including rapid switching
    scenarios.push(
      await measureScenario('6_all_7_cameras_rapid_switch', 28, 3, (g) => {
        g.debugSetQuality('balanced');
        g.debugStartMode('free');
        g.debugTeleport(-12, 95, 1.15);
        g.debugInput = { throttle: 0.8, steer: 0.12, brake: 0 };
        for (let i = 0; i < 14; i++) {
          g.toggleCamera();
          g.update(1 / 60);
        }
        g.setCameraMode('chase');
      }),
    );

    // 7. Long continuous drive (3,600 simulation steps = 60s continuous drive)
    scenarios.push(
      await measureScenario('7_long_continuous_drive', 30, 120, (g) => {
        g.debugSetQuality('balanced');
        g.debugStartMode('free');
        g.recoverRickshaw();
        g.debugInput = { throttle: 0.9, steer: 0.06, brake: 0 };
      }),
    );

    // 8. Garage & Dokan showroom
    scenarios.push(
      await measureScenario('8_garage_and_dokan_showroom', 24, 3, (g) => {
        g.debugInput = null;
        g.debugSetQuality('balanced');
        g.ui.openGarage('menu');
        g.previewVehicleInShowroom('roadster');
        g.ui.closeGarage();
        g.ui.openStore();
        g.previewVehicleInShowroom('electric');
      }),
    );

    // 9. Repeated mission start/completion (x8 full missions)
    scenarios.push(
      await measureScenario('9_repeated_missions_x8', 24, 4, (g) => {
        g.ui.closeStore();
        g.debugSetQuality('balanced');
        g.debugStartMode('duty');
        for (let m = 0; m < 8; m++) {
          if (!g.pendingOffer) g.requestJob(false);
          g.debugAcceptOffer();
          g.debugTeleportToPickup();
          g.debugStepUntil(() => g.debugSnapshot().missionState === 'toDropoff', 14);
          g.debugTeleportToDropoff();
          g.debugStepUntil(() => g.debugSnapshot().missionState === 'complete', 12);
          g.nextJob();
        }
      }),
    );

    // 10. Sustained 15-minute gameplay session (54,000 fixed 60Hz steps = 900s = 15.0 minutes!)
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
    const sustainedHeap0 = (await cdp.send('Runtime.getHeapUsage')).usedSize / (1024 * 1024);
    const checkpoints = [];
    for (const minuteMark of [5, 10, 15]) {
      const snap = await page.evaluate((minMark) => {
        const g = window.__banglarTesla;
        if (minMark === 5) {
          g.debugSetQuality('balanced');
          g.debugStartMode('duty');
        }
        // 5 minutes = 300 seconds = 18,000 simulation steps
        const t0 = performance.now();
        for (let step = 0; step < 18000; step++) {
          if (step % 900 === 0) {
            // Periodic player steering, camera switch, bell ring & recovery if against curb
            if (g.controller.stuck) g.recoverRickshaw();
            g.debugInput = {
              throttle: 0.85,
              steer: Math.sin(step / 900) * 0.22,
              brake: 0,
            };
          }
          if (step % 3600 === 1800) g.toggleCamera();
          if (step % 2400 === 600) g.ringBell();
          g.update(1 / 60);
          if (step % 600 === 0) g.render();
        }
        g.debugInput = null;
        g.setCameraMode('chase');
        const wallMs = performance.now() - t0;
        const r0 = performance.now();
        g.render();
        const renderMs = performance.now() - r0;
        return {
          minuteMark: minMark,
          simMsPerStep: +(wallMs / 18000).toFixed(3),
          renderMs: +renderMs.toFixed(2),
          geoms: g.renderer.info.memory.geometries,
          tex: g.renderer.info.memory.textures,
          calls: g.renderer.info.render.calls,
          tris: g.renderer.info.render.triangles,
        };
      }, minuteMark);
      await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
      const hUsed = (await cdp.send('Runtime.getHeapUsage')).usedSize / (1024 * 1024);
      const domC = await cdp.send('Memory.getDOMCounters').catch(() => ({ nodes: 0, jsEventListeners: 0 }));
      checkpoints.push({
        ...snap,
        retainedHeapMB: +hUsed.toFixed(2),
        heapGrowthFromStartMB: +(hUsed - sustainedHeap0).toFixed(2),
        domNodes: domC.nodes,
        listeners: domC.jsEventListeners,
      });
      console.log(`[10_sustained_${minuteMark}min]`, JSON.stringify(checkpoints[checkpoints.length - 1]));
    }

    // Phase 2 Controlled Bottleneck Ablation Matrix
    const ablations = [];
    if (runAblation) {
      console.log('\n--- Phase 2 Controlled Bottleneck Ablation Experiments (Town Hall Market, Balanced) ---');
      const runAbl = async (label, mutator) => {
        const res = await page.evaluate(
          ({ mutSrc }) => {
            const g = window.__banglarTesla;
            g.debugSetQuality('balanced');
            g.debugStartMode('free');
            g.debugTeleport(2, 92, 1.2);
            const savedEnv = g.scene.environment;
            const fn = new Function('g', mutSrc);
            const cleanup = fn(g);

            // Warm 2 frames so shader recompile isn't mixed into steady measurement
            g.render();
            g.render();

            const u0 = performance.now();
            for (let i = 0; i < 120; i++) g.update(1 / 60);
            const simOnlyMs = (performance.now() - u0) / 120;

            const rTimes = [];
            for (let i = 0; i < 20; i++) {
              const r0 = performance.now();
              g.render();
              rTimes.push(performance.now() - r0);
            }
            rTimes.sort((a, b) => a - b);
            const renderMedianMs = rTimes[Math.floor(rTimes.length / 2)];
            const calls = g.renderer.info.render.calls;
            const tris = g.renderer.info.render.triangles;
            const progs = g.renderer.info.programs ? g.renderer.info.programs.length : 0;

            if (typeof cleanup === 'function') cleanup();
            g.scene.environment = savedEnv;
            g.debugSetQuality('balanced');
            return {
              simOnlyMs: +simOnlyMs.toFixed(3),
              renderMedianMs: +renderMedianMs.toFixed(2),
              calls,
              tris,
              progs,
            };
          },
          { mutSrc: `return (${mutator.toString()})(g);` },
        );
        const row = { experiment: label, ...res };
        console.log('[ablation]', JSON.stringify(row));
        return row;
      };

      ablations.push(await runAbl('A_full_balanced_baseline', () => () => {}));
      ablations.push(
        await runAbl('B_shadows_disabled', (g) => {
          g.renderer.shadowMap.enabled = false;
          g.env.sun.castShadow = false;
          return () => {
            g.renderer.shadowMap.enabled = true;
            g.env.sun.castShadow = true;
          };
        }),
      );
      ablations.push(
        await runAbl('C_world_ibl_disabled', (g) => {
          g.scene.environment = null;
          return () => {};
        }),
      );
      ablations.push(
        await runAbl('D_traffic_hidden', (g) => {
          g.traffic.group.visible = false;
          return () => {
            g.traffic.group.visible = true;
          };
        }),
      );
      ablations.push(
        await runAbl('E_pedestrians_hidden', (g) => {
          g.peds.group.visible = false;
          return () => {
            g.peds.group.visible = true;
          };
        }),
      );
      ablations.push(
        await runAbl('F_m21_dpr_1_35_vs_1_0', (g) => {
          g.renderer.setPixelRatio(1.35);
          return () => {
            g.renderer.setPixelRatio(1.0);
          };
        }),
      );
    }

    const report = {
      tag: tagArg,
      timestamp: new Date().toISOString(),
      environment: {
        ...envCapabilities,
        platform: 'Linux Headless Chromium + SwiftShader (not physical Galaxy M21 silicon)',
        viewport: '915x412',
      },
      scenarios,
      sustained15Min: checkpoints,
      ablations,
    };

    const outPath = path.join(artifacts, `benchmark-${tagArg}.json`);
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(`\nSaved full benchmark report -> ${outPath}`);
  } finally {
    await teardownHarness(browser, server);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
