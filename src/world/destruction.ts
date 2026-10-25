/**
 * Pooled, zero-allocation Breakable World Props System (Milestone 3).
 *
 * Covers Mohammadpur street lamps and roadside vendor stalls (`fuchka`, `jhalmuri`,
 * `tea`, `market`) with:
 *   - 0 extra draw calls when idle (intact props live inside merged city/prop chunks)
 *   - At most 2 InstancedMesh draw calls (`debrisMesh` + `sparkDustMesh`, both
 *     `castShadow = false`) during active destruction, even under rapid chain smashes
 *   - Immediate one-shot collider disable (`collider.disabled = true`) so broken
 *     props never retrigger or leave invisible blocking boxes
 *   - Clean reset support (`resetAll()`) restoring intact vertex slices & colliders
 */

import * as THREE from 'three';
import type { VertexSlice } from './geo';
import type { Collider } from './city';
import type { VendorSpot } from './props';
import { clamp } from '../core/mathx';

export type BreakableKind = 'lamp' | 'fuchka' | 'jhalmuri' | 'tea' | 'market';

export interface BreakableProp {
  id: number;
  kind: BreakableKind;
  x: number;
  z: number;
  yaw: number;
  collider: Collider;
  slices: VertexSlice[];
  /** Index into CityResult.lampPositions for street lamps (-1 for stalls). */
  lampIndex?: number;
  /** Reference to VendorSpot for stalls so broken stalls stop serving/hawking. */
  vendorSpot?: VendorSpot;
  broken?: boolean;
  savedPositions?: Float32Array[];
  savedLampY?: number;
}

interface DebrisSlot {
  active: boolean;
  isPolePivot: boolean;
  age: number;
  maxAge: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  vrx: number;
  vry: number;
  vrz: number;
  sx: number;
  sy: number;
  sz: number;
  fallYaw: number;
  fallAngle: number;
  fallVel: number;
  groundY: number;
  r: number;
  g: number;
  b: number;
}

interface PuffSlot {
  active: boolean;
  age: number;
  maxAge: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  gravity: number;
  baseScale: number;
  growScale: number;
  r: number;
  g: number;
  b: number;
}

const MAX_DEBRIS = 64;
const MAX_PUFFS = 48;
/** Minimum impact closing speed (m/s) required to smash a lamp or stall (~13 km/h). */
export const BREAK_IMPACT_SPEED = 3.55;

export class DestructionSystem {
  readonly group = new THREE.Group();
  private debrisMesh: THREE.InstancedMesh;
  private puffMesh: THREE.InstancedMesh;
  private props = new Map<number, BreakableProp>();
  private lampPositions: THREE.Vector3[] = [];
  private heightAt: (x: number, z: number) => number;

  private debrisPool: DebrisSlot[] = [];
  private puffPool: PuffSlot[] = [];
  private debrisCursor = 0;
  private puffCursor = 0;
  private activeDebrisCount = 0;
  private activePuffCount = 0;
  private brokenTotal = 0;

  // Reusable scratch objects (zero per-frame allocations)
  private tmpMat = new THREE.Matrix4();
  private tmpPos = new THREE.Vector3();
  private tmpQuat = new THREE.Quaternion();
  private tmpEuler = new THREE.Euler();
  private tmpScale = new THREE.Vector3();
  private tmpColor = new THREE.Color();

  onBreak?: (prop: BreakableProp, impactSpeed: number) => void;

  constructor(heightAt: (x: number, z: number) => number) {
    this.heightAt = heightAt;
    this.group.name = 'destruction-pool';

    const debrisGeo = new THREE.BoxGeometry(1, 1, 1);
    const debrisMat = new THREE.MeshLambertMaterial({ vertexColors: false });
    this.debrisMesh = new THREE.InstancedMesh(debrisGeo, debrisMat, MAX_DEBRIS);
    this.debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.debrisMesh.castShadow = false;
    this.debrisMesh.receiveShadow = false;
    this.debrisMesh.frustumCulled = false;
    this.debrisMesh.count = 0;
    this.debrisMesh.visible = false;

    const puffGeo = new THREE.OctahedronGeometry(0.5, 0);
    const puffMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.86,
      depthWrite: false,
    });
    this.puffMesh = new THREE.InstancedMesh(puffGeo, puffMat, MAX_PUFFS);
    this.puffMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.puffMesh.castShadow = false;
    this.puffMesh.receiveShadow = false;
    this.puffMesh.frustumCulled = false;
    this.puffMesh.count = 0;
    this.puffMesh.visible = false;

    // Initialize instanceColor attributes once at boot
    for (let i = 0; i < MAX_DEBRIS; i++) {
      this.debrisMesh.setColorAt(i, this.tmpColor.setHex(0xffffff));
      this.debrisPool.push({
        active: false,
        isPolePivot: false,
        age: 0,
        maxAge: 2.2,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        rx: 0,
        ry: 0,
        rz: 0,
        vrx: 0,
        vry: 0,
        vrz: 0,
        sx: 1,
        sy: 1,
        sz: 1,
        fallYaw: 0,
        fallAngle: 0,
        fallVel: 0,
        groundY: 0.02,
        r: 1,
        g: 1,
        b: 1,
      });
    }
    for (let i = 0; i < MAX_PUFFS; i++) {
      this.puffMesh.setColorAt(i, this.tmpColor.setHex(0xffffff));
      this.puffPool.push({
        active: false,
        age: 0,
        maxAge: 0.9,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        gravity: 0,
        baseScale: 0.2,
        growScale: 0.6,
        r: 1,
        g: 1,
        b: 1,
      });
    }

    this.debrisMesh.instanceColor?.setUsage(THREE.DynamicDrawUsage);
    this.puffMesh.instanceColor?.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.debrisMesh, this.puffMesh);
  }

  registerProps(list: BreakableProp[], lampPositions?: THREE.Vector3[]): void {
    if (lampPositions) this.lampPositions = lampPositions;
    for (let i = 0; i < list.length; i++) {
      this.props.set(list[i].id, list[i]);
    }
  }

  get totalRegistered(): number {
    return this.props.size;
  }

  get brokenCount(): number {
    return this.brokenTotal;
  }

  get activePieceCount(): number {
    return this.activeDebrisCount + this.activePuffCount;
  }

  getProp(id: number): BreakableProp | undefined {
    return this.props.get(id);
  }

  findIntactProps(kind: 'lamp' | 'stall', limit = 16): BreakableProp[] {
    const out: BreakableProp[] = [];
    for (const p of this.props.values()) {
      if (!p.broken && (kind === 'lamp' ? p.kind === 'lamp' : p.kind !== 'lamp')) {
        out.push(p);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  /** Prewarm shaders at boot so the first smash never stalls WebGL compilation. */
  withPrewarmState(run: () => void): void {
    const prevDVis = this.debrisMesh.visible;
    const prevPVis = this.puffMesh.visible;
    const prevDCnt = this.debrisMesh.count;
    const prevPCnt = this.puffMesh.count;
    this.tmpMat.makeScale(0.001, 0.001, 0.001);
    this.debrisMesh.setMatrixAt(0, this.tmpMat);
    this.puffMesh.setMatrixAt(0, this.tmpMat);
    this.debrisMesh.instanceMatrix.needsUpdate = true;
    this.puffMesh.instanceMatrix.needsUpdate = true;
    this.debrisMesh.count = 1;
    this.puffMesh.count = 1;
    this.debrisMesh.visible = true;
    this.puffMesh.visible = true;
    try {
      run();
    } finally {
      this.debrisMesh.count = prevDCnt;
      this.puffMesh.count = prevPCnt;
      this.debrisMesh.visible = prevDVis;
      this.puffMesh.visible = prevPVis;
    }
  }

  /**
   * Attempt to break prop `id` upon vehicle collision.
   * Returns `true` if impact speed met the threshold and the prop broke (disabling its collider).
   */
  tryBreak(
    id: number,
    impactSpeed: number,
    hitFromX: number,
    hitFromZ: number,
    vehicleYaw: number,
  ): boolean {
    const prop = this.props.get(id);
    if (!prop || prop.broken) return false;
    if (impactSpeed < BREAK_IMPACT_SPEED) return false;

    prop.broken = true;
    prop.collider.disabled = true;
    if (prop.vendorSpot) prop.vendorSpot.broken = true;
    this.brokenTotal++;

    // 1. Hide intact static geometry slice in merged chunk mesh (0 extra draw calls)
    prop.savedPositions = [];
    for (let i = 0; i < prop.slices.length; i++) {
      const s = prop.slices[i];
      const posAttr = s.mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (!posAttr) continue;
      const arr = posAttr.array as Float32Array;
      const i0 = s.startVertex * 3;
      const i1 = (s.startVertex + s.vertexCount) * 3;
      prop.savedPositions.push(arr.slice(i0, i1));
      arr.fill(0, i0, i1);
      posAttr.addUpdateRange(i0, i1 - i0);
      posAttr.needsUpdate = true;
    }

    // 2. Disable street lamp night light if applicable
    if (prop.lampIndex !== undefined && prop.lampIndex >= 0 && this.lampPositions[prop.lampIndex]) {
      prop.savedLampY = this.lampPositions[prop.lampIndex].y;
      this.lampPositions[prop.lampIndex].y = -9999;
    }

    // 3. Determine push direction away from vehicle
    let dirX = prop.x - hitFromX;
    let dirZ = prop.z - hitFromZ;
    const len = Math.hypot(dirX, dirZ);
    if (len > 0.05) {
      dirX /= len;
      dirZ /= len;
    } else {
      dirX = Math.sin(vehicleYaw);
      dirZ = Math.cos(vehicleYaw);
    }
    const pushYaw = Math.atan2(dirX, dirZ);
    const gY = this.heightAt(prop.x, prop.z);

    if (prop.kind === 'lamp') {
      this.spawnLampCollapse(prop.x, prop.z, gY, pushYaw, clamp(impactSpeed / 6, 0.8, 1.8));
    } else {
      this.spawnStallCollapse(prop, gY, dirX, dirZ, clamp(impactSpeed / 5.5, 0.85, 1.9));
    }

    this.onBreak?.(prop, impactSpeed);
    return true;
  }

  private allocDebris(): DebrisSlot {
    const slot = this.debrisPool[this.debrisCursor];
    this.debrisCursor = (this.debrisCursor + 1) % MAX_DEBRIS;
    return slot;
  }

  private allocPuff(): PuffSlot {
    const slot = this.puffPool[this.puffCursor];
    this.puffCursor = (this.puffCursor + 1) % MAX_PUFFS;
    return slot;
  }

  private spawnLampCollapse(x: number, z: number, gY: number, fallYaw: number, force: number): void {
    // Main galvanized lamp column pivoting from plinth base
    const pole = this.allocDebris();
    pole.active = true;
    pole.isPolePivot = true;
    pole.age = 0;
    pole.maxAge = 2.55;
    pole.x = x;
    pole.y = gY + 0.4;
    pole.z = z;
    pole.sx = 0.14;
    pole.sy = 5.4;
    pole.sz = 0.14;
    pole.fallYaw = fallYaw;
    pole.fallAngle = 0.06;
    pole.fallVel = 1.65 * force;
    pole.groundY = gY + 0.12;
    this.tmpColor.set('#5a626b');
    pole.r = this.tmpColor.r;
    pole.g = this.tmpColor.g;
    pole.b = this.tmpColor.b;

    // Detached cobra-head luminaire & bracket shards
    const fx = Math.sin(fallYaw);
    const fz = Math.cos(fallYaw);
    for (let i = 0; i < 3; i++) {
      const d = this.allocDebris();
      d.active = true;
      d.isPolePivot = false;
      d.age = 0;
      d.maxAge = 1.9 + i * 0.18;
      d.x = x + fx * (0.4 + i * 0.35);
      d.y = gY + 4.8 - i * 0.8;
      d.z = z + fz * (0.4 + i * 0.35);
      d.vx = fx * (2.6 + i * 0.9) * force + (i - 1) * 0.8;
      d.vy = 1.8 + i * 0.5;
      d.vz = fz * (2.6 + i * 0.9) * force - (i - 1) * 0.7;
      d.rx = i * 0.5;
      d.ry = fallYaw;
      d.rz = 0;
      d.vrx = 5.5 - i * 1.4;
      d.vry = 3.2;
      d.vrz = -4.2 + i * 1.8;
      d.sx = i === 0 ? 0.28 : 0.12;
      d.sy = i === 0 ? 0.12 : 0.55;
      d.sz = i === 0 ? 0.46 : 0.12;
      d.groundY = gY + 0.08;
      this.tmpColor.set(i === 0 ? '#ffe0a6' : '#434a52');
      d.r = this.tmpColor.r;
      d.g = this.tmpColor.g;
      d.b = this.tmpColor.b;
    }

    // Electric bulb sparks + concrete plinth dust
    for (let i = 0; i < 7; i++) {
      const p = this.allocPuff();
      const isSpark = i < 4;
      p.active = true;
      p.age = 0;
      p.maxAge = isSpark ? 0.55 : 0.85;
      p.x = x + (isSpark ? fx * 0.5 : 0);
      p.y = gY + (isSpark ? 4.9 : 0.35);
      p.z = z + (isSpark ? fz * 0.5 : 0);
      const ang = (i / 7) * Math.PI * 2;
      p.vx = Math.cos(ang) * (isSpark ? 3.4 : 1.4) + fx * 1.5;
      p.vy = isSpark ? 2.2 + (i % 3) * 0.9 : 0.95;
      p.vz = Math.sin(ang) * (isSpark ? 3.4 : 1.4) + fz * 1.5;
      p.gravity = isSpark ? 9.8 : 1.2;
      p.baseScale = isSpark ? 0.14 : 0.32;
      p.growScale = isSpark ? 0.06 : 0.65;
      this.tmpColor.set(isSpark ? '#ffd466' : '#b8afa0');
      p.r = this.tmpColor.r;
      p.g = this.tmpColor.g;
      p.b = this.tmpColor.b;
    }
  }

  private spawnStallCollapse(
    prop: BreakableProp,
    gY: number,
    dirX: number,
    dirZ: number,
    force: number,
  ): void {
    // Palette tailored per Bangladeshi stall archetype
    const canopyHex =
      prop.kind === 'tea'
        ? '#1f5ea8'
        : prop.kind === 'fuchka'
          ? '#d9480f'
          : prop.kind === 'jhalmuri'
            ? '#2b8a3e'
            : '#e67700';
    const itemHex =
      prop.kind === 'market'
        ? '#4ea832'
        : prop.kind === 'tea'
          ? '#d8dee9'
          : prop.kind === 'fuchka'
            ? '#f08c00'
            : '#adb5bd';

    const pieces: { sx: number; sy: number; sz: number; hex: string; yOff: number }[] = [
      // Tilted canopy / tarp / umbrella top
      { sx: 1.35, sy: 0.1, sz: 1.15, hex: canopyHex, yOff: 1.85 },
      // Wooden cart tabletop planks
      { sx: 1.15, sy: 0.12, sz: 0.42, hex: '#7c5333', yOff: 0.85 },
      { sx: 1.05, sy: 0.12, sz: 0.4, hex: '#634127', yOff: 0.82 },
      // Cart legs / wheel struts
      { sx: 0.12, sy: 0.78, sz: 0.12, hex: '#4f341f', yOff: 0.45 },
      { sx: 0.12, sy: 0.78, sz: 0.12, hex: '#4f341f', yOff: 0.45 },
      { sx: 0.38, sy: 0.38, sz: 0.08, hex: '#22262b', yOff: 0.32 },
      // Tin pots / kettle / glass jars / coconuts / mangoes
      { sx: 0.28, sy: 0.32, sz: 0.28, hex: '#adb5bd', yOff: 1.05 },
      { sx: 0.24, sy: 0.26, sz: 0.24, hex: itemHex, yOff: 1.02 },
      { sx: 0.2, sy: 0.2, sz: 0.2, hex: itemHex, yOff: 0.98 },
      { sx: 0.2, sy: 0.2, sz: 0.2, hex: '#f59f00', yOff: 0.96 },
    ];

    for (let i = 0; i < pieces.length; i++) {
      const spec = pieces[i];
      const d = this.allocDebris();
      const spread = (i - 4.5) * 0.42;
      const sideX = -dirZ;
      const sideZ = dirX;
      d.active = true;
      d.isPolePivot = false;
      d.age = 0;
      d.maxAge = 2.15 + (i % 3) * 0.2;
      d.x = prop.x + sideX * spread * 0.45;
      d.y = gY + spec.yOff;
      d.z = prop.z + sideZ * spread * 0.45;
      d.vx = (dirX * (2.5 + (i % 4) * 0.85) + sideX * spread * 1.35) * force;
      d.vy = (1.6 + (i % 3) * 0.95) * Math.min(1.4, force);
      d.vz = (dirZ * (2.5 + (i % 4) * 0.85) + sideZ * spread * 1.35) * force;
      d.rx = i * 0.35;
      d.ry = prop.yaw + i * 0.4;
      d.rz = 0;
      d.vrx = (i % 2 === 0 ? 1 : -1) * (4.2 + (i % 3) * 1.6);
      d.vry = (i - 4) * 1.1;
      d.vrz = (i % 2 === 1 ? 1 : -1) * (3.6 + (i % 4) * 1.2);
      d.sx = spec.sx;
      d.sy = spec.sy;
      d.sz = spec.sz;
      d.groundY = gY + Math.min(spec.sx, spec.sy, spec.sz) * 0.5;
      this.tmpColor.set(spec.hex);
      d.r = this.tmpColor.r;
      d.g = this.tmpColor.g;
      d.b = this.tmpColor.b;
    }

    // Dust puff cloud
    for (let i = 0; i < 7; i++) {
      const p = this.allocPuff();
      const ang = (i / 7) * Math.PI * 2;
      p.active = true;
      p.age = 0;
      p.maxAge = 0.85 + (i % 2) * 0.2;
      p.x = prop.x + Math.cos(ang) * 0.35;
      p.y = gY + 0.55 + (i % 3) * 0.25;
      p.z = prop.z + Math.sin(ang) * 0.35;
      p.vx = Math.cos(ang) * 1.8 + dirX * 1.6;
      p.vy = 1.2 + (i % 3) * 0.4;
      p.vz = Math.sin(ang) * 1.8 + dirZ * 1.6;
      p.gravity = 1.4;
      p.baseScale = 0.36;
      p.growScale = 0.85;
      this.tmpColor.set(i % 2 === 0 ? '#cbbba2' : '#dfd3be');
      p.r = this.tmpColor.r;
      p.g = this.tmpColor.g;
      p.b = this.tmpColor.b;
    }
  }

  update(dt: number): void {
    // 1. Step tumbling debris & falling poles
    let dOut = 0;
    for (let i = 0; i < MAX_DEBRIS; i++) {
      const d = this.debrisPool[i];
      if (!d.active) continue;
      d.age += dt;
      if (d.age >= d.maxAge) {
        d.active = false;
        continue;
      }
      const fade = d.age > d.maxAge - 0.45 ? clamp((d.maxAge - d.age) / 0.45, 0.01, 1) : 1;

      if (d.isPolePivot) {
        d.fallVel += 6.8 * Math.sin(Math.max(0.08, d.fallAngle)) * dt;
        d.fallAngle += d.fallVel * dt;
        const maxTilt = Math.PI * 0.485;
        if (d.fallAngle >= maxTilt) {
          d.fallAngle = maxTilt;
          d.fallVel = -Math.abs(d.fallVel) * 0.22;
          if (Math.abs(d.fallVel) < 0.15) d.fallVel = 0;
        }
        const halfLen = d.sy * 0.5;
        const cx = d.x + Math.sin(d.fallYaw) * Math.sin(d.fallAngle) * halfLen;
        const cy = d.y + Math.cos(d.fallAngle) * halfLen;
        const cz = d.z + Math.cos(d.fallYaw) * Math.sin(d.fallAngle) * halfLen;
        this.tmpPos.set(cx, cy, cz);
        this.tmpEuler.set(d.fallAngle, d.fallYaw, 0, 'YXZ');
        this.tmpQuat.setFromEuler(this.tmpEuler);
        this.tmpScale.set(d.sx * fade, d.sy * fade, d.sz * fade);
      } else {
        d.vy -= 14.2 * dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.z += d.vz * dt;
        if (d.y <= d.groundY) {
          d.y = d.groundY;
          d.vy = Math.abs(d.vy) > 1.2 ? Math.abs(d.vy) * 0.32 : 0;
          d.vx *= 0.62;
          d.vz *= 0.62;
          d.vrx *= 0.55;
          d.vry *= 0.55;
          d.vrz *= 0.55;
        }
        d.rx += d.vrx * dt;
        d.ry += d.vry * dt;
        d.rz += d.vrz * dt;
        this.tmpPos.set(d.x, d.y, d.z);
        this.tmpEuler.set(d.rx, d.ry, d.rz, 'YXZ');
        this.tmpQuat.setFromEuler(this.tmpEuler);
        this.tmpScale.set(d.sx * fade, d.sy * fade, d.sz * fade);
      }

      this.tmpMat.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
      this.debrisMesh.setMatrixAt(dOut, this.tmpMat);
      this.tmpColor.setRGB(d.r, d.g, d.b);
      this.debrisMesh.setColorAt(dOut, this.tmpColor);
      dOut++;
    }

    this.activeDebrisCount = dOut;
    this.debrisMesh.count = dOut;
    this.debrisMesh.visible = dOut > 0;
    if (dOut > 0) {
      this.debrisMesh.instanceMatrix.needsUpdate = true;
      if (this.debrisMesh.instanceColor) this.debrisMesh.instanceColor.needsUpdate = true;
    }

    // 2. Step sparks & dust puffs
    let pOut = 0;
    this.tmpQuat.identity();
    for (let i = 0; i < MAX_PUFFS; i++) {
      const p = this.puffPool[i];
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.maxAge) {
        p.active = false;
        continue;
      }
      const prog = p.age / p.maxAge;
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const sc = (p.baseScale + p.growScale * prog) * (1 - prog * 0.85);
      this.tmpPos.set(p.x, p.y, p.z);
      this.tmpScale.set(sc, sc, sc);
      this.tmpMat.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
      this.puffMesh.setMatrixAt(pOut, this.tmpMat);
      this.tmpColor.setRGB(p.r, p.g, p.b);
      this.puffMesh.setColorAt(pOut, this.tmpColor);
      pOut++;
    }

    this.activePuffCount = pOut;
    this.puffMesh.count = pOut;
    this.puffMesh.visible = pOut > 0;
    if (pOut > 0) {
      this.puffMesh.instanceMatrix.needsUpdate = true;
      if (this.puffMesh.instanceColor) this.puffMesh.instanceColor.needsUpdate = true;
    }
  }

  /** Restore all broken lamps, stalls, colliders, and clear active debris. */
  resetAll(): void {
    for (let i = 0; i < MAX_DEBRIS; i++) this.debrisPool[i].active = false;
    for (let i = 0; i < MAX_PUFFS; i++) this.puffPool[i].active = false;
    this.activeDebrisCount = 0;
    this.activePuffCount = 0;
    this.debrisMesh.count = 0;
    this.puffMesh.count = 0;
    this.debrisMesh.visible = false;
    this.puffMesh.visible = false;

    for (const prop of this.props.values()) {
      if (!prop.broken) continue;
      prop.broken = false;
      prop.collider.disabled = false;
      if (prop.vendorSpot) prop.vendorSpot.broken = false;
      if (prop.savedPositions) {
        for (let i = 0; i < prop.slices.length; i++) {
          const s = prop.slices[i];
          const saved = prop.savedPositions[i];
          const posAttr = s.mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
          if (posAttr && saved) {
            (posAttr.array as Float32Array).set(saved, s.startVertex * 3);
            posAttr.addUpdateRange(s.startVertex * 3, saved.length);
            posAttr.needsUpdate = true;
          }
        }
        prop.savedPositions = undefined;
      }
      if (prop.lampIndex !== undefined && prop.savedLampY !== undefined && this.lampPositions[prop.lampIndex]) {
        this.lampPositions[prop.lampIndex].y = prop.savedLampY;
      }
    }
    this.brokenTotal = 0;
  }
}
