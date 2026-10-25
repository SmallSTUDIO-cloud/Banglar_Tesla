/**
 * Dense, varied Mohammadpur pedestrian crowd (Sections 12 & 13):
 *   - Rendered via 6 InstancedMeshes sharing ONE material (~6 draw calls total
 *     for up to 90 animated pedestrians with varied heights, sarees/lungis/kurtas,
 *     and shopping bags).
 *   - Walks along real Mohammadpur sidewalks & market plazas, recycling distant
 *     walkers (>155m) into corridors near the player so streets always feel lively.
 *   - Actively avoids approaching rickshaws (side-stepping onto outer sidewalk,
 *     pausing & turning toward danger), reacts non-graphically with a grounded
 *     stumble on contact, and calls out authentic Bengali lines ("এই! দেখে চালান!",
 *     "সামনে দেখেন ভাই!", "আস্তে চালান!") with strict anti-spam cooldowns.
 */

import * as THREE from 'three';
import { QUALITY, type QualitySettings } from '../core/config';
import { clamp, damp, mulberry32, TAU } from '../core/mathx';
import { ROAD_SEGMENTS, isClearOfRoads } from '../world/layout';

export interface PedPath {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  ux: number;
  uz: number;
  fwdYaw: number;
  revYaw: number;
  /** Outward unit vector pointing AWAY from the road toward buildings (safe dodge direction!). */
  safeX: number;
  safeZ: number;
  length: number;
  busy: boolean;
}

export interface PedestrianReactionEvent {
  x: number;
  y: number;
  z: number;
  textKey: string;
  kind: 'nearmiss' | 'bump';
}

function buildSidewalkPaths(): PedPath[] {
  const paths: PedPath[] = [];
  for (const seg of ROAD_SEGMENTS) {
    if (seg.length < 22) continue;
    const margin = Math.min(8.5, seg.length * 0.22);
    for (const side of [-1, 1] as const) {
      const lat = (seg.halfWidth + seg.sidewalk * 0.54) * side;
      const ax = seg.ax + seg.ux * margin + seg.leftX * lat;
      const az = seg.az + seg.uz * margin + seg.leftZ * lat;
      const bx = seg.bx - seg.ux * margin + seg.leftX * lat;
      const bz = seg.bz - seg.uz * margin + seg.leftZ * lat;
      const mx = (ax + bx) * 0.5;
      const mz = (az + bz) * 0.5;
      if (!isClearOfRoads(mx, mz, 0.35)) continue;
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 6) continue;
      paths.push({
        ax,
        az,
        bx,
        bz,
        ux: seg.ux,
        uz: seg.uz,
        fwdYaw: Math.atan2(seg.ux, seg.uz),
        revYaw: Math.atan2(-seg.ux, -seg.uz),
        safeX: seg.leftX * side,
        safeZ: seg.leftZ * side,
        length: len,
        busy: seg.jamProne || seg.kind === 'main',
      });
    }
  }
  return paths;
}

export const PED_PATHS: PedPath[] = buildSidewalkPaths();

const TOP_COLORS = [
  '#d9483b', // crimson kameez / kurta
  '#1d6fa5', // cobalt panjabi
  '#2a9d8f', // emerald saree blouse
  '#e9c46a', // mustard cotton shirt
  '#f4f1ea', // crisp white office/mosque panjabi
  '#8a2be2', // violet festive kameez
  '#e76f51', // terracotta tunic
  '#264653', // slate shirt
  '#c9184a', // magenta saree
  '#457b9d', // school/college blue
];
const SKIN_TONES = ['#8b5a3c', '#9e6845', '#704730', '#ad7650'];
const LOWER_COLORS = ['#1f2937', '#1e4e68', '#4a3525', '#dcd6c8', '#7f1d1d', '#1b4332'];
const BAG_COLORS = ['#d97706', '#dc2626', '#16a34a', '#2563eb', '#9333ea'];
const REACTION_KEYS = [
  'ped.react.1',
  'ped.react.2',
  'ped.react.3',
  'ped.react.4',
  'ped.react.5',
  'ped.react.6',
];

interface PedAgent {
  pathIdx: number;
  t: number;
  dir: 1 | -1;
  speed: number;
  pause: number;
  phase: number;
  heightScale: number;
  sideJitter: number;
  evadeAmount: number;
  stumbleTimer: number;
  reactCooldown: number;
  hasSkirt: boolean;
  hasBag: boolean;
  lookAtPlayer: number;
  worldX: number;
  worldZ: number;
  farAccum: number;
}

export class PedestrianSystem {
  readonly group = new THREE.Group();
  private peds: PedAgent[] = [];
  private body: THREE.InstancedMesh;
  private head: THREE.InstancedMesh;
  private legL: THREE.InstancedMesh;
  private legR: THREE.InstancedMesh;
  private skirt: THREE.InstancedMesh;
  private bag: THREE.InstancedMesh;
  private maxCapacity: number;
  private activeCount = 0;

  private rng = mulberry32(73319);
  private matrix = new THREE.Matrix4();
  private quat = new THREE.Quaternion();
  private euler = new THREE.Euler();
  private pos = new THREE.Vector3();
  private scale = new THREE.Vector3(1, 1, 1);
  private globalReactCooldown = 0;

  onReaction?: (ev: PedestrianReactionEvent) => void;

  constructor(quality: QualitySettings) {
    this.maxCapacity = Math.max(96, QUALITY.high.pedestrians);
    this.group.name = 'mohammadpur-pedestrians';

    const bodyGeo = new THREE.CapsuleGeometry(0.155, 0.46, 3, 8);
    bodyGeo.translate(0, 1.02, 0);
    const headGeo = new THREE.SphereGeometry(0.105, 8, 7);
    headGeo.translate(0, 1.5, 0);
    const legGeo = new THREE.BoxGeometry(0.105, 0.52, 0.125);
    legGeo.translate(0, -0.26, 0);
    const skirtGeo = new THREE.ConeGeometry(0.25, 0.72, 8, 1, false);
    skirtGeo.translate(0, 0.72, 0);
    const bagGeo = new THREE.BoxGeometry(0.22, 0.26, 0.12);

    // ONE shared matte Lambertian material with FrontSide backface culling across all 6 instanced parts!
    const sharedPedMat = new THREE.MeshLambertMaterial({
      color: 0xffffff,
    });

    this.body = new THREE.InstancedMesh(bodyGeo, sharedPedMat, this.maxCapacity);
    this.head = new THREE.InstancedMesh(headGeo, sharedPedMat, this.maxCapacity);
    this.legL = new THREE.InstancedMesh(legGeo, sharedPedMat, this.maxCapacity);
    this.legR = new THREE.InstancedMesh(legGeo, sharedPedMat, this.maxCapacity);
    this.skirt = new THREE.InstancedMesh(skirtGeo, sharedPedMat, this.maxCapacity);
    this.bag = new THREE.InstancedMesh(bagGeo, sharedPedMat, this.maxCapacity);

    for (const mesh of [this.body, this.head, this.legL, this.legR, this.skirt, this.bag]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      this.group.add(mesh);
    }
    this.body.castShadow = quality.shadows;

    // Pre-populate full pool once so quality changes never reallocate GPU buffers
    const cTmp = new THREE.Color();
    const zeroMat = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.maxCapacity; i++) {
      const ped = this.createAgent(i);
      this.peds.push(ped);
      cTmp.set(TOP_COLORS[Math.floor(this.rng() * TOP_COLORS.length)]);
      this.body.setColorAt(i, cTmp);
      cTmp.set(SKIN_TONES[Math.floor(this.rng() * SKIN_TONES.length)]);
      this.head.setColorAt(i, cTmp);
      cTmp.set(LOWER_COLORS[Math.floor(this.rng() * LOWER_COLORS.length)]);
      this.legL.setColorAt(i, cTmp);
      this.legR.setColorAt(i, cTmp);
      cTmp.set(TOP_COLORS[Math.floor(this.rng() * TOP_COLORS.length)]);
      this.skirt.setColorAt(i, cTmp);
      cTmp.set(BAG_COLORS[Math.floor(this.rng() * BAG_COLORS.length)]);
      this.bag.setColorAt(i, cTmp);
      if (!ped.hasSkirt) this.skirt.setMatrixAt(i, zeroMat);
      if (!ped.hasBag) this.bag.setMatrixAt(i, zeroMat);
    }
    for (const mesh of [this.body, this.head, this.legL, this.legR, this.skirt, this.bag]) {
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.instanceMatrix.needsUpdate = true;
    }

    this.setQuality(quality);
  }

  get activePedestrianCount(): number {
    return this.activeCount;
  }

  setQuality(quality: QualitySettings): void {
    this.activeCount = clamp(quality.pedestrians, 8, this.maxCapacity);
    for (const mesh of [this.body, this.head, this.legL, this.legR, this.skirt, this.bag]) {
      mesh.count = this.activeCount;
    }
    // Only torso capsule casts into shadow map (cuts 5/6ths of pedestrian shadow draw calls!)
    this.body.castShadow = quality.shadows;
  }

  private pickPathIndex(preferBusy: boolean): number {
    if (PED_PATHS.length === 0) return 0;
    if (preferBusy) {
      for (let k = 0; k < 5; k++) {
        const idx = Math.floor(this.rng() * PED_PATHS.length);
        if (PED_PATHS[idx].busy) return idx;
      }
    }
    return Math.floor(this.rng() * PED_PATHS.length);
  }

  private createAgent(idx: number): PedAgent {
    const pathIdx = this.pickPathIndex(idx % 3 !== 0);
    const p = PED_PATHS[pathIdx];
    const t = this.rng();
    const hasSkirt = this.rng() < 0.48; // saree / lungi drape!
    return {
      pathIdx,
      t,
      dir: this.rng() < 0.5 ? 1 : -1,
      speed: 0.82 + this.rng() * 0.68,
      pause: this.rng() * 2.4,
      phase: this.rng() * TAU,
      heightScale: 0.88 + this.rng() * 0.2,
      sideJitter: (this.rng() - 0.5) * 0.55,
      evadeAmount: 0,
      stumbleTimer: 0,
      reactCooldown: 0,
      hasSkirt,
      hasBag: this.rng() < 0.36,
      lookAtPlayer: 0,
      worldX: p ? p.ax + (p.bx - p.ax) * t : 0,
      worldZ: p ? p.az + (p.bz - p.az) * t : 0,
      farAccum: 0,
    };
  }

  /** Ringing the rickshaw bell alerts nearby walkers politely before near-miss distance! */
  alertBell(px: number, pz: number): void {
    for (let i = 0; i < this.activeCount; i++) {
      const ped = this.peds[i];
      const d = Math.hypot(ped.worldX - px, ped.worldZ - pz);
      if (d < 9.5) {
        ped.evadeAmount = Math.max(ped.evadeAmount, 0.85);
        ped.pause = Math.max(ped.pause, 0.8);
        ped.lookAtPlayer = 1;
      }
    }
  }

  update(
    dt: number,
    playerX: number,
    playerZ: number,
    playerSpeed: number,
    playerYaw = 0,
  ): void {
    if (PED_PATHS.length === 0) return;
    this.globalReactCooldown = Math.max(0, this.globalReactCooldown - dt);

    const absSpeed = Math.abs(playerSpeed);
    const pfx = Math.sin(playerYaw);
    const pfz = Math.cos(playerYaw);
    // Front wheel / nose point of player rickshaw for accurate near-miss & contact checks
    const noseX = playerX + pfx * 0.95;
    const noseZ = playerZ + pfz * 0.95;
    const predX = noseX + pfx * clamp(playerSpeed * 0.55, -1.2, 3.6);
    const predZ = noseZ + pfz * clamp(playerSpeed * 0.55, -1.2, 3.6);

    for (let i = 0; i < this.activeCount; i++) {
      const ped = this.peds[i];
      let path = PED_PATHS[ped.pathIdx];

      const dxCenter = ped.worldX - playerX;
      const dzCenter = ped.worldZ - playerZ;
      const distSq = dxCenter * dxCenter + dzCenter * dzCenter;

      // Recycle pedestrians > 155m away onto sidewalks within 45..125m of player so density stays rich!
      if (distSq > 155 * 155) {
        for (let tries = 0; tries < 7; tries++) {
          const candIdx = this.pickPathIndex(true);
          const cp = PED_PATHS[candIdx];
          const mx = (cp.ax + cp.bx) * 0.5;
          const mz = (cp.az + cp.bz) * 0.5;
          const cd = Math.hypot(mx - playerX, mz - playerZ);
          if (cd > 44 && cd < 126) {
            ped.pathIdx = candIdx;
            ped.t = this.rng();
            path = cp;
            break;
          }
        }
      }

      // Distance LOD tick: distant walkers (> 85m) run AI at ~20 Hz while gliding smoothly
      let stepDt = dt;
      if (distSq > 85 * 85) {
        ped.farAccum += dt;
        if (ped.farAccum < 0.05) {
          if (ped.pause <= 0 && distSq <= 135 * 135) {
            ped.t = clamp(ped.t + ((ped.speed * dt) / path.length) * ped.dir, 0, 1);
          }
          continue;
        }
        stepDt = ped.farAccum;
        ped.farAccum = 0;
      }

      if (ped.reactCooldown > 0) ped.reactCooldown = Math.max(0, ped.reactCooldown - stepDt);
      if (ped.stumbleTimer > 0) ped.stumbleTimer = Math.max(0, ped.stumbleTimer - stepDt);

      let approachingDanger = false;
      let dClosest = 999;

      // Fast broadphase: only evaluate 3x Math.hypot near-miss/bump math within ~10m of player!
      if (distSq < 100 || ped.evadeAmount > 0.01 || ped.lookAtPlayer > 0.01 || ped.stumbleTimer > 0) {
        const baseX = path.ax + (path.bx - path.ax) * ped.t + path.safeX * ped.sideJitter;
        const baseZ = path.az + (path.bz - path.az) * ped.t + path.safeZ * ped.sideJitter;
        const curX = baseX + path.safeX * ped.evadeAmount;
        const curZ = baseZ + path.safeZ * ped.evadeAmount;
        const dNose = Math.hypot(curX - noseX, curZ - noseZ);
        const dBody = Math.hypot(curX - playerX, curZ - playerZ);
        dClosest = Math.min(dNose, dBody);
        const dPred = Math.hypot(curX - predX, curZ - predZ);

        approachingDanger = (dPred < 4.2 && absSpeed > 0.7) || dClosest < 3.1;
        const targetEvade = ped.stumbleTimer > 0 ? 1.15 : approachingDanger ? 0.92 : 0;
        ped.evadeAmount = damp(ped.evadeAmount, targetEvade, approachingDanger ? 8.5 : 3.2, stepDt);
        ped.lookAtPlayer = damp(ped.lookAtPlayer, approachingDanger ? 1 : 0, 6, stepDt);

        if (dClosest < 1.06 && absSpeed > 0.45 && ped.stumbleTimer <= 0) {
          ped.stumbleTimer = 0.9;
          ped.pause = 1.4;
          ped.evadeAmount = 1.15;
          if (ped.reactCooldown <= 0) {
            ped.reactCooldown = 7.5;
            this.globalReactCooldown = 1.6;
            const key = REACTION_KEYS[Math.floor(this.rng() * REACTION_KEYS.length)];
            this.onReaction?.({ x: curX, y: 1.85, z: curZ, textKey: key, kind: 'bump' });
          }
        } else if (
          dClosest < 2.45 &&
          absSpeed > 1.85 &&
          ped.reactCooldown <= 0 &&
          this.globalReactCooldown <= 0
        ) {
          ped.reactCooldown = 8.5;
          this.globalReactCooldown = 2.6;
          ped.pause = Math.max(ped.pause, 0.95);
          const key = REACTION_KEYS[Math.floor(this.rng() * REACTION_KEYS.length)];
          this.onReaction?.({ x: curX, y: 1.85, z: curZ, textKey: key, kind: 'nearmiss' });
        }
      }

      // Advance sidewalk walk cycle unless paused/evading
      let moving = false;
      if (ped.pause > 0) {
        ped.pause -= stepDt;
      } else if (!approachingDanger || dClosest > 2.6) {
        moving = true;
        ped.t += ((ped.speed * stepDt) / path.length) * ped.dir;
        if (ped.t >= 1) {
          ped.t = 1;
          ped.dir = -1;
          ped.pause = 0.5 + this.rng() * 2.5;
        } else if (ped.t <= 0) {
          ped.t = 0;
          ped.dir = 1;
          ped.pause = 0.5 + this.rng() * 2.5;
        }
        ped.phase += stepDt * ped.speed * 5.4;
      }

      const lat = ped.sideJitter + ped.evadeAmount;
      const wx = path.ax + (path.bx - path.ax) * ped.t + path.safeX * lat;
      const wz = path.az + (path.bz - path.az) * ped.t + path.safeZ * lat;
      ped.worldX = wx;
      ped.worldZ = wz;

      // Hide far-off instances smoothly to save rasteriser fillrate
      if (distSq > 135 * 135) {
        this.scale.set(0, 0, 0);
        this.pos.set(wx, -10, wz);
        this.quat.identity();
        this.matrix.compose(this.pos, this.quat, this.scale);
        this.body.setMatrixAt(i, this.matrix);
        this.head.setMatrixAt(i, this.matrix);
        this.legL.setMatrixAt(i, this.matrix);
        this.legR.setMatrixAt(i, this.matrix);
        if (ped.hasSkirt) this.skirt.setMatrixAt(i, this.matrix);
        if (ped.hasBag) this.bag.setMatrixAt(i, this.matrix);
        continue;
      }

      const walkYaw = ped.dir === 1 ? path.fwdYaw : path.revYaw;
      let yaw = walkYaw;
      if (ped.lookAtPlayer > 0.01) {
        const toPlayerYaw = Math.atan2(playerX - wx, playerZ - wz);
        yaw = walkYaw + shortAngle(walkYaw, toPlayerYaw) * ped.lookAtPlayer;
      }
      const stumbleTilt = ped.stumbleTimer > 0 ? Math.sin(ped.stumbleTimer * 12) * 0.24 : 0;

      const swing = moving ? Math.sin(ped.phase) * 0.44 : 0;
      const bob = moving ? Math.abs(Math.cos(ped.phase)) * 0.028 : 0;
      const h = ped.heightScale;
      const groundY = 0.09;

      // Torso & head (with grounded stumble tilt if bumped)
      if (stumbleTilt !== 0) {
        this.euler.set(stumbleTilt, yaw, stumbleTilt * 0.5, 'YXZ');
        this.quat.setFromEuler(this.euler);
      } else {
        this.quat.setFromAxisAngle(Y_AXIS, yaw);
      }
      this.pos.set(wx, groundY + bob, wz);
      this.scale.set(h, h, h);
      this.matrix.compose(this.pos, this.quat, this.scale);
      this.body.setMatrixAt(i, this.matrix);
      this.head.setMatrixAt(i, this.matrix);

      if (ped.hasSkirt) {
        this.skirt.setMatrixAt(i, this.matrix);
      }

      const cosYaw = Math.cos(yaw);
      const sinYaw = Math.sin(yaw);

      if (ped.hasBag) {
        this.pos.set(wx - cosYaw * 0.23 * h, groundY + 0.68 * h + bob, wz + sinYaw * 0.23 * h);
        this.matrix.compose(this.pos, this.quat, this.scale);
        this.bag.setMatrixAt(i, this.matrix);
      }

      const hipX = -cosYaw * 0.08 * h;
      const hipZ = sinYaw * 0.08 * h;

      if (swing !== 0) {
        this.euler.set(swing, yaw, 0, 'YXZ');
        this.quat.setFromEuler(this.euler);
      }
      this.pos.set(wx + hipX, groundY + 0.54 * h, wz + hipZ);
      this.matrix.compose(this.pos, this.quat, this.scale);
      this.legL.setMatrixAt(i, this.matrix);

      if (swing !== 0) {
        this.euler.set(-swing, yaw, 0, 'YXZ');
        this.quat.setFromEuler(this.euler);
      }
      this.pos.set(wx - hipX, groundY + 0.54 * h, wz - hipZ);
      this.matrix.compose(this.pos, this.quat, this.scale);
      this.legR.setMatrixAt(i, this.matrix);
    }

    this.body.instanceMatrix.needsUpdate = true;
    this.head.instanceMatrix.needsUpdate = true;
    this.legL.instanceMatrix.needsUpdate = true;
    this.legR.instanceMatrix.needsUpdate = true;
    this.skirt.instanceMatrix.needsUpdate = true;
    this.bag.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.body.geometry.dispose();
    this.head.geometry.dispose();
    this.legL.geometry.dispose();
    this.skirt.geometry.dispose();
    this.bag.geometry.dispose();
    (this.body.material as THREE.Material).dispose();
    this.group.clear();
  }
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);

function shortAngle(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
