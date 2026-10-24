/**
 * Development-only Performance & Memory Telemetry Overlay (Section 4).
 *
 * Strictly hidden from normal release UI:
 *   - No toggle button is shown in standard player HUD or Settings.
 *   - Activates ONLY via `?devperf=1` query string or developer keyboard
 *     shortcut `F3` / `Ctrl+Shift+P` (or `window.__btToggleDevPerf()`).
 */

import type * as THREE from 'three';

export interface DevPerfSnapshot {
  fps: number;
  frameMs: number;
  p95Ms: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  activeVehicles: number;
  activePedestrians: number;
  jammedCorridors: number;
  jsHeapMB: number | null;
}

export class DevPerfOverlay {
  private el: HTMLDivElement;
  private enabled = false;
  private frameSamples = new Float32Array(90);
  private sampleIdx = 0;
  private sampleCount = 0;
  private accumTime = 0;
  private lastSnapshot: DevPerfSnapshot = {
    fps: 60,
    frameMs: 16.6,
    p95Ms: 16.6,
    drawCalls: 0,
    triangles: 0,
    geometries: 0,
    textures: 0,
    programs: 0,
    activeVehicles: 0,
    activePedestrians: 0,
    jammedCorridors: 0,
    jsHeapMB: null,
  };

  constructor() {
    this.el = document.createElement('div');
    this.el.setAttribute('data-dev-perf', 'true');
    this.el.style.cssText =
      'position:fixed;left:10px;top:calc(env(safe-area-inset-top,0px) + 58px);z-index:900;' +
      'font:600 11px/1.38 ui-monospace,SFMono-Regular,Menlo,monospace;color:#b8ffdf;' +
      'background:rgba(8,14,12,0.84);border:1px solid rgba(92,228,172,0.35);' +
      'padding:7px 9px;border-radius:8px;pointer-events:none;white-space:pre;display:none;';
    document.body.append(this.el);

    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('devperf') === '1') {
        this.setEnabled(true);
      }
    } catch {
      /* ignore URL parse issues */
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.el.style.display = on ? 'block' : 'none';
  }

  toggle(): boolean {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  snapshot(): DevPerfSnapshot {
    return { ...this.lastSnapshot };
  }

  update(
    dt: number,
    renderer: THREE.WebGLRenderer,
    activeVehicles: number,
    activePedestrians: number,
    jammedCorridors: number,
  ): void {
    const ms = dt * 1000;
    this.frameSamples[this.sampleIdx] = ms;
    this.sampleIdx = (this.sampleIdx + 1) % this.frameSamples.length;
    if (this.sampleCount < this.frameSamples.length) this.sampleCount++;

    this.accumTime += dt;
    if (this.accumTime < 0.25) return;
    this.accumTime = 0;

    let sum = 0;
    const sorted: number[] = [];
    for (let i = 0; i < this.sampleCount; i++) {
      const v = this.frameSamples[i];
      sum += v;
      sorted.push(v);
    }
    sorted.sort((a, b) => a - b);
    const avgMs = this.sampleCount > 0 ? sum / this.sampleCount : 16.6;
    const p95Ms = sorted.length > 0 ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : avgMs;
    const fps = avgMs > 0.01 ? 1000 / avgMs : 60;

    const info = renderer.info;
    const programs = (info as unknown as { programs?: unknown[] }).programs?.length ?? 0;
    const perfMem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const heapMB = perfMem ? Math.round((perfMem.usedJSHeapSize / (1024 * 1024)) * 100) / 100 : null;

    this.lastSnapshot = {
      fps: Math.round(fps * 10) / 10,
      frameMs: Math.round(avgMs * 100) / 100,
      p95Ms: Math.round(p95Ms * 100) / 100,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs,
      activeVehicles,
      activePedestrians,
      jammedCorridors,
      jsHeapMB: heapMB,
    };

    if (!this.enabled) return;
    this.el.textContent =
      `[DEV PERF]\n` +
      `FPS: ${this.lastSnapshot.fps.toFixed(1)} (${this.lastSnapshot.frameMs.toFixed(1)}ms | p95 ${this.lastSnapshot.p95Ms.toFixed(1)}ms)\n` +
      `Draws: ${this.lastSnapshot.drawCalls} | Tris: ${this.lastSnapshot.triangles.toLocaleString()}\n` +
      `Geoms: ${this.lastSnapshot.geometries} | Tex: ${this.lastSnapshot.textures} | Shaders: ${this.lastSnapshot.programs}\n` +
      `Traffic: ${activeVehicles} (Jams: ${jammedCorridors}) | Peds: ${activePedestrians}` +
      (heapMB !== null ? `\nJS Heap: ${heapMB.toFixed(2)} MB` : '');
  }

  dispose(): void {
    this.el.remove();
  }
}
