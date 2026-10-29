/** Recycled wheel-contact rain spray: one draw, fixed memory, never full-screen. */
import * as THREE from 'three';
import { clamp, mulberry32 } from '../core/mathx';

const CAPACITY = 48;
export class WheelSplashes {
  readonly group = new THREE.Group();
  private readonly mesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.10, 0.18),
    new THREE.MeshBasicMaterial({ color: 0xd5e4e7, transparent: true, opacity: 0.52, depthWrite: false, side: THREE.DoubleSide }),
    CAPACITY,
  );
  private readonly x = new Float32Array(CAPACITY);
  private readonly y = new Float32Array(CAPACITY);
  private readonly z = new Float32Array(CAPACITY);
  private readonly vx = new Float32Array(CAPACITY);
  private readonly vy = new Float32Array(CAPACITY);
  private readonly vz = new Float32Array(CAPACITY);
  private readonly life = new Float32Array(CAPACITY);
  private readonly matrix = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly position = new THREE.Vector3();
  private readonly rng = mulberry32(78122);
  private cursor = 0;
  private spawnAccum = 0;
  activeCount = 0;

  constructor() {
    this.group.name = 'pooled-wheel-splashes';
    this.mesh.name = 'pooled-splash-drops';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.count = 0;
    this.group.add(this.mesh);
  }

  update(dt: number, x: number, y: number, z: number, yaw: number, speed: number,
    wetness: number, dynamic: boolean, cameraQuat?: THREE.Quaternion): void {
    if (cameraQuat) this.quat.copy(cameraQuat);
    const strength = clamp(wetness, 0, 1) * clamp(Math.abs(speed) / 6, 0, 1);
    if (strength > 0.04) {
      this.spawnAccum += dt * strength * (dynamic ? 36 : 12);
      let newDrops = Math.min(5, Math.floor(this.spawnAccum));
      this.spawnAccum -= newDrops;
      while (newDrops-- > 0) {
        const i = this.cursor++ % CAPACITY;
        const side = this.cursor % 2 === 0 ? 1 : -1;
        const fx = Math.sin(yaw), fz = Math.cos(yaw);
        this.x[i] = x - fx * 0.68 - Math.cos(yaw) * side * 0.55;
        this.z[i] = z - fz * 0.68 + Math.sin(yaw) * side * 0.55;
        this.y[i] = y + 0.12;
        this.vx[i] = side * Math.cos(yaw) * (0.8 + this.rng()) - fx * 0.45;
        this.vz[i] = -side * Math.sin(yaw) * (0.8 + this.rng()) - fz * 0.45;
        this.vy[i] = 1.1 + this.rng() * 1.2;
        this.life[i] = 0.32 + this.rng() * 0.28;
      }
    } else {
      this.spawnAccum = 0;
    }
    let highest = -1, count = 0;
    for (let i = 0; i < CAPACITY; i++) {
      if (this.life[i] > 0) {
        this.life[i] = Math.max(0, this.life[i] - dt);
        this.x[i] += this.vx[i] * dt;
        this.y[i] += this.vy[i] * dt;
        this.z[i] += this.vz[i] * dt;
        this.vy[i] -= 8.5 * dt;
        if (this.y[i] < y + 0.025) this.life[i] = 0;
      }
      if (this.life[i] > 0) {
        highest = i;
        count++;
        this.position.set(this.x[i], this.y[i], this.z[i]);
        const size = clamp(this.life[i] * 1.8, 0.1, 0.85);
        this.scale.set(size, size, size);
      } else {
        this.position.set(0, -1000, 0);
        this.scale.set(0, 0, 0);
      }
      this.matrix.compose(this.position, this.quat, this.scale);
      this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.count = highest + 1;
    this.mesh.instanceMatrix.needsUpdate = count > 0;
    this.activeCount = count;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
