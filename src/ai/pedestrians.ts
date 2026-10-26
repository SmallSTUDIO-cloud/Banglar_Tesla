/**
 * Dense, varied Mohammadpur pedestrian crowd (Sections 12, 13 & v0.5.0 §29):
 *   - Rendered via 9 InstancedMeshes sharing ONE material (~9 draw calls total
 *     for up to 96 animated pedestrians with visible faces, eyes/brows/mouth,
 *     hair/topi/orna silhouettes, attached swinging arms & hands, legs & sandals,
 *     sarees/lungis/kurtas, and shopping bags).
 *   - Walks along real Mohammadpur sidewalks & market plazas, recycling distant
 *     walkers (>155m) into corridors near the player so streets always feel lively.
 *   - Distance LOD: full arm/leg swing & head look-at within 58m, simplified pose
 *     beyond 58m, 20 Hz throttled AI beyond 85m, hidden beyond 135m — zero
 *     per-frame heap allocations and 100% preserved crowd density!
 */

import * as THREE from 'three';
import { QUALITY, type QualitySettings } from '../core/config';
import { clamp, damp, mulberry32, TAU } from '../core/mathx';
import { Bucket } from '../world/geo';
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
      const az = seg.az + seg.uz * margin + seg.leftX * 0 + seg.leftZ * lat;
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
const SKIN_TONES = ['#8b5a3c', '#9e6845', '#704730', '#ad7650', '#946242'];
const HAIR_HEADWEAR_COLORS = [
  '#151518', // jet-black hair
  '#241a16', // dark espresso hair
  '#18181b', // natural black hair
  '#f5f5f0', // white cotton prayer topi
  '#1e3a8a', // navy cap
  '#9f1239', // maroon headscarf / orna
  '#065f46', // deep teal headscarf
  '#b45309', // ochre cap / wrap
];
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

function buildPedBodyGeo(mat: THREE.Material): THREE.BufferGeometry {
  const b = new Bucket('ped.body', mat);
  // Chest & lower tunic/kurta hem
  b.box({ x: 0, y: 1.08, z: 0 }, { x: 0.33, y: 0.44, z: 0.20 }, '#ffffff');
  b.box({ x: 0, y: 0.80, z: 0 }, { x: 0.35, y: 0.20, z: 0.22 }, '#f5f5f5');
  // Collar neckline + short-sleeve shoulder caps so attached arms emerge cleanly from sleeves
  b.cylinder({ x: 0, y: 1.31, z: 0 }, 0.085, 0.06, '#e8e8e8');
  b.box({ x: -0.205, y: 1.22, z: 0 }, { x: 0.11, y: 0.16, z: 0.14 }, '#ffffff', { z: 0.14 });
  b.box({ x: 0.205, y: 1.22, z: 0 }, { x: 0.11, y: 0.16, z: 0.14 }, '#ffffff', { z: -0.14 });
  return b.build({ cast: true, receive: false })!.geometry;
}

function buildPedHeadGeo(mat: THREE.Material): THREE.BufferGeometry {
  const b = new Bucket('ped.head', mat);
  // Neck + sculpted head (`#ffffff` multiplies with `SKIN_TONES` instanceColor)
  b.cylinder({ x: 0, y: 1.36, z: 0 }, 0.052, 0.10, '#f2e8e2');
  const sphere = new THREE.SphereGeometry(0.112, 10, 8);
  b.add(sphere, { x: 0, y: 1.49, z: 0 }, { x: 0.94, y: 1.06, z: 0.98 }, '#ffffff');
  sphere.dispose();

  // Ears + nose bridge (`+Z` is forward walking direction)
  b.box({ x: -0.105, y: 1.49, z: -0.005 }, { x: 0.024, y: 0.048, z: 0.032 }, '#ebd8cf');
  b.box({ x: 0.105, y: 1.49, z: -0.005 }, { x: 0.024, y: 0.048, z: 0.032 }, '#ebd8cf');
  b.box({ x: 0, y: 1.485, z: 0.108 }, { x: 0.026, y: 0.044, z: 0.030 }, '#f5e6de');

  // Visible facial features: eyebrows, eye sclera, dark pupils, and mouth expression!
  for (const sx of [-1, 1]) {
    b.box({ x: sx * 0.040, y: 1.530, z: 0.102 }, { x: 0.034, y: 0.011, z: 0.014 }, '#1c1513');
    b.box({ x: sx * 0.039, y: 1.506, z: 0.104 }, { x: 0.030, y: 0.018, z: 0.012 }, '#ffffff');
    b.box({ x: sx * 0.039, y: 1.505, z: 0.110 }, { x: 0.014, y: 0.014, z: 0.008 }, '#120e0d');
  }
  b.box({ x: 0, y: 1.444, z: 0.102 }, { x: 0.044, y: 0.013, z: 0.012 }, '#542422');
  return b.build({ cast: false, receive: false })!.geometry;
}

function buildPedHairGeo(mat: THREE.Material): THREE.BufferGeometry {
  const b = new Bucket('ped.hair', mat);
  // Full hair/topi/headscarf crown sitting cleanly atop `headGeo` without covering eyes
  const cap = new THREE.SphereGeometry(0.118, 9, 6, 0, Math.PI * 2, 0, Math.PI * 0.56);
  b.add(cap, { x: 0, y: 1.505, z: -0.006 }, { x: 0.98, y: 1.02, z: 1.02 }, '#ffffff');
  cap.dispose();
  // Back hair / nape volume + sideburns + subtle front brow brim
  b.box({ x: 0, y: 1.47, z: -0.075 }, { x: 0.19, y: 0.13, z: 0.08 }, '#eaeaea');
  b.box({ x: -0.098, y: 1.50, z: 0.01 }, { x: 0.025, y: 0.08, z: 0.09 }, '#f0f0f0');
  b.box({ x: 0.098, y: 1.50, z: 0.01 }, { x: 0.025, y: 0.08, z: 0.09 }, '#f0f0f0');
  b.box({ x: 0, y: 1.565, z: 0.078 }, { x: 0.16, y: 0.026, z: 0.07 }, '#ffffff', { x: 0.18 });
  return b.build({ cast: false, receive: false })!.geometry;
}

function buildPedArmGeo(mat: THREE.Material): THREE.BufferGeometry {
  const b = new Bucket('ped.arm', mat);
  // Pivots at shoulder `(0, 0, 0)`: upper arm -> forearm -> wrist band -> palm & thumb!
  b.cylinder({ x: 0, y: -0.11, z: 0 }, 0.040, 0.22, '#f5ebe6');
  b.cylinder({ x: 0, y: -0.29, z: 0.018 }, 0.034, 0.20, '#ffffff', { x: -0.14 });
  b.cylinder({ x: 0, y: -0.38, z: 0.030 }, 0.037, 0.022, '#2d2622', { x: -0.14 });
  // Attached visible hand + fingers + thumb
  b.box({ x: 0, y: -0.435, z: 0.042 }, { x: 0.046, y: 0.078, z: 0.058 }, '#ffffff', { x: -0.12 });
  b.box({ x: 0, y: -0.418, z: 0.074 }, { x: 0.024, y: 0.036, z: 0.026 }, '#f2e4dc', { x: -0.35 });
  return b.build({ cast: false, receive: false })!.geometry;
}

function buildPedLegGeo(mat: THREE.Material): THREE.BufferGeometry {
  const b = new Bucket('ped.leg', mat);
  // Pivots at hip `(0, 0, 0)`: trouser leg + ankle + visible South Asian sandal/shoe!
  b.box({ x: 0, y: -0.23, z: 0 }, { x: 0.108, y: 0.44, z: 0.125 }, '#ffffff');
  b.cylinder({ x: 0, y: -0.47, z: 0 }, 0.040, 0.08, '#9e6b49');
  // Sandal sole + forefoot strap (`+Z` forward toe)
  b.box({ x: 0, y: -0.522, z: 0.034 }, { x: 0.106, y: 0.034, z: 0.195 }, '#231915');
  b.box({ x: 0, y: -0.498, z: 0.052 }, { x: 0.108, y: 0.022, z: 0.065 }, '#3d291f');
  return b.build({ cast: false, receive: false })!.geometry;
}

function buildPedSkirtGeo(mat: THREE.Material): THREE.BufferGeometry {
  const b = new Bucket('ped.skirt', mat);
  b.cone({ x: 0, y: 0.56, z: 0 }, 0.25, 0.68, '#ffffff');
  b.cylinder({ x: 0, y: 0.24, z: 0 }, 0.245, 0.045, '#e8dfd1');
  return b.build({ cast: false, receive: false })!.geometry;
}

function buildPedBagGeo(mat: THREE.Material): THREE.BufferGeometry {
  const b = new Bucket('ped.bag', mat);
  b.box({ x: 0, y: 0, z: 0 }, { x: 0.22, y: 0.25, z: 0.12 }, '#ffffff');
  b.box({ x: 0, y: 0.15, z: 0 }, { x: 0.11, y: 0.07, z: 0.04 }, '#28221e');
  return b.build({ cast: false, receive: false })!.geometry;
}

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
  hairScaleY: number;
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
  private hair: THREE.InstancedMesh;
  private armL: THREE.InstancedMesh;
  private armR: THREE.InstancedMesh;
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
    this.maxCapacity = Math.max(96, QUALITY.pc_high.pedestrians);
    this.group.name = 'mohammadpur-pedestrians';

    // ONE shared matte Lambertian material with vertexColors across all 9 instanced body parts!
    const sharedPedMat = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      vertexColors: true,
    });

    const bodyGeo = buildPedBodyGeo(sharedPedMat);
    const headGeo = buildPedHeadGeo(sharedPedMat);
    const hairGeo = buildPedHairGeo(sharedPedMat);
    const armGeo = buildPedArmGeo(sharedPedMat);
    const legGeo = buildPedLegGeo(sharedPedMat);
    const skirtGeo = buildPedSkirtGeo(sharedPedMat);
    const bagGeo = buildPedBagGeo(sharedPedMat);

    this.body = new THREE.InstancedMesh(bodyGeo, sharedPedMat, this.maxCapacity);
    this.head = new THREE.InstancedMesh(headGeo, sharedPedMat, this.maxCapacity);
    this.hair = new THREE.InstancedMesh(hairGeo, sharedPedMat, this.maxCapacity);
    this.armL = new THREE.InstancedMesh(armGeo, sharedPedMat, this.maxCapacity);
    this.armR = new THREE.InstancedMesh(armGeo, sharedPedMat, this.maxCapacity);
    this.legL = new THREE.InstancedMesh(legGeo, sharedPedMat, this.maxCapacity);
    this.legR = new THREE.InstancedMesh(legGeo, sharedPedMat, this.maxCapacity);
    this.skirt = new THREE.InstancedMesh(skirtGeo, sharedPedMat, this.maxCapacity);
    this.bag = new THREE.InstancedMesh(bagGeo, sharedPedMat, this.maxCapacity);

    this.body.name = 'ped.body';
    this.head.name = 'ped.head';
    this.hair.name = 'ped.hair';
    this.armL.name = 'ped.armL';
    this.armR.name = 'ped.armR';
    this.legL.name = 'ped.legL';
    this.legR.name = 'ped.legR';
    this.skirt.name = 'ped.skirt';
    this.bag.name = 'ped.bag';

    const allMeshes = [
      this.body,
      this.head,
      this.hair,
      this.armL,
      this.armR,
      this.legL,
      this.legR,
      this.skirt,
      this.bag,
    ];
    for (const mesh of allMeshes) {
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
      const skinHex = SKIN_TONES[Math.floor(this.rng() * SKIN_TONES.length)];
      cTmp.set(TOP_COLORS[Math.floor(this.rng() * TOP_COLORS.length)]);
      this.body.setColorAt(i, cTmp);
      cTmp.set(skinHex);
      this.head.setColorAt(i, cTmp);
      this.armL.setColorAt(i, cTmp);
      this.armR.setColorAt(i, cTmp);
      cTmp.set(HAIR_HEADWEAR_COLORS[Math.floor(this.rng() * HAIR_HEADWEAR_COLORS.length)]);
      this.hair.setColorAt(i, cTmp);
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
    for (const mesh of allMeshes) {
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.instanceMatrix.needsUpdate = true;
    }

    this.setQuality(quality);
  }

  get activePedestrianCount(): number {
    return this.activeCount;
  }

  /** Diagnostics helper for automated §29 NPC character verification. */
  getCharacterMeshSummary(): {
    activeCount: number;
    hasHead: boolean;
    hasHair: boolean;
    hasLeftArm: boolean;
    hasRightArm: boolean;
    hasLegs: boolean;
  } {
    return {
      activeCount: this.activeCount,
      hasHead: this.head.count > 0 && this.head.geometry.attributes.position.count > 40,
      hasHair: this.hair.count > 0 && this.hair.geometry.attributes.position.count > 20,
      hasLeftArm: this.armL.count > 0 && this.armL.geometry.attributes.position.count > 30,
      hasRightArm: this.armR.count > 0 && this.armR.geometry.attributes.position.count > 30,
      hasLegs: this.legL.count > 0 && this.legR.count > 0,
    };
  }

  setQuality(quality: QualitySettings): void {
    this.activeCount = clamp(quality.pedestrians, 8, this.maxCapacity);
    for (const mesh of [
      this.body,
      this.head,
      this.hair,
      this.armL,
      this.armR,
      this.legL,
      this.legR,
      this.skirt,
      this.bag,
    ]) {
      mesh.count = this.activeCount;
    }
    // Only torso casts into shadow map (cuts 8/9ths of pedestrian shadow draw calls!)
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
      hairScaleY: 0.94 + this.rng() * 0.14,
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
        this.hair.setMatrixAt(i, this.matrix);
        this.armL.setMatrixAt(i, this.matrix);
        this.armR.setMatrixAt(i, this.matrix);
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

      const nearLod = distSq <= 58 * 58;
      const swing = moving && nearLod ? Math.sin(ped.phase) * 0.44 : 0;
      const bob = moving && nearLod ? Math.abs(Math.cos(ped.phase)) * 0.028 : 0;
      const h = ped.heightScale;
      const groundY = 0.09;

      // Torso, head & hair/headwear
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

      this.scale.set(h, h * ped.hairScaleY, h);
      this.matrix.compose(this.pos, this.quat, this.scale);
      this.hair.setMatrixAt(i, this.matrix);
      this.scale.set(h, h, h);

      const cosYaw = Math.cos(yaw);
      const sinYaw = Math.sin(yaw);

      // Attached shoulders, swinging arms & hands (`armL` at +X local, `armR` at -X local)
      const shoulderY = groundY + 1.24 * h + bob;
      const shOffX = cosYaw * 0.205 * h;
      const shOffZ = -sinYaw * 0.205 * h;

      // Left arm swings opposite to left leg (or raises slightly in alarm when evading!)
      const evadeRaise = ped.evadeAmount > 0.25 ? -0.45 * ped.evadeAmount : 0;
      const armSwingL = swing !== 0 ? -swing * 0.82 : evadeRaise;
      if (armSwingL !== 0) {
        this.euler.set(armSwingL, yaw, 0.05, 'YXZ');
        this.quat.setFromEuler(this.euler);
      } else {
        this.quat.setFromAxisAngle(Y_AXIS, yaw);
      }
      this.pos.set(wx + shOffX, shoulderY, wz + shOffZ);
      this.matrix.compose(this.pos, this.quat, this.scale);
      this.armL.setMatrixAt(i, this.matrix);

      // Right arm holds shopping bag steady when `hasBag`, otherwise counter-swings naturally
      const armSwingR = ped.hasBag ? -0.18 : swing !== 0 ? swing * 0.82 : evadeRaise;
      if (armSwingR !== 0) {
        this.euler.set(armSwingR, yaw, -0.05, 'YXZ');
        this.quat.setFromEuler(this.euler);
      } else {
        this.quat.setFromAxisAngle(Y_AXIS, yaw);
      }
      this.pos.set(wx - shOffX, shoulderY, wz - shOffZ);
      this.matrix.compose(this.pos, this.quat, this.scale);
      this.armR.setMatrixAt(i, this.matrix);

      if (ped.hasBag) {
        this.pos.set(wx - cosYaw * 0.225 * h, groundY + 0.66 * h + bob, wz + sinYaw * 0.225 * h);
        this.quat.setFromAxisAngle(Y_AXIS, yaw);
        this.matrix.compose(this.pos, this.quat, this.scale);
        this.bag.setMatrixAt(i, this.matrix);
      }

      const hipX = cosYaw * 0.082 * h;
      const hipZ = -sinYaw * 0.082 * h;

      if (swing !== 0) {
        this.euler.set(swing, yaw, 0, 'YXZ');
        this.quat.setFromEuler(this.euler);
      } else {
        this.quat.setFromAxisAngle(Y_AXIS, yaw);
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
    this.hair.instanceMatrix.needsUpdate = true;
    this.armL.instanceMatrix.needsUpdate = true;
    this.armR.instanceMatrix.needsUpdate = true;
    this.legL.instanceMatrix.needsUpdate = true;
    this.legR.instanceMatrix.needsUpdate = true;
    this.skirt.instanceMatrix.needsUpdate = true;
    this.bag.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.body.geometry.dispose();
    this.head.geometry.dispose();
    this.hair.geometry.dispose();
    this.armL.geometry.dispose();
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
