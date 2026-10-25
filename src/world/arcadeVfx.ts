/**
 * Pooled Exaggerated Arcade VFX System (v0.5.0 — Sections 7, 14, 21, 22, 28).
 *
 * Strictly zero per-frame heap allocations, zero dynamic lights, `castShadow = false`:
 *   1. Twin rear `টার্বো` (Turbo) exhaust/frame flame plumes attached to the player
 *      rickshaw, scaling smoothly with `turboBlend` and hiding immediately on release.
 *   2. Single pooled `THREE.InstancedMesh` (64 slots) driving:
 *        - Turbo wheel energy sparks + dry road dust / monsoon water spray
 *        - Minor / Medium / Major exaggerated arcade crash bursts (golden sparks,
 *          painted rickshaw/prop chips, directional dust plumes)
 *   3. Brief screen-safe impact flash & hit-stop scale for dramatic high-speed crashes
 *      with rapid recovery (< 0.55s) so players never lose control unfairly.
 */

import * as THREE from 'three';
import { clamp, clamp01 } from '../core/mathx';

export type CrashTier = 'minor' | 'medium' | 'major';

export function classifyCrashTier(impulseMagnitude: number): CrashTier | null {
  if (impulseMagnitude < 0.48) return null;
  if (impulseMagnitude < 1.25) return 'minor';
  if (impulseMagnitude < 2.15) return 'medium';
  return 'major';
}

const MAX_VFX_PARTICLES = 64;

const COL_SPARK_GOLD = new THREE.Color(0xffc940);
const COL_SPARK_WHITE = new THREE.Color(0xfff5cc);
const COL_TURBO_CYAN = new THREE.Color(0x52f2ff);
const COL_DUST_DRY = new THREE.Color(0xcab696);
const COL_SPRAY_WET = new THREE.Color(0xbce8ff);
const COL_CHIP_RED = new THREE.Color(0xd93829);
const COL_CHIP_TEAL = new THREE.Color(0x1b8a6b);

export class ArcadeVfxSystem {
  readonly worldGroup = new THREE.Group();
  readonly flameGroup = new THREE.Group();

  private readonly outerFlames: [THREE.Mesh, THREE.Mesh];
  private readonly innerFlames: [THREE.Mesh, THREE.Mesh];
  private readonly outerMat: THREE.MeshBasicMaterial;
  private readonly innerMat: THREE.MeshBasicMaterial;

  private readonly particleMesh: THREE.InstancedMesh;
  private readonly active = new Uint8Array(MAX_VFX_PARTICLES);
  private readonly px = new Float32Array(MAX_VFX_PARTICLES);
  private readonly py = new Float32Array(MAX_VFX_PARTICLES);
  private readonly pz = new Float32Array(MAX_VFX_PARTICLES);
  private readonly vx = new Float32Array(MAX_VFX_PARTICLES);
  private readonly vy = new Float32Array(MAX_VFX_PARTICLES);
  private readonly vz = new Float32Array(MAX_VFX_PARTICLES);
  private readonly pLife = new Float32Array(MAX_VFX_PARTICLES);
  private readonly pMaxLife = new Float32Array(MAX_VFX_PARTICLES);
  private readonly pScaleX = new Float32Array(MAX_VFX_PARTICLES);
  private readonly pScaleY = new Float32Array(MAX_VFX_PARTICLES);
  private readonly pScaleZ = new Float32Array(MAX_VFX_PARTICLES);
  private readonly pGravity = new Float32Array(MAX_VFX_PARTICLES);
  private readonly pKind = new Uint8Array(MAX_VFX_PARTICLES); // 0 = spark, 1 = dust/spray, 2 = debris chip
  private readonly pColors: THREE.Color[] = Array.from(
    { length: MAX_VFX_PARTICLES },
    () => new THREE.Color(0xffffff),
  );

  private cursor = 0;
  private turboEmitAccum = 0;
  private clock = 0;
  private rngState = 0x51a7f31d;

  /** Screen-space impact flash intensity 0..1 (decays rapidly, 0 when reduceEffects). */
  impactFlash = 0;
  /** Hit-feel brief time-scale dip timer (seconds). */
  private hitSlowTimer = 0;
  private reduceEffects = false;

  private readonly tmpMat = new THREE.Matrix4();
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpScale = new THREE.Vector3();
  private readonly yAxis = new THREE.Vector3(0, 1, 0);

  constructor(rickshawMount: THREE.Object3D, sceneParent: THREE.Object3D) {
    this.worldGroup.name = 'arcade-vfx-world';
    this.flameGroup.name = 'rickshaw-turbo-flames';
    this.flameGroup.visible = false;

    // Cone tips point backward (-Z): ConeGeometry points +Y by default, so rotateX(-PI/2) points +Z, rotateX(+PI/2) points -Z -> base at origin, tip at -Z!
    const coneGeo = new THREE.ConeGeometry(0.13, 1.0, 7, 1, true);
    coneGeo.translate(0, -0.5, 0); // base at y=0, tip at y=-1
    coneGeo.rotateX(Math.PI * 0.5); // base at z=0, tip at z=-1!

    this.outerMat = new THREE.MeshBasicMaterial({
      color: 0xff6d1a,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.innerMat = new THREE.MeshBasicMaterial({
      color: 0xa8f9ff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const mkFlame = (mat: THREE.Material, x: number): THREE.Mesh => {
      const m = new THREE.Mesh(coneGeo, mat);
      m.position.set(x, 0.42, -0.78);
      m.castShadow = false;
      m.receiveShadow = false;
      this.flameGroup.add(m);
      return m;
    };

    this.outerFlames = [mkFlame(this.outerMat, -0.31), mkFlame(this.outerMat, 0.31)];
    this.innerFlames = [mkFlame(this.innerMat, -0.31), mkFlame(this.innerMat, 0.31)];
    rickshawMount.add(this.flameGroup);

    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const partMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    });
    this.particleMesh = new THREE.InstancedMesh(boxGeo, partMat, MAX_VFX_PARTICLES);
    this.particleMesh.name = 'arcade-vfx-particles';
    this.particleMesh.castShadow = false;
    this.particleMesh.receiveShadow = false;
    this.particleMesh.frustumCulled = false;
    this.particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_VFX_PARTICLES; i++) {
      this.particleMesh.setColorAt(i, COL_SPARK_GOLD);
    }
    this.particleMesh.count = 0;
    this.worldGroup.add(this.particleMesh);
    sceneParent.add(this.worldGroup);
  }

  setReduceEffects(reduce: boolean): void {
    this.reduceEffects = reduce;
    if (reduce) {
      this.impactFlash = 0;
      this.hitSlowTimer = 0;
    }
  }

  /** Time-scale factor (1.0 normally; brief 0.58 punch for 0.14s on Major crash). */
  getTimeScale(): number {
    if (this.reduceEffects || this.hitSlowTimer <= 0) return 1;
    return 0.58;
  }

  getActiveParticleCount(): number {
    return this.particleMesh.count;
  }

  /** Prewarm flame & particle shaders at boot so first Turbo/crash has zero GPU compile hitch. */
  withPrewarmState(run: () => void): void {
    const prevFlame = this.flameGroup.visible;
    const prevCount = this.particleMesh.count;
    this.flameGroup.visible = true;
    this.particleMesh.count = 1;
    try {
      run();
    } finally {
      this.flameGroup.visible = prevFlame;
      this.particleMesh.count = prevCount;
    }
  }

  private rand(): number {
    let x = this.rngState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rngState = x >>> 0;
    return (this.rngState & 0xfffffff) / 0x10000000;
  }

  private spawnParticle(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    sx: number,
    sy: number,
    sz: number,
    life: number,
    gravity: number,
    kind: number,
    color: THREE.Color,
  ): void {
    const idx = this.cursor;
    this.cursor = (this.cursor + 1) % MAX_VFX_PARTICLES;
    this.active[idx] = 1;
    this.px[idx] = x;
    this.py[idx] = y;
    this.pz[idx] = z;
    this.vx[idx] = vx;
    this.vy[idx] = vy;
    this.vz[idx] = vz;
    this.pScaleX[idx] = sx;
    this.pScaleY[idx] = sy;
    this.pScaleZ[idx] = sz;
    this.pLife[idx] = 0;
    this.pMaxLife[idx] = life;
    this.pGravity[idx] = gravity;
    this.pKind[idx] = kind;
    this.pColors[idx].copy(color);
  }

  /** Spawn tiered arcade crash burst at contact point with zero heap allocations. */
  triggerCrash(
    tier: CrashTier,
    x: number,
    y: number,
    z: number,
    nx: number,
    nz: number,
    wetness: number,
  ): void {
    const count = this.reduceEffects
      ? tier === 'major'
        ? 10
        : 5
      : tier === 'major'
        ? 30
        : tier === 'medium'
          ? 16
          : 8;
    const speedBase = tier === 'major' ? 7.8 : tier === 'medium' ? 5.2 : 3.4;

    if (!this.reduceEffects) {
      if (tier === 'major') {
        this.impactFlash = 0.72;
        this.hitSlowTimer = 0.14;
      } else if (tier === 'medium') {
        this.impactFlash = Math.max(this.impactFlash, 0.34);
      }
    }

    for (let i = 0; i < count; i++) {
      const ang = this.rand() * Math.PI * 2;
      const spread = speedBase * (0.35 + this.rand() * 0.85);
      const bvx = Math.cos(ang) * spread + nx * speedBase * 0.45;
      const bvz = Math.sin(ang) * spread + nz * speedBase * 0.45;
      const bvy = 1.6 + this.rand() * (tier === 'major' ? 5.2 : 3.2);

      if (i % 3 !== 2) {
        // Hot golden/white arcade impact sparks
        this.spawnParticle(
          x,
          y + 0.45 + this.rand() * 0.35,
          z,
          bvx * 1.15,
          bvy,
          bvz * 1.15,
          0.055,
          0.055,
          0.24 + this.rand() * 0.18,
          0.26 + this.rand() * 0.24,
          12.5,
          0,
          i % 2 === 0 ? COL_SPARK_GOLD : COL_SPARK_WHITE,
        );
      } else if (tier !== 'minor' && i % 2 === 0) {
        // Painted rickshaw/prop chip shard
        this.spawnParticle(
          x,
          y + 0.55,
          z,
          bvx * 0.75,
          bvy * 1.1,
          bvz * 0.75,
          0.11,
          0.04,
          0.14,
          0.42 + this.rand() * 0.28,
          13.5,
          2,
          i % 4 === 0 ? COL_CHIP_RED : COL_CHIP_TEAL,
        );
      } else {
        // Dust or monsoon splash puff
        this.spawnParticle(
          x,
          y + 0.22,
          z,
          bvx * 0.42,
          0.7 + this.rand() * 1.2,
          bvz * 0.42,
          0.28,
          0.22,
          0.28,
          0.35 + this.rand() * 0.25,
          1.2,
          1,
          wetness > 0.35 ? COL_SPRAY_WET : COL_DUST_DRY,
        );
      }
    }
  }

  /** Immediately clear flames, flashes, and particles (pause / menu / reset). */
  clearAll(): void {
    this.flameGroup.visible = false;
    this.impactFlash = 0;
    this.hitSlowTimer = 0;
    this.active.fill(0);
    this.particleMesh.count = 0;
  }

  update(
    dt: number,
    px: number,
    py: number,
    pz: number,
    pyaw: number,
    speed: number,
    turboActive: boolean,
    turboBlend: number,
    wetness: number,
  ): void {
    this.clock += dt;
    this.hitSlowTimer = Math.max(0, this.hitSlowTimer - dt);
    this.impactFlash = Math.max(0, this.impactFlash - dt * 3.6);

    // 1. Twin Rear Turbo Flames
    if (turboActive && turboBlend > 0.02) {
      this.flameGroup.visible = true;
      const pulseA = 0.86 + Math.sin(this.clock * 46) * 0.18 + Math.cos(this.clock * 73) * 0.1;
      const pulseB = 0.86 + Math.cos(this.clock * 51) * 0.18 + Math.sin(this.clock * 67) * 0.1;
      const len = (this.reduceEffects ? 0.85 : 1.45) * clamp(turboBlend, 0.2, 1.0);
      this.outerFlames[0].scale.set(1.05, 1.05, len * pulseA);
      this.outerFlames[1].scale.set(1.05, 1.05, len * pulseB);
      this.innerFlames[0].scale.set(0.56, 0.56, len * 0.72 * pulseB);
      this.innerFlames[1].scale.set(0.56, 0.56, len * 0.72 * pulseA);
      this.outerMat.opacity = 0.78 + 0.18 * turboBlend;

      // Wheel sparks + surface spray/dust while boosting
      this.turboEmitAccum += dt * (this.reduceEffects ? 14 : 34);
      const fx = Math.sin(pyaw);
      const fz = Math.cos(pyaw);
      const lx = fz;
      const lz = -fx;
      while (this.turboEmitAccum >= 1) {
        this.turboEmitAccum -= 1;
        const side = this.rand() < 0.5 ? -0.46 : 0.46;
        const wx = px - fx * 0.72 + lx * side;
        const wz = pz - fz * 0.72 + lz * side;
        const backSpeed = Math.max(2.5, speed * 0.35);
        if (this.rand() < 0.62) {
          this.spawnParticle(
            wx,
            py + 0.14,
            wz,
            -fx * backSpeed + (this.rand() - 0.5) * 1.8,
            0.9 + this.rand() * 1.9,
            -fz * backSpeed + (this.rand() - 0.5) * 1.8,
            0.045,
            0.045,
            0.22,
            0.22 + this.rand() * 0.14,
            9.5,
            0,
            this.rand() < 0.45 ? COL_TURBO_CYAN : COL_SPARK_GOLD,
          );
        } else {
          this.spawnParticle(
            wx,
            py + 0.16,
            wz,
            -fx * backSpeed * 0.5 + (this.rand() - 0.5) * 1.3,
            0.55 + this.rand() * 0.9,
            -fz * backSpeed * 0.5 + (this.rand() - 0.5) * 1.3,
            0.24,
            0.18,
            0.24,
            0.26 + this.rand() * 0.16,
            0.8,
            1,
            wetness > 0.35 ? COL_SPRAY_WET : COL_DUST_DRY,
          );
        }
      }
    } else {
      this.flameGroup.visible = false;
      this.turboEmitAccum = 0;
    }

    // 2. Integrate active pooled particles into contiguous InstancedMesh slots
    let liveCount = 0;
    for (let i = 0; i < MAX_VFX_PARTICLES; i++) {
      if (this.active[i] === 0) continue;
      const nextLife = this.pLife[i] + dt;
      const maxL = this.pMaxLife[i];
      if (nextLife >= maxL) {
        this.active[i] = 0;
        continue;
      }
      this.pLife[i] = nextLife;
      this.vy[i] -= this.pGravity[i] * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      if (this.py[i] < py + 0.04) {
        this.py[i] = py + 0.04;
        this.vy[i] = Math.abs(this.vy[i]) * 0.28;
      }

      const tNorm = clamp01(nextLife / maxL);
      const fade = this.pKind[i] === 1 ? 1 + tNorm * 0.85 : 1 - tNorm * 0.72;
      const yaw = Math.atan2(this.vx[i], this.vz[i]);
      this.tmpPos.set(this.px[i], this.py[i], this.pz[i]);
      this.tmpQuat.setFromAxisAngle(this.yAxis, yaw);
      this.tmpScale.set(
        this.pScaleX[i] * fade,
        this.pScaleY[i] * fade,
        this.pScaleZ[i] * (this.pKind[i] === 0 ? 1 + (1 - tNorm) * 0.6 : fade),
      );
      this.tmpMat.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
      this.particleMesh.setMatrixAt(liveCount, this.tmpMat);
      this.particleMesh.setColorAt(liveCount, this.pColors[i]);
      liveCount++;
    }

    this.particleMesh.count = liveCount;
    if (liveCount > 0) {
      this.particleMesh.instanceMatrix.needsUpdate = true;
      if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    this.clearAll();
    this.flameGroup.removeFromParent();
    this.worldGroup.removeFromParent();
    this.outerFlames[0].geometry.dispose();
    this.outerMat.dispose();
    this.innerMat.dispose();
    this.particleMesh.geometry.dispose();
    (this.particleMesh.material as THREE.Material).dispose();
  }
}
