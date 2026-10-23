/**
 * Pedestrians: instanced (4 draw calls for the whole crowd), walking along
 * sidewalk paths, pausing, and stepping aside for the rickshaw.
 */

import * as THREE from 'three';
import { clamp, damp, mulberry32, TAU } from '../core/mathx';
import type { QualitySettings } from '../core/config';

export interface PathDef {
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

/** Sidewalk walking lanes. Kept clear of junctions so nobody walks through traffic. */
export const PED_PATHS: PathDef[] = [
  { ax: 6.2, az: -46, bx: 6.2, bz: 46 },
  { ax: -6.2, az: -46, bx: -6.2, bz: 46 },
  { ax: 6.2, az: 8.2, bx: 40, bz: 8.2 },
  { ax: -6.2, az: -8.2, bx: -40, bz: -8.2 },
  { ax: -45.5, az: -52, bx: -45.5, bz: 52 },
  { ax: 45.5, az: -52, bx: 45.5, bz: 52 },
  { ax: -44, az: 51.5, bx: 44, bz: 51.5 },
  { ax: -44, az: -51.5, bx: 44, bz: -51.5 },
  { ax: 8.5, az: 20, bx: 26, bz: 20 },
  { ax: -8.5, az: -20, bx: -26, bz: -20 },
];

const SHIRT_COLORS = ['#c9d8e8', '#e8c9c9', '#e8e0b8', '#b8e0c9', '#e8d4a8', '#d8c9e8', '#f0f0e8', '#8a5a3a', '#2f5a7a'];
const SKIN_TONES = ['#8a5a3c', '#a06a44', '#6f4630', '#b47a52'];
const LEG_COLORS = ['#2a2a30', '#3a4a5a', '#5a4a3a', '#d8d0c0'];

interface Ped {
  path: number;
  t: number;
  dir: 1 | -1;
  speed: number;
  pause: number;
  phase: number;
  height: number;
  sideOffset: number;
  stepAside: number;
  skirt: number;
}

export class PedestrianSystem {
  readonly group = new THREE.Group();
  private peds: Ped[] = [];
  private body: THREE.InstancedMesh;
  private head: THREE.InstancedMesh;
  private legL: THREE.InstancedMesh;
  private legR: THREE.InstancedMesh;
  private skirt: THREE.InstancedMesh;
  private maxCount: number;
  private rng = mulberry32(7331);
  private matrix = new THREE.Matrix4();
  private quat = new THREE.Quaternion();
  private pos = new THREE.Vector3();
  private scale = new THREE.Vector3(1, 1, 1);
  constructor(quality: QualitySettings) {
    this.maxCount = Math.max(8, quality.pedestrians);
    this.group.name = 'pedestrians';

    const bodyGeo = new THREE.CapsuleGeometry(0.155, 0.46, 3, 8);
    bodyGeo.translate(0, 1.02, 0);
    const headGeo = new THREE.SphereGeometry(0.105, 8, 7);
    headGeo.translate(0, 1.5, 0);
    const legGeo = new THREE.BoxGeometry(0.11, 0.52, 0.13);
    legGeo.translate(0, -0.26, 0);
    const skirtGeo = new THREE.ConeGeometry(0.26, 0.72, 8, 1, true);
    skirtGeo.translate(0, 0.72, 0);

    const mat = () =>
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0.02 });
    this.body = new THREE.InstancedMesh(bodyGeo, mat(), this.maxCount);
    this.head = new THREE.InstancedMesh(headGeo, mat(), this.maxCount);
    this.legL = new THREE.InstancedMesh(legGeo, mat(), this.maxCount);
    this.legR = new THREE.InstancedMesh(legGeo.clone(), mat(), this.maxCount);
    this.skirt = new THREE.InstancedMesh(skirtGeo, mat(), this.maxCount);
    for (const mesh of [this.body, this.head, this.legL, this.legR, this.skirt]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = quality.shadows;
      this.group.add(mesh);
    }
    this.setQuality(quality);
  }

  setQuality(quality: QualitySettings): void {
    const wanted = Math.max(6, quality.pedestrians);
    const active = Math.min(wanted, this.maxCount);
    while (this.peds.length > wanted) this.peds.pop();
    while (this.peds.length < wanted) this.peds.push(this.spawnPed());
    for (const mesh of [this.body, this.head, this.legL, this.legR, this.skirt]) {
      mesh.count = active;
      mesh.castShadow = quality.shadows;
    }
  }

  private spawnPed(): Ped {
    const path = Math.floor(this.rng() * PED_PATHS.length);
    const t = this.rng();
    const female = this.rng() < 0.42;
    const scale = 0.9 + this.rng() * 0.18;
    const idx = this.peds.length;
    const color = new THREE.Color(SHIRT_COLORS[Math.floor(this.rng() * SHIRT_COLORS.length)]);
    const skin = new THREE.Color(SKIN_TONES[Math.floor(this.rng() * SKIN_TONES.length)]);
    const legs = new THREE.Color(LEG_COLORS[Math.floor(this.rng() * LEG_COLORS.length)]);
    this.body.setColorAt(idx, color);
    this.head.setColorAt(idx, skin);
    this.legL.setColorAt(idx, legs);
    this.legR.setColorAt(idx, legs);
    this.skirt.setColorAt(
      idx,
      new THREE.Color(female ? ['#b8352a', '#2f6b8a', '#6b2a7a', '#2f7a4f'][Math.floor(this.rng() * 4)] : color),
    );
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
    if (this.head.instanceColor) this.head.instanceColor.needsUpdate = true;
    if (this.legL.instanceColor) this.legL.instanceColor.needsUpdate = true;
    if (this.legR.instanceColor) this.legR.instanceColor.needsUpdate = true;
    if (this.skirt.instanceColor) this.skirt.instanceColor.needsUpdate = true;
    return {
      path,
      t,
      dir: this.rng() < 0.5 ? 1 : -1,
      speed: 0.85 + this.rng() * 0.65,
      pause: this.rng() * 3,
      phase: this.rng() * TAU,
      height: scale,
      sideOffset: (this.rng() - 0.5) * 0.9,
      stepAside: 0,
      skirt: female ? 1 : 0,
    };
  }

  /** The player's position is used for gentle avoidance and reactions. */
  update(dt: number, playerX: number, playerZ: number, playerSpeed: number): void {
    for (let i = 0; i < this.peds.length; i++) {
      const ped = this.peds[i];
      const path = PED_PATHS[ped.path];
      const len = Math.hypot(path.bx - path.ax, path.bz - path.az);
      const dirX = (path.bx - path.ax) / len;
      const dirZ = (path.bz - path.az) / len;

      // distance to player for reactions
      const px = path.ax + (path.bx - path.ax) * ped.t;
      const pz = path.az + (path.bz - path.az) * ped.t;
      const dToPlayer = Math.hypot(px - playerX, pz - playerZ);
      const threatened = dToPlayer < 3.6 && playerSpeed > 0.6;
      const targetAside = threatened ? 0.9 : 0;
      ped.stepAside = damp(ped.stepAside, targetAside, 5, dt);

      if (ped.pause > 0) {
        ped.pause -= dt;
      } else if (!threatened || dToPlayer > 2.2) {
        const move = (ped.speed * dt) / len;
        ped.t += move * ped.dir;
        if (ped.t > 1) {
          ped.t = 1;
          ped.dir = -1;
          ped.pause = 0.6 + this.rng() * 3.4;
        } else if (ped.t < 0) {
          ped.t = 0;
          ped.dir = 1;
          ped.pause = 0.6 + this.rng() * 3.4;
        }
      }

      // position with a lateral offset perpendicular to the path
      const perpX = -dirZ;
      const perpZ = dirX;
      const walking = ped.pause <= 0 && !threatened;
      ped.phase += dt * (walking ? ped.speed * 8.5 : 0.6);
      const bob = walking ? Math.abs(Math.sin(ped.phase)) * 0.035 : 0;
      const x = px + perpX * (ped.sideOffset + ped.stepAside * 0.55);
      const z = pz + perpZ * (ped.sideOffset + ped.stepAside * 0.55);
      const yaw = Math.atan2(dirX * ped.dir, dirZ * ped.dir);

      this.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const s = ped.height;
      this.pos.set(x, bob, z);
      this.scale.set(s, s, s);
      this.matrix.compose(this.pos, this.quat, this.scale);
      this.body.setMatrixAt(i, this.matrix);
      this.head.setMatrixAt(i, this.matrix);

      const swing = walking ? Math.sin(ped.phase) * 0.55 : 0;
      for (const [mesh, sign] of [
        [this.legL, 1],
        [this.legR, -1],
      ] as [THREE.InstancedMesh, number][]) {
        const legQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(swing * sign, yaw, 0, 'YXZ'));
        const legPos = new THREE.Vector3(
          x + Math.cos(yaw) * 0.09 * sign,
          0.72 + bob,
          z - Math.sin(yaw) * 0.09 * sign,
        );
        this.matrix.compose(legPos, legQuat, new THREE.Vector3(1, 1, 1));
        mesh.setMatrixAt(i, this.matrix);
      }

      if (ped.skirt > 0.5) {
        this.matrix.compose(new THREE.Vector3(x, 0.02 + bob, z), this.quat, new THREE.Vector3(1, 1, 1));
        this.skirt.setMatrixAt(i, this.matrix);
      } else {
        this.matrix.compose(new THREE.Vector3(0, -50, 0), this.quat, new THREE.Vector3(0.001, 0.001, 0.001));
        this.skirt.setMatrixAt(i, this.matrix);
      }
    }
    this.body.instanceMatrix.needsUpdate = true;
    this.head.instanceMatrix.needsUpdate = true;
    this.legL.instanceMatrix.needsUpdate = true;
    this.legR.instanceMatrix.needsUpdate = true;
    this.skirt.instanceMatrix.needsUpdate = true;
    void clamp;
  }

  dispose(): void {
    for (const mesh of [this.body, this.head, this.legL, this.legR, this.skirt]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.group.clear();
  }
}
