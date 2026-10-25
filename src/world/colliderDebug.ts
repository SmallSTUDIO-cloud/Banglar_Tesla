/**
 * Optional DEV-only 3D Collider Debug Visualizer (Section 3).
 *
 * Completely dormant (zero geometries/draw calls/allocations) unless explicitly
 * toggled via `?devcolliders=1`, `F4`, or `window.__btToggleColliderDebug()`.
 * Renders:
 *   - Player rickshaw two-circle capsule + compact chassis outline (cyan)
 *   - Nearby traffic / rival / police vehicle OBBs (amber)
 *   - Nearby prop / building / roadblock OBBs (emerald; hidden immediately if disabled)
 *   - Last collision contact point + outward surface normal arrow (magenta)
 */

import * as THREE from 'three';
import { RIDE } from '../core/config';
import type { BoxCollider, ContactDebugInfo } from '../vehicle/rickshawController';
import type { TrafficObstacle } from '../ai/traffic';

const MAX_SEGMENTS = 1200; // 2400 vertices * 3 floats

export class DevColliderDebugView {
  private enabled = false;
  private lineMesh: THREE.LineSegments | null = null;
  private posBuf: Float32Array | null = null;
  private colBuf: Float32Array | null = null;
  private vertCursor = 0;

  constructor(private readonly scene: THREE.Scene) {}

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) {
      if (this.lineMesh) this.lineMesh.visible = false;
      return;
    }
    this.ensureCreated();
    if (this.lineMesh) this.lineMesh.visible = true;
  }

  toggle(): boolean {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  private ensureCreated(): void {
    if (this.lineMesh) return;
    this.posBuf = new Float32Array(MAX_SEGMENTS * 2 * 3);
    this.colBuf = new Float32Array(MAX_SEGMENTS * 2 * 3);
    const geo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(this.posBuf, 3);
    const colAttr = new THREE.BufferAttribute(this.colBuf, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    colAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', posAttr);
    geo.setAttribute('color', colAttr);
    geo.setDrawRange(0, 0);
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      depthTest: false,
      transparent: true,
      opacity: 0.92,
    });
    this.lineMesh = new THREE.LineSegments(geo, mat);
    this.lineMesh.name = 'dev-collider-debug';
    this.lineMesh.frustumCulled = false;
    this.lineMesh.renderOrder = 999;
    this.scene.add(this.lineMesh);
  }

  private pushSeg(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    r: number,
    g: number,
    b: number,
  ): void {
    if (!this.posBuf || !this.colBuf) return;
    if (this.vertCursor + 2 > MAX_SEGMENTS * 2) return;
    const base = this.vertCursor * 3;
    this.posBuf[base] = x0;
    this.posBuf[base + 1] = y0;
    this.posBuf[base + 2] = z0;
    this.posBuf[base + 3] = x1;
    this.posBuf[base + 4] = y1;
    this.posBuf[base + 5] = z1;

    this.colBuf[base] = r;
    this.colBuf[base + 1] = g;
    this.colBuf[base + 2] = b;
    this.colBuf[base + 3] = r;
    this.colBuf[base + 4] = g;
    this.colBuf[base + 5] = b;
    this.vertCursor += 2;
  }

  private pushCircle(
    cx: number,
    y: number,
    cz: number,
    radius: number,
    r: number,
    g: number,
    b: number,
    steps = 12,
  ): void {
    let px = cx + radius;
    let pz = cz;
    for (let i = 1; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const nx = cx + Math.cos(a) * radius;
      const nz = cz + Math.sin(a) * radius;
      this.pushSeg(px, y, pz, nx, y, nz, r, g, b);
      px = nx;
      pz = nz;
    }
  }

  private pushObb(
    cx: number,
    y: number,
    cz: number,
    halfX: number,
    halfZ: number,
    yaw: number,
    r: number,
    g: number,
    b: number,
  ): void {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const x0 = cx + -halfX * c + -halfZ * s;
    const z0 = cz - -halfX * s + -halfZ * c;
    const x1 = cx + halfX * c + -halfZ * s;
    const z1 = cz - halfX * s + -halfZ * c;
    const x2 = cx + halfX * c + halfZ * s;
    const z2 = cz - halfX * s + halfZ * c;
    const x3 = cx + -halfX * c + halfZ * s;
    const z3 = cz - -halfX * s + halfZ * c;
    this.pushSeg(x0, y, z0, x1, y, z1, r, g, b);
    this.pushSeg(x1, y, z1, x2, y, z2, r, g, b);
    this.pushSeg(x2, y, z2, x3, y, z3, r, g, b);
    this.pushSeg(x3, y, z3, x0, y, z0, r, g, b);
  }

  update(
    px: number,
    py: number,
    pz: number,
    pyaw: number,
    staticColliders: readonly BoxCollider[],
    trafficObstacles: readonly TrafficObstacle[],
    lastContact: ContactDebugInfo,
    extraObbs?: readonly { cx: number; cz: number; halfX: number; halfZ: number; yaw: number; disabled?: boolean }[],
  ): void {
    if (!this.enabled || !this.lineMesh) return;
    this.vertCursor = 0;
    const y = py + 0.22;

    // 1. Player two-circle capsule + chassis hull (bright cyan)
    const fx = Math.sin(pyaw);
    const fz = Math.cos(pyaw);
    this.pushCircle(px + fx * RIDE.frontCircleZ, y, pz + fz * RIDE.frontCircleZ, 0.47, 0.1, 0.95, 1.0);
    this.pushCircle(
      px + fx * RIDE.rearCircleZ,
      y,
      pz + fz * RIDE.rearCircleZ,
      RIDE.circleRadius,
      0.1,
      0.95,
      1.0,
    );
    this.pushObb(px, y, pz, RIDE.bodyHalfWidth, RIDE.bodyHalfLength, pyaw, 0.0, 0.78, 1.0);

    // 2. Nearby traffic vehicle OBBs (amber)
    for (let i = 0; i < trafficObstacles.length; i++) {
      const ob = trafficObstacles[i];
      this.pushObb(ob.x, y + 0.05, ob.z, ob.halfWidth, ob.halfLength, ob.yaw, 1.0, 0.72, 0.12);
    }

    // 3. Nearby static world colliders within 22m (emerald for props, blue-green for buildings)
    for (let i = 0; i < staticColliders.length; i++) {
      const col = staticColliders[i];
      if (col.disabled || col.height < 0.35) continue;
      const cx = col.cx ?? (col.minX + col.maxX) * 0.5;
      const cz = col.cz ?? (col.minZ + col.maxZ) * 0.5;
      const dx = cx - px;
      const dz = cz - pz;
      if (dx * dx + dz * dz > 22 * 22) continue;
      const hx = col.halfX ?? (col.maxX - col.minX) * 0.5;
      const hz = col.halfZ ?? (col.maxZ - col.minZ) * 0.5;
      const cyaw = col.yaw ?? 0;
      const isProp = col.breakableId !== undefined || hx < 2.2;
      this.pushObb(
        cx,
        y + 0.02,
        cz,
        hx,
        hz,
        cyaw,
        isProp ? 0.2 : 0.35,
        isProp ? 0.95 : 0.65,
        isProp ? 0.45 : 0.85,
      );
    }

    // 4. Extra roadblock / dynamic OBBs (bright red-orange)
    if (extraObbs) {
      for (let i = 0; i < extraObbs.length; i++) {
        const eb = extraObbs[i];
        if (eb.disabled) continue;
        this.pushObb(eb.cx, y + 0.08, eb.cz, eb.halfX, eb.halfZ, eb.yaw, 1.0, 0.32, 0.2);
      }
    }

    // 5. Last contact point & outward normal (magenta)
    if (lastContact.active) {
      const cx = lastContact.x;
      const cz = lastContact.z;
      const cy = py + 0.55;
      this.pushSeg(cx - 0.18, cy, cz, cx + 0.18, cy, cz, 1.0, 0.15, 0.9);
      this.pushSeg(cx, cy, cz - 0.18, cx, cy, cz + 0.18, 1.0, 0.15, 0.9);
      this.pushSeg(
        cx,
        cy,
        cz,
        cx + lastContact.nx * 1.15,
        cy + 0.12,
        cz + lastContact.nz * 1.15,
        1.0,
        0.15,
        0.9,
      );
    }

    const geo = this.lineMesh.geometry;
    geo.setDrawRange(0, this.vertCursor);
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    if (!this.lineMesh) return;
    this.scene.remove(this.lineMesh);
    this.lineMesh.geometry.dispose();
    (this.lineMesh.material as THREE.Material).dispose();
    this.lineMesh = null;
  }
}
