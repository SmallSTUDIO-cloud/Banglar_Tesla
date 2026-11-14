/**
 * Representative-street benchmark (v0.8.0 hybrid-graphics baseline).
 *
 * Benchmarks ONE fixed Mohammadpur street section — Asad Avenue through Town
 * Hall Bazar — because that is the densest verified frontage in the world and
 * therefore the honest worst case for a "typical" street.
 *
 * Reports per quality preset:
 *   FPS, frame-time p50 / p95 / p99, draw calls, triangles,
 *   GPU texture bytes (computed from unique texture uploads), JS heap.
 *
 * Two scenarios:
 *   street-static  fixed camera on the carriageway looking along the bazaar
 *   street-drive   the player accelerates down the same stretch (gameplay-like)
 *
 * IMPORTANT — what these numbers do and do not mean:
 * The sandbox renders with SwiftShader (software GL). FPS/frame-time measured
 * here say NOTHING about a phone's GPU. They are useful only as (a) a relative
 * before/after signal within the same machine and (b) a by-eye check that a
 * change did not blow up cost. Draw calls, triangle counts, texture bytes and
 * JS heap ARE transferable metrics and are reported as such.
 *
 * Usage:
 *   node tests/e2e/bench-street.mjs                 # all presets
 *   node tests/e2e/bench-street.mjs low,balanced    # selected presets
 */

import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { ensureChromiumEnv, teardownHarness } from './chromium-env.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const PORT = 4201;
const BASE = `http://127.0.0.1:${PORT}`;

/** The benchmarked street section: Asad Avenue through Town Hall Bazar. */
const SECTION = {
  name: 'Asad Avenue / Town Hall Bazar',
  // Verified OSM landmark position (see src/world/landmarks.ts).
  landmark: { x: 64.93, z: 98.11 },
  // Fixed static viewpoint: on the carriageway, looking along the frontage.
  staticEye: { x: 52, y: 2.2, z: 100 },
  staticTarget: { x: 83, y: 2.4, z: 104 },
  // Drive start: on asad_4, heading along the segment axis.
  driveStart: { x: 44, z: 105, yaw: Math.atan2(0.96, -0.28) },
};

const WARMUP_MS = 2500;
/**
 * Sampling is frame-count based, not time based. Software GL renders at roughly
 * 1 fps here, so a 6 s window yields ~7 samples and percentiles are noise.
 * Counting frames guarantees a usable distribution regardless of speed; the
 * wall-clock cap only exists so a pathological stall cannot hang the run.
 */
const SAMPLE_FRAMES = 40;
const SAMPLE_MAX_MS = 60000;
const RUNS = 3;

const presets = (process.argv[2] ?? 'low,balanced,high').split(',');

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

const server = spawn(
  path.join(root, 'node_modules/.bin/vite'),
  ['preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
  { cwd: root, stdio: 'ignore' },
);
if (!(await waitFor(BASE))) {
  console.error('FAIL: preview server did not start');
  process.exit(1);
}

const browser = await puppeteer.launch({
  args: [
    ...chromium.args,
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    // Expose performance.memory for the heap reading.
    '--enable-precise-memory-info',
  ],
  executablePath: await chromium.executablePath(),
  headless: 'shell',
  env: ensureChromiumEnv(),
  defaultViewport: { width: 960, height: 540 },
});

const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('!!window.__banglarTesla', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 1200));

/**
 * In-page measurement. Installed once and reused for every preset so the
 * timing code itself is not part of what varies between runs.
 */
async function installProbe() {
  await page.evaluate(() => {
    const g = window.__banglarTesla;

    /** Sum of unique texture uploads in bytes, including the mipmap chain. */
    window.__texBytes = () => {
      const seen = new Set();
      let bytes = 0;
      g.scene.traverse((o) => {
        const mats = o.material
          ? Array.isArray(o.material)
            ? o.material
            : [o.material]
          : [];
        for (const m of mats) {
          for (const key of Object.keys(m)) {
            const t = m[key];
            if (!t || !t.isTexture || !t.image) continue;
            if (seen.has(t.uuid)) continue;
            seen.add(t.uuid);
            const img = t.image;
            const w = img.width ?? 0;
            const h = img.height ?? 0;
            if (!w || !h) continue;
            // RGBA8 + ~33% for a full mip chain.
            bytes += w * h * 4 * 1.3333;
          }
        }
      });
      return { bytes: Math.round(bytes), unique: seen.size };
    };

    window.__sample = (targetFrames, maxMs) =>
      new Promise((resolve) => {
        const frames = [];
        const calls = [];
        const tris = [];
        let last = performance.now();
        const t0 = last;
        const tick = () => {
          const now = performance.now();
          frames.push(now - last);
          last = now;
          const info = g.renderer.info.render;
          calls.push(info.calls);
          tris.push(info.triangles);
          if (frames.length < targetFrames && now - t0 < maxMs) {
            requestAnimationFrame(tick);
          } else {
            resolve({ frames, calls, tris });
          }
        };
        requestAnimationFrame(tick);
      });
  });
}

const pct = (arr, p) => {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.floor((p / 100) * s.length));
  return s[i];
};
const median = (arr) => pct(arr, 50);
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

const results = [];

for (const preset of presets) {
  // --- configure -----------------------------------------------------------
  await page.evaluate(
    (p, section) => {
      const g = window.__banglarTesla;
      g.debugStartMode('free');
      g.debugSetPhase('golden', 'sunny');
      g.ui.show(null);
      g.debugSetQuality(p);
      g.debugFreeCamera = true;
      g.camera.position.set(section.staticEye.x, section.staticEye.y, section.staticEye.z);
      g.camera.lookAt(section.staticTarget.x, section.staticTarget.y, section.staticTarget.z);
      g.camera.fov = 58;
      g.camera.updateProjectionMatrix();
    },
    preset,
    SECTION,
  );

  await installProbe();

  // --- static scenario (repeated to expose run-to-run variance) ------------
  await new Promise((r) => setTimeout(r, WARMUP_MS));
  const staticRuns = [];
  for (let run = 0; run < RUNS; run++) {
    staticRuns.push(
      await page.evaluate((n, cap) => window.__sample(n, cap), SAMPLE_FRAMES, SAMPLE_MAX_MS),
    );
  }
  const staticRaw = {
    frames: staticRuns.flatMap((r) => r.frames),
    calls: staticRuns.flatMap((r) => r.calls),
    tris: staticRuns.flatMap((r) => r.tris),
  };
  const staticTex = await page.evaluate(() => window.__texBytes());
  const staticMem = await page.evaluate(() => ({
    jsHeap: performance.memory ? performance.memory.usedJSHeapSize : null,
    geoms: window.__banglarTesla.renderer.info.memory.geometries,
    textures: window.__banglarTesla.renderer.info.memory.textures,
    programs: window.__banglarTesla.renderer.info.programs?.length ?? null,
  }));

  // --- drive scenario ------------------------------------------------------
  await page.evaluate((section) => {
    const g = window.__banglarTesla;
    g.debugFreeCamera = false;
    g.debugTeleport(section.driveStart.x, section.driveStart.z, section.driveStart.yaw);
  }, SECTION);
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() => window.__banglarTesla.debugHoldInput({ throttle: 1 }, 6000));
  const driveRaw = await page.evaluate((n, cap) => window.__sample(n, cap), SAMPLE_FRAMES, SAMPLE_MAX_MS);

  const summarize = (raw, label) => {
    const frames = raw.frames.filter((f) => f > 0);
    const mean = frames.reduce((a, b) => a + b, 0) / (frames.length || 1);
    return {
      scenario: label,
      frames: frames.length,
      fps: round(1000 / mean),
      frameMsMean: round(mean, 2),
      frameMsP50: round(pct(frames, 50), 2),
      frameMsP95: round(pct(frames, 95), 2),
      frameMsP99: round(pct(frames, 99), 2),
      drawCalls: Math.round(median(raw.calls)),
      drawCallsMax: Math.max(...raw.calls),
      triangles: Math.round(median(raw.tris)),
    };
  };

  results.push({
    preset,
    static: summarize(staticRaw, 'street-static'),
    drive: summarize(driveRaw, 'street-drive'),
    // Spread of per-run median frame times; a change that only "helps" inside
    // the noise band is not a win.
    runP50Spread: round(
      Math.max(...staticRuns.map((r) => pct(r.frames.filter((f) => f > 0), 50))) -
        Math.min(...staticRuns.map((r) => pct(r.frames.filter((f) => f > 0), 50))),
      2,
    ),
    resources: {
      gpuTextureMB: round(staticTex.bytes / (1024 * 1024), 2),
      uniqueTextures: staticTex.unique,
      textureSlots: staticMem.textures,
      geometries: staticMem.geoms,
      shaderPrograms: staticMem.programs,
      jsHeapMB: staticMem.jsHeap ? round(staticMem.jsHeap / (1024 * 1024), 1) : null,
    },
  });
  console.log(`done: ${preset}`);
}

await teardownHarness(browser, server);

if (pageErrors.length) {
  console.log('PAGE ERRORS:', pageErrors.slice(0, 3));
}

console.log(`\n=== ${SECTION.name} (${SECTION.staticEye.x},${SECTION.staticEye.z}) ===`);
console.log(
  'preset    scenario        FPS   p50ms  p95ms  p99ms  calls  tris',
);
for (const r of results) {
  for (const sc of [r.static, r.drive]) {
    console.log(
      `${r.preset.padEnd(9)} ${sc.scenario.padEnd(15)} ${String(sc.fps).padStart(5)} ` +
        `${String(sc.frameMsP50).padStart(6)} ${String(sc.frameMsP95).padStart(6)} ` +
        `${String(sc.frameMsP99).padStart(6)} ${String(sc.drawCalls).padStart(6)} ` +
        `${String(sc.triangles).padStart(8)}`,
    );
  }
}
console.log('\n=== resources (static scenario) ===');
console.log('preset    GPU-tex MB  uniq-tex  slots  geoms  programs  JS-heap MB  p50-spread');
for (const r of results) {
  const x = r.resources;
  console.log(
    `${r.preset.padEnd(9)} ${String(x.gpuTextureMB).padStart(10)} ${String(x.uniqueTextures).padStart(9)} ` +
      `${String(x.textureSlots).padStart(6)} ${String(x.geometries).padStart(6)} ` +
      `${String(x.shaderPrograms).padStart(9)} ${String(x.jsHeapMB ?? 'n/a').padStart(10)} ` +
      `${String(r.runP50Spread).padStart(11)}`,
  );
}

console.log('\nJSON:' + JSON.stringify(results));
