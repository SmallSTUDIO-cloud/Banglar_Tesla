/**
 * Dynamic Pooled Roadblock System (v0.5.0 — Sections 12, 21, 26.3).
 *
 * Design & Fairness Invariants:
 *   - Strictly pooled (`MAX_ROADBLOCKS = 6` pre-built reusable 3D groups, zero
 *     dynamic lights, zero per-frame allocations, zero geometry/material leaks).
 *   - Road-graph-aware: spawns ONLY on valid `ROAD_SEGMENTS` >= 48m ahead of the
 *     player so approach sightlines are always fair and never pop onto the player.
 *   - Always leaves a valid rickshaw-navigable shoulder gap (>= 1.95m wide) PLUS
 *     a smashable wooden sawhorse section (`smashable = true`) that disables its
 *     collider immediately on impact, rewarding rickshaw agility over wider cars.
 *   - Immediately recycles all roadblocks when races/pursuits end or reset.
 */

import * as THREE from 'three';
import { ROAD_SEGMENTS, type RoadSegment } from '../world/layout';
import { Bucket } from '../world/geo';
import { testRickshawCapsuleVsObb } from '../vehicle/rickshawController';

export interface RoadblockBarrierObb {
  cx: number;
  cz: number;
  halfX: number;
  halfZ: number;
  yaw: number;
  smashable: boolean;
  disabled: boolean;
  slotIndex: number;
}

interface RoadblockSlot {
  active: boolean;
  segmentId: string;
  x: number;
  z: number;
  yaw: number;
  gapSide: 1 | -1;
  group: THREE.Group;
  smashMesh: THREE.Object3D;
  beaconRed: THREE.Mesh;
  beaconBlue: THREE.Mesh;
  solidObb: RoadblockBarrierObb;
  smashObb: RoadblockBarrierObb;
}

const MAX_ROADBLOCKS = 6;

export class RoadblockSystem {
  readonly group = new THREE.Group();
  private readonly slots: RoadblockSlot[] = [];
  private readonly activeObbsScratch: RoadblockBarrierObb[] = [];
  private readonly mapMarkersScratch: { x: number; z: number }[] = [];
  private sharedSolidGeo!: THREE.BufferGeometry;
  private sharedSmashGeo!: THREE.BufferGeometry;
  private sharedConeGeo!: THREE.BufferGeometry;
  private sharedBeaconGeo!: THREE.BufferGeometry;
  private solidMat!: THREE.MeshLambertMaterial;
  private beaconRedMat!: THREE.MeshBasicMaterial;
  private beaconBlueMat!: THREE.MeshBasicMaterial;
  private clock = 0;
  private spawnCooldown = 0;

  onBarrierSmashed?: (x: number, z: number, speed: number) => void;

  constructor(private readonly heightAt: (x: number, z: number) => number) {
    this.group.name = 'dynamic-roadblocks';
    this.buildSharedPrototypes();
    for (let i = 0; i < MAX_ROADBLOCKS; i++) {
      this.slots.push(this.createSlot(i));
    }
  }

  private buildSharedPrototypes(): void {
    this.solidMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.beaconRedMat = new THREE.MeshBasicMaterial({ color: 0xff2e38 });
    this.beaconBlueMat = new THREE.MeshBasicMaterial({ color: 0x2986ff });

    // Heavy police/construction concrete jersey barrier + patrol blockade
    const bSolid = new Bucket('rb-solid', this.solidMat);
    bSolid.box({ x: 0, y: 0.45, z: 0 }, { x: 2.3, y: 0.9, z: 0.72 }, '#d8dee6');
    bSolid.box({ x: -0.65, y: 0.62, z: 0 }, { x: 0.42, y: 0.32, z: 0.75 }, '#e03131');
    bSolid.box({ x: 0.65, y: 0.62, z: 0 }, { x: 0.42, y: 0.32, z: 0.75 }, '#e03131');
    bSolid.box({ x: 0, y: 0.96, z: 0 }, { x: 2.1, y: 0.12, z: 0.24 }, '#1d3557');
    this.sharedSolidGeo = bSolid.build({ cast: false, receive: true })!.geometry;

    // Smashable wooden sawhorse striped barricade
    const bSmash = new Bucket('rb-smash', this.solidMat);
    bSmash.box({ x: 0, y: 0.78, z: 0 }, { x: 1.65, y: 0.24, z: 0.14 }, '#f59f00');
    bSmash.box({ x: -0.45, y: 0.78, z: 0 }, { x: 0.32, y: 0.25, z: 0.16 }, '#1e2228');
    bSmash.box({ x: 0.45, y: 0.78, z: 0 }, { x: 0.32, y: 0.25, z: 0.16 }, '#1e2228');
    bSmash.box({ x: -0.68, y: 0.44, z: 0 }, { x: 0.09, y: 0.88, z: 0.46 }, '#8d5b32');
    bSmash.box({ x: 0.68, y: 0.44, z: 0 }, { x: 0.09, y: 0.88, z: 0.46 }, '#8d5b32');
    this.sharedSmashGeo = bSmash.build({ cast: false, receive: true })!.geometry;

    const bCone = new Bucket('rb-cone', this.solidMat);
    bCone.cone({ x: 0, y: 0.34, z: 0 }, 0.2, 0.68, '#ff6b1a');
    bCone.cylinder({ x: 0, y: 0.36, z: 0 }, 0.12, 0.14, '#ffffff');
    this.sharedConeGeo = bCone.build({ cast: false, receive: false })!.geometry;

    this.sharedBeaconGeo = new THREE.BoxGeometry(0.24, 0.16, 0.24);
  }

  private createSlot(index: number): RoadblockSlot {
    const g = new THREE.Group();
    g.visible = false;

    const solidMesh = new THREE.Mesh(this.sharedSolidGeo, this.solidMat);
    solidMesh.name = 'rb-solid';
    g.add(solidMesh);

    const smashMesh = new THREE.Mesh(this.sharedSmashGeo, this.solidMat);
    smashMesh.name = 'rb-smash';
    g.add(smashMesh);

    const coneA = new THREE.Mesh(this.sharedConeGeo, this.solidMat);
    const coneB = new THREE.Mesh(this.sharedConeGeo, this.solidMat);
    coneA.name = 'rb-cone-a';
    coneB.name = 'rb-cone-b';
    g.add(coneA, coneB);

    const beaconRed = new THREE.Mesh(this.sharedBeaconGeo, this.beaconRedMat);
    const beaconBlue = new THREE.Mesh(this.sharedBeaconGeo, this.beaconBlueMat);
    beaconRed.position.set(-0.7, 1.1, 0);
    beaconBlue.position.set(0.7, 1.1, 0);
    g.add(beaconRed, beaconBlue);

    this.group.add(g);

    return {
      active: false,
      segmentId: '',
      x: 0,
      z: 0,
      yaw: 0,
      gapSide: 1,
      group: g,
      smashMesh,
      beaconRed,
      beaconBlue,
      solidObb: { cx: 0, cz: 0, halfX: 1.15, halfZ: 0.38, yaw: 0, smashable: false, disabled: true, slotIndex: index },
      smashObb: { cx: 0, cz: 0, halfX: 0.82, halfZ: 0.24, yaw: 0, smashable: true, disabled: true, slotIndex: index },
    };
  }

  get activeCount(): number {
    let c = 0;
    for (let i = 0; i < this.slots.length; i++) {
      if (this.slots[i].active) c++;
    }
    return c;
  }

  getActiveObbs(): readonly RoadblockBarrierObb[] {
    let n = 0;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (!s.active) continue;
      if (!s.solidObb.disabled) this.activeObbsScratch[n++] = s.solidObb;
      if (!s.smashObb.disabled) this.activeObbsScratch[n++] = s.smashObb;
    }
    this.activeObbsScratch.length = n;
    return this.activeObbsScratch;
  }

  getMinimapMarkers(): readonly { x: number; z: number }[] {
    let n = 0;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (!s.active) continue;
      this.mapMarkersScratch[n++] = { x: s.x, z: s.z };
    }
    this.mapMarkersScratch.length = n;
    return this.mapMarkersScratch;
  }

  /** Prewarm meshes at boot so roadblock activation causes zero shader hitches. */
  withPrewarmState(run: () => void): void {
    const s = this.slots[0];
    const prev = s.group.visible;
    s.group.visible = true;
    try {
      run();
    } finally {
      s.group.visible = prev;
    }
  }

  /** Immediately recycle all active roadblocks (pursuit/race end, menu, reset). */
  clearAll(): void {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      s.active = false;
      s.group.visible = false;
      s.solidObb.disabled = true;
      s.smashObb.disabled = true;
    }
    this.spawnCooldown = 0;
  }

  /**
   * Spawn a fair roadblock ahead of `(px, pz)` along heading `(fx, fz)` if pool space allows.
   * Guarantees distance >= 50m from player and leaves a navigable >= 1.95m rickshaw gap!
   */
  trySpawnAhead(
    px: number,
    pz: number,
    fx: number,
    fz: number,
    desiredActiveCount: number,
  ): boolean {
    if (this.activeCount >= Math.min(MAX_ROADBLOCKS, desiredActiveCount)) return false;
    const freeSlot = this.slots.find((s) => !s.active);
    if (!freeSlot) return false;

    let bestSeg: RoadSegment | null = null;
    let bestAlong = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < ROAD_SEGMENTS.length; i++) {
      const seg = ROAD_SEGMENTS[i];
      // Only place roadblocks on wide enough main/medium corridors (>= 7.2m wide) so a >= 2m rickshaw gap is ALWAYS guaranteed!
      if (seg.width < 7.2 || seg.length < 36) continue;
      if (this.slots.some((s) => s.active && s.segmentId === seg.id)) continue;

      const along = seg.length * 0.52;
      const rx = seg.ax + seg.ux * along;
      const rz = seg.az + seg.uz * along;
      const dx = rx - px;
      const dz = rz - pz;
      const dist = Math.hypot(dx, dz);
      // Strict approach fairness window: 50m..125m ahead!
      if (dist < 50 || dist > 125) continue;
      const aheadDot = (dx / dist) * fx + (dz / dist) * fz;
      if (aheadDot < 0.38) continue;

      const score = aheadDot * 40 - Math.abs(dist - 78);
      if (score > bestScore) {
        bestScore = score;
        bestSeg = seg;
        bestAlong = along;
      }
    }

    if (!bestSeg) return false;

    const cx = bestSeg.ax + bestSeg.ux * bestAlong;
    const cz = bestSeg.az + bestSeg.uz * bestAlong;
    const roadYaw = Math.atan2(bestSeg.ux, bestSeg.uz);
    const gapSide: 1 | -1 = Math.sin(cx + cz) >= 0 ? 1 : -1;
    const gy = this.heightAt(cx, cz);

    // Position solid barrier on `-gapSide`, smashable sawhorse near centre, leaving `+gapSide` (>= 2.1m) open for agile rickshaw threading!
    const solidLateral = -gapSide * Math.min(bestSeg.halfWidth - 1.35, 1.55);
    const smashLateral = gapSide * 0.35;
    const coneEdge = gapSide * Math.max(1.85, bestSeg.halfWidth - 0.35);

    freeSlot.active = true;
    freeSlot.segmentId = bestSeg.id;
    freeSlot.x = cx;
    freeSlot.z = cz;
    freeSlot.yaw = roadYaw;
    freeSlot.gapSide = gapSide;

    freeSlot.group.position.set(cx, gy, cz);
    freeSlot.group.rotation.set(0, roadYaw, 0);
    freeSlot.group.visible = true;

    const solidMesh = freeSlot.group.children[0];
    solidMesh.position.set(solidLateral, 0, 0);
    freeSlot.smashMesh.position.set(smashLateral, 0, 0);
    freeSlot.smashMesh.visible = true;
    freeSlot.group.children[2].position.set(smashLateral + gapSide * 0.98, 0, 0.35);
    freeSlot.group.children[3].position.set(coneEdge, 0, -0.35);
    freeSlot.beaconRed.position.set(solidLateral - 0.65, 1.08, 0);
    freeSlot.beaconBlue.position.set(solidLateral + 0.65, 1.08, 0);

    const cosY = Math.cos(roadYaw);
    const sinY = Math.sin(roadYaw);
    freeSlot.solidObb.cx = cx + solidLateral * cosY;
    freeSlot.solidObb.cz = cz - solidLateral * sinY;
    freeSlot.solidObb.yaw = roadYaw;
    freeSlot.solidObb.disabled = false;

    freeSlot.smashObb.cx = cx + smashLateral * cosY;
    freeSlot.smashObb.cz = cz - smashLateral * sinY;
    freeSlot.smashObb.yaw = roadYaw;
    freeSlot.smashObb.disabled = false;

    return true;
  }

  /** Update flashing beacons, recycle far-behind roadblocks, and spawn ahead when requested. */
  update(
    dt: number,
    px: number,
    pz: number,
    fx: number,
    fz: number,
    desiredCount: number,
  ): void {
    this.clock += dt;
    this.spawnCooldown = Math.max(0, this.spawnCooldown - dt);

    const redOn = Math.floor(this.clock * 7.5) % 2 === 0;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (!s.active) continue;
      const dx = s.x - px;
      const dz = s.z - pz;
      const distSq = dx * dx + dz * dz;
      const behind = dx * fx + dz * fz < -28;
      if (distSq > 155 * 155 || (behind && distSq > 55 * 55)) {
        s.active = false;
        s.group.visible = false;
        s.solidObb.disabled = true;
        s.smashObb.disabled = true;
        continue;
      }
      s.beaconRed.visible = redOn;
      s.beaconBlue.visible = !redOn;
    }

    if (desiredCount > 0 && this.spawnCooldown <= 0 && this.activeCount < desiredCount) {
      if (this.trySpawnAhead(px, pz, fx, fz, desiredCount)) {
        this.spawnCooldown = 3.2;
      } else {
        this.spawnCooldown = 1.0;
      }
    }
  }

  /**
   * Resolve player rickshaw vs active roadblocks.
   * Smashing the wooden sawhorse at >= 2.8 m/s shatters it cleanly without trapping!
   */
  resolvePlayerCollision(
    rx: number,
    rz: number,
    ryaw: number,
    rspeed: number,
  ): {
    hit: boolean;
    smashed: boolean;
    pushX: number;
    pushZ: number;
    nx: number;
    nz: number;
    contactX: number;
    contactZ: number;
    speedScale: number;
  } {
    let hitAny = false;
    let smashed = false;
    let pushX = 0;
    let pushZ = 0;
    let nx = 0;
    let nz = 0;
    let contactX = rx;
    let contactZ = rz;
    let speedScale = 1;

    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (!s.active) continue;

      if (!s.smashObb.disabled) {
        const hSmash = testRickshawCapsuleVsObb(
          rx + pushX,
          rz + pushZ,
          ryaw,
          s.smashObb.cx,
          s.smashObb.cz,
          s.smashObb.halfX,
          s.smashObb.halfZ,
          s.smashObb.yaw,
        );
        if (hSmash.hit) {
          if (Math.abs(rspeed) >= 2.6) {
            // Smash right through the wooden sawhorse!
            s.smashObb.disabled = true;
            s.smashMesh.visible = false;
            smashed = true;
            hitAny = true;
            nx = hSmash.nx;
            nz = hSmash.nz;
            contactX = hSmash.contactX;
            contactZ = hSmash.contactZ;
            speedScale = Math.min(speedScale, 0.84);
            this.onBarrierSmashed?.(hSmash.contactX, hSmash.contactZ, Math.abs(rspeed));
          } else {
            hitAny = true;
            pushX += hSmash.pushX;
            pushZ += hSmash.pushZ;
            nx = hSmash.nx;
            nz = hSmash.nz;
            contactX = hSmash.contactX;
            contactZ = hSmash.contactZ;
            speedScale = Math.min(speedScale, 0.55);
          }
        }
      }

      if (!s.solidObb.disabled) {
        const hSolid = testRickshawCapsuleVsObb(
          rx + pushX,
          rz + pushZ,
          ryaw,
          s.solidObb.cx,
          s.solidObb.cz,
          s.solidObb.halfX,
          s.solidObb.halfZ,
          s.solidObb.yaw,
        );
        if (hSolid.hit) {
          hitAny = true;
          pushX += hSolid.pushX;
          pushZ += hSolid.pushZ;
          nx = hSolid.nx;
          nz = hSolid.nz;
          contactX = hSolid.contactX;
          contactZ = hSolid.contactZ;
          const dirX = Math.sin(ryaw) * Math.sign(rspeed || 1);
          const dirZ = Math.cos(ryaw) * Math.sign(rspeed || 1);
          const into = Math.max(0, -(dirX * hSolid.nx + dirZ * hSolid.nz));
          const tangentKeep = Math.sqrt(Math.max(0, 1 - into * into)) * 0.92;
          speedScale = Math.min(speedScale, tangentKeep);
        }
      }
    }

    return { hit: hitAny, smashed, pushX, pushZ, nx, nz, contactX, contactZ, speedScale };
  }

  dispose(): void {
    this.clearAll();
    this.group.clear();
    this.sharedSolidGeo.dispose();
    this.sharedSmashGeo.dispose();
    this.sharedConeGeo.dispose();
    this.sharedBeaconGeo.dispose();
    this.solidMat.dispose();
    this.beaconRedMat.dispose();
    this.beaconBlueMat.dispose();
  }
}
