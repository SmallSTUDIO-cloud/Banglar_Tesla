/**
 * On-device performance benchmark (v0.8.0 hybrid-graphics gate).
 *
 * Why this exists: the only honest way to decide whether a graphics upgrade is
 * affordable is to measure the *actual target hardware*. Desktop CI runs inside a
 * software rasteriser (SwiftShader), where frame time is dominated by CPU
 * rasterisation and says nothing about a phone GPU. This module runs the same
 * protocol on the real device and prints the numbers on screen, so a mid-range
 * Android phone can produce the evidence needed to approve or reject a change.
 *
 * Activation is opt-in and costs nothing at boot:
 *
 *     <game-url>?bench=1          benchmark every preset
 *     <game-url>?bench=1&preset=balanced
 *
 * It is loaded through a dynamic `import()`, so it is not part of the normal
 * startup bundle, and it never changes saved settings: the player's quality
 * preset is captured up front and restored when the run finishes.
 *
 * The measurement protocol mirrors `tests/e2e/bench-street.mjs` exactly
 * (same street section, same warmup, same frame-count sampling) so device and
 * CI numbers are directly comparable on the metrics that transfer: draw calls,
 * triangles, texture bytes, JS heap.
 */

import type * as THREE from 'three';
import type { Game } from '../game';
import type { QualityPreset } from './config';
import { APP_BUILD, APP_BUILD_LABEL } from './version';

/** The benchmarked street section: Asad Avenue through Town Hall Bazar. */
export const BENCH_SECTION = {
  name: 'Asad Avenue / Town Hall Bazar',
  staticEye: { x: 52, y: 2.2, z: 100 },
  staticTarget: { x: 83, y: 2.4, z: 104 },
} as const;

const WARMUP_FRAMES = 40;
const SAMPLE_FRAMES = 240;
const PRESETS: QualityPreset[] = ['low', 'balanced', 'high'];

export interface BenchScenario {
  frames: number;
  fps: number;
  frameMsMean: number;
  frameMsP50: number;
  frameMsP95: number;
  frameMsP99: number;
  frameMsWorst: number;
  drawCalls: number;
  drawCallsMax: number;
  triangles: number;
}

export interface BenchResources {
  gpuTextureMB: number;
  uniqueTextures: number;
  textureSlots: number;
  geometries: number;
  shaderPrograms: number;
  jsHeapMB: number | null;
}

export interface BenchRun {
  preset: QualityPreset;
  scenario: BenchScenario;
  resources: BenchResources;
}

export interface BenchReport {
  build: string;
  device: {
    userAgent: string;
    hardwareConcurrency: number | null;
    devicePixelRatio: number;
    glRenderer: string;
    glVendor: string;
    maxTextureSize: number;
    viewport: string;
  };
  section: string;
  runs: BenchRun[];
  generatedAt: string;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[i];
}

const round = (n: number, d = 2): number => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

/** Sample `frames` frames, returning inter-frame intervals plus render counters. */
function sampleFrames(game: Game, frames: number): Promise<BenchScenario> {
  return new Promise((resolve) => {
    const intervals: number[] = [];
    const calls: number[] = [];
    const tris: number[] = [];
    let last = performance.now();
    const tick = (): void => {
      const now = performance.now();
      intervals.push(now - last);
      last = now;
      const info = game.renderer.info.render;
      calls.push(info.calls);
      tris.push(info.triangles);
      if (intervals.length < frames) {
        requestAnimationFrame(tick);
        return;
      }
      // Drop the first 10%: GC, texture upload and shader compile land there.
      const settled = intervals.slice(Math.floor(intervals.length * 0.1)).filter((f) => f > 0);
      const sorted = [...settled].sort((a, b) => a - b);
      const mean = settled.reduce((a, b) => a + b, 0) / Math.max(1, settled.length);
      const sortedCalls = [...calls].sort((a, b) => a - b);
      const sortedTris = [...tris].sort((a, b) => a - b);
      resolve({
        frames: settled.length,
        fps: round(1000 / mean, 1),
        frameMsMean: round(mean),
        frameMsP50: round(percentile(sorted, 50)),
        frameMsP95: round(percentile(sorted, 95)),
        frameMsP99: round(percentile(sorted, 99)),
        frameMsWorst: round(sorted[sorted.length - 1] ?? 0),
        drawCalls: Math.round(percentile(sortedCalls, 50)),
        drawCallsMax: sortedCalls[sortedCalls.length - 1] ?? 0,
        triangles: Math.round(percentile(sortedTris, 50)),
      });
    };
    requestAnimationFrame(tick);
  });
}

/** Unique texture uploads in bytes, including the mipmap chain. */
function textureBytes(scene: THREE.Scene): { bytes: number; unique: number } {
  const seen = new Set<string>();
  let bytes = 0;
  scene.traverse((obj) => {
    const material = (obj as THREE.Mesh).material;
    if (!material) return;
    const list = Array.isArray(material) ? material : [material];
    for (const mat of list) {
      for (const key of Object.keys(mat)) {
        const value = (mat as unknown as Record<string, unknown>)[key] as
          | (THREE.Texture & { image?: { width?: number; height?: number } })
          | undefined;
        if (!value || !value.isTexture || !value.image) continue;
        if (seen.has(value.uuid)) continue;
        seen.add(value.uuid);
        const w = value.image.width ?? 0;
        const h = value.image.height ?? 0;
        if (!w || !h) continue;
        bytes += w * h * 4 * 1.3333; // RGBA8 + ~33% mip chain
      }
    }
  });
  return { bytes: Math.round(bytes), unique: seen.size };
}

function deviceInfo(game: Game, canvas: HTMLCanvasElement): BenchReport['device'] {
  const gl = game.renderer.getContext();
  let glRenderer = 'unavailable';
  let glVendor = 'unavailable';
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  if (dbg) {
    glRenderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL));
    glVendor = String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL));
  } else {
    glRenderer = String(gl.getParameter(gl.RENDERER));
    glVendor = String(gl.getParameter(gl.VENDOR));
  }
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return {
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    devicePixelRatio: window.devicePixelRatio,
    glRenderer,
    glVendor,
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    viewport: `${canvas.width}x${canvas.height}${mem ? '' : ' (heap n/a)'}`,
  };
}

/** Run the protocol once for a single preset. */
async function runPreset(game: Game, preset: QualityPreset): Promise<BenchRun> {
  game.debugStartMode('free');
  game.debugSetPhase('golden', 'sunny');
  game.ui.show(null);
  game.debugSetQuality(preset);
  game.debugSetFreeCamera(true);
  game.camera.position.set(
    BENCH_SECTION.staticEye.x,
    BENCH_SECTION.staticEye.y,
    BENCH_SECTION.staticEye.z,
  );
  game.camera.lookAt(
    BENCH_SECTION.staticTarget.x,
    BENCH_SECTION.staticTarget.y,
    BENCH_SECTION.staticTarget.z,
  );
  game.camera.fov = 58;
  game.camera.updateProjectionMatrix();

  // Warm up so shader compilation and texture upload are not measured.
  await sampleFrames(game, WARMUP_FRAMES);
  const scenario = await sampleFrames(game, SAMPLE_FRAMES);

  const tex = textureBytes(game.scene);
  const info = game.renderer.info;
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return {
    preset,
    scenario,
    resources: {
      gpuTextureMB: round(tex.bytes / (1024 * 1024), 2),
      uniqueTextures: tex.unique,
      textureSlots: info.memory.textures,
      geometries: info.memory.geometries,
      shaderPrograms: info.programs?.length ?? -1,
      jsHeapMB: mem ? round(mem.usedJSHeapSize / (1024 * 1024), 1) : null,
    },
  };
}

function reportToText(report: BenchReport): string {
  const lines: string[] = [];
  lines.push('BANGLAR TESLA — DEVICE BENCHMARK');
  lines.push(`build:     ${report.build}  (sha ${APP_BUILD})`);
  lines.push(`generated: ${report.generatedAt}`);
  lines.push(`section:   ${report.section}`);
  lines.push('');
  lines.push('--- device ---');
  lines.push(`gpu:       ${report.device.glRenderer}`);
  lines.push(`vendor:    ${report.device.glVendor}`);
  lines.push(`cores:     ${report.device.hardwareConcurrency}`);
  lines.push(`dpr:       ${report.device.devicePixelRatio}`);
  lines.push(`viewport:  ${report.device.viewport}`);
  lines.push(`maxTex:    ${report.device.maxTextureSize}`);
  lines.push(`ua:        ${report.device.userAgent}`);
  lines.push('');
  lines.push('--- frame timing (ms) ---');
  lines.push('preset    fps    mean    p50    p95    p99   worst');
  for (const r of report.runs) {
    const s = r.scenario;
    lines.push(
      `${r.preset.padEnd(9)} ${String(s.fps).padStart(5)} ${String(s.frameMsMean).padStart(7)} ` +
        `${String(s.frameMsP50).padStart(6)} ${String(s.frameMsP95).padStart(6)} ` +
        `${String(s.frameMsP99).padStart(6)} ${String(s.frameMsWorst).padStart(7)}`,
    );
  }
  lines.push('');
  lines.push('--- scene cost ---');
  lines.push('preset    calls  callsMax  triangles');
  for (const r of report.runs) {
    const s = r.scenario;
    lines.push(
      `${r.preset.padEnd(9)} ${String(s.drawCalls).padStart(5)} ${String(s.drawCallsMax).padStart(9)} ` +
        `${String(s.triangles).padStart(10)}`,
    );
  }
  lines.push('');
  lines.push('--- memory ---');
  lines.push('preset    gpuTexMB  uniqTex  slots  geoms  programs  jsHeapMB');
  for (const r of report.runs) {
    const x = r.resources;
    lines.push(
      `${r.preset.padEnd(9)} ${String(x.gpuTextureMB).padStart(8)} ${String(x.uniqueTextures).padStart(8)} ` +
        `${String(x.textureSlots).padStart(6)} ${String(x.geometries).padStart(6)} ` +
        `${String(x.shaderPrograms).padStart(9)} ${String(x.jsHeapMB ?? 'n/a').padStart(9)}`,
    );
  }
  return lines.join('\n');
}

function showPanel(text: string): void {
  const wrap = document.createElement('div');
  wrap.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:300', 'background:#07110e',
    'color:#eaf3ec', 'font:12px/1.45 ui-monospace,Menlo,Consolas,monospace',
    'padding:12px', 'overflow:auto', '-webkit-overflow-scrolling:touch',
  ].join(';');
  const title = document.createElement('div');
  title.textContent = 'DEVICE BENCHMARK — long-press to select, then copy';
  title.style.cssText = 'font-weight:700;margin-bottom:8px;color:#9ad46a';
  const pre = document.createElement('pre');
  pre.textContent = text;
  pre.style.cssText = 'white-space:pre-wrap;word-break:break-word;margin:0 0 14px;user-select:text';
  const btns = document.createElement('div');
  btns.style.cssText = 'display:flex;gap:8px;position:sticky;bottom:0;padding-top:8px';
  const copy = document.createElement('button');
  copy.textContent = 'Copy results';
  copy.style.cssText =
    'flex:1;padding:12px;border-radius:10px;border:1px solid #2f6b4f;background:#12432f;color:#eaf3ec;font:600 14px sans-serif';
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = 'Copied';
    } catch {
      copy.textContent = 'Select the text above';
    }
  };
  const close = document.createElement('button');
  close.textContent = 'Close';
  close.style.cssText =
    'flex:1;padding:12px;border-radius:10px;border:1px solid #444;background:#1b2521;color:#eaf3ec;font:600 14px sans-serif';
  close.onclick = () => wrap.remove();
  btns.append(copy, close);
  wrap.append(title, pre, btns);
  document.body.append(wrap);
}

/**
 * Entry point. Safe to call only after `game.init()` and `game.start()`.
 * Restores the player's original quality preset before returning.
 */
export async function runDeviceBenchmark(
  game: Game,
  opts: { preset?: QualityPreset } = {},
): Promise<BenchReport> {
  const originalPreset = game.settings.get().quality as QualityPreset;
  const canvas = game.renderer.domElement;
  const presets = opts.preset ? [opts.preset] : PRESETS;

  const report: BenchReport = {
    build: APP_BUILD_LABEL,
    device: deviceInfo(game, canvas),
    section: BENCH_SECTION.name,
    runs: [],
    generatedAt: new Date().toISOString(),
  };

  for (const preset of presets) {
    report.runs.push(await runPreset(game, preset));
  }

  // Never leave the player's settings changed by a measurement run.
  game.debugSetQuality(originalPreset);
  showPanel(reportToText(report));
  return report;
}

/** True when the page was opened with `?bench=1`. */
export function benchRequested(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('bench') === '1';
  } catch {
    return false;
  }
}

/** Optional `?preset=` override, validated against the known presets. */
export function benchPresetFromUrl(): QualityPreset | undefined {
  try {
    const p = new URLSearchParams(window.location.search).get('preset');
    return PRESETS.includes(p as QualityPreset) ? (p as QualityPreset) : undefined;
  } catch {
    return undefined;
  }
}
