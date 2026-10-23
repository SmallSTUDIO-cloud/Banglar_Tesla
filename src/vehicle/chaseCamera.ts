/**
 * Third-person chase camera: frame-rate independent follow, look-ahead,
 * spring-arm collision avoidance against the city colliders, and an additive
 * trauma-based shake (never applied to the simulated vehicle).
 */

import * as THREE from 'three';
import { CAMERA } from '../core/config';
import { clamp, clamp01, damp, shortAngle } from '../core/mathx';

interface BoxLike {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
}

export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  private yaw = 0;
  private trauma = 0;
  private currentDistance = CAMERA.distance;
  private mode: 'chase' | 'close' = 'chase';
  private shakeEnabled = true;
  private smooth = 1;
  private focus = new THREE.Vector3();
  private shakeTime = 0;
  private reduceMotion = false;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.camera.fov = CAMERA.fov;
    this.camera.near = 0.15;
    this.camera.far = 400;
    this.camera.updateProjectionMatrix();
  }

  setMode(mode: 'chase' | 'close'): void {
    this.mode = mode;
  }

  setShakeEnabled(enabled: boolean): void {
    this.shakeEnabled = enabled;
  }

  setReduceMotion(reduce: boolean): void {
    this.reduceMotion = reduce;
  }

  addTrauma(amount: number): void {
    if (!this.shakeEnabled) return;
    this.trauma = clamp01(this.trauma + amount * (this.reduceMotion ? 0.35 : 1));
  }

  /** Snap instantly (used on spawn / recovery) to avoid a whip across the map. */
  snapTo(x: number, z: number, yaw: number): void {
    this.yaw = yaw;
    this.focus.set(x, 1.2, z);
    this.currentDistance = this.mode === 'close' ? CAMERA.closeDistance : CAMERA.distance;
    this.updateCamera(0, x, z, yaw, 0, [], true);
  }

  update(
    dt: number,
    x: number,
    z: number,
    yaw: number,
    speed: number,
    colliders: BoxLike[],
    force = false,
    groundY = 0,
  ): void {
    this.updateCamera(dt, x, z, yaw, speed, colliders, force, groundY);
  }

  private updateCamera(
    dt: number,
    x: number,
    z: number,
    yaw: number,
    speed: number,
    colliders: BoxLike[],
    force: boolean,
    groundY = 0,
  ): void {
    const damping = this.reduceMotion ? 0.35 : 1;
    if (force) {
      this.yaw = yaw;
    } else {
      // follow the heading, but slower while reversing so the view stays stable
      const followRate = (speed < -0.2 ? 1.4 : CAMERA.yawRate) * damping;
      this.yaw = this.yaw + shortAngle(this.yaw, yaw) * (1 - Math.exp(-followRate * dt));
    }

    const baseDist = this.mode === 'close' ? CAMERA.closeDistance : CAMERA.distance;
    const baseHeight = this.mode === 'close' ? CAMERA.closeHeight : CAMERA.height;
    const lookAhead = clamp(speed * 0.5, -1.2, CAMERA.lookAhead);
    const aheadX = x + Math.sin(this.yaw) * lookAhead;
    const aheadZ = z + Math.cos(this.yaw) * lookAhead;
    const t = force ? 1 : 1 - Math.exp(-CAMERA.followRate * damping * dt);
    this.focus.lerp(new THREE.Vector3(aheadX, 1.15 + groundY, aheadZ), t);

    const desiredDist = baseDist + clamp(Math.abs(speed) * 0.06, 0, 0.9);
    this.currentDistance = damp(this.currentDistance, desiredDist, 4, dt);

    const backX = -Math.sin(this.yaw);
    const backZ = -Math.cos(this.yaw);
    const pivot = new THREE.Vector3(this.focus.x + backX * 0.2, this.focus.y + baseHeight * 0.55, this.focus.z + backZ * 0.2);
    const desired = new THREE.Vector3(
      this.focus.x + backX * this.currentDistance,
      this.focus.y + baseHeight,
      this.focus.z + backZ * this.currentDistance,
    );

    // Spring arm: pull in when a building would block the view.
    const hit = this.raycast(pivot, desired, colliders);
    let dist = this.currentDistance;
    if (hit < 1) {
      dist = Math.max(1.4, this.currentDistance * hit - 0.35);
    }
    const finalPos = new THREE.Vector3(
      this.focus.x + backX * dist,
      this.focus.y + baseHeight * (0.65 + 0.35 * (dist / this.currentDistance)),
      this.focus.z + backZ * dist,
    );

    // Additive trauma shake (smooth, self-decaying, camera only).
    this.trauma = Math.max(0, this.trauma - dt * 1.35);
    this.shakeTime += dt * 26;
    const shake = this.trauma * this.trauma;
    const shakeX = Math.sin(this.shakeTime * 1.7) * 0.09 * shake;
    const shakeY = Math.sin(this.shakeTime * 2.3 + 1.1) * 0.06 * shake;

    if (force) {
      this.camera.position.copy(finalPos);
    } else {
      this.camera.position.lerp(finalPos, 1 - Math.exp(-14 * dt));
    }
    this.camera.position.x += shakeX;
    this.camera.position.y += shakeY;
    this.camera.lookAt(this.focus.x + shakeX * 0.5, this.focus.y + 0.4, this.focus.z);
    this.camera.rotation.z += Math.sin(this.shakeTime * 1.1) * 0.012 * shake;

    // mild speed-based FOV, never enough to feel unstable
    const targetFov = CAMERA.fov + clamp(Math.abs(speed) * 0.42, 0, 3.2);
    this.camera.fov = damp(this.camera.fov, targetFov, 2.5, dt);
    this.camera.updateProjectionMatrix();
    void this.smooth;
  }

  /** Returns 0..1 fraction of the segment that is clear. */
  private raycast(from: THREE.Vector3, to: THREE.Vector3, colliders: BoxLike[]): number {
    if (colliders.length === 0) return 1;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    let best = 1;
    for (const c of colliders) {
      if (c.height < 2.2) continue;
      const t = rayAabb(from.x, from.y, from.z, dx, dy, dz, c.minX, c.maxX, 0, c.height, c.minZ, c.maxZ);
      if (t >= 0 && t < best) best = t;
    }
    return best;
  }
}

/** Slab test; returns entry t in 0..1 or -1. */
function rayAabb(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  minZ: number,
  maxZ: number,
): number {
  let tmin = 0;
  let tmax = 1;
  const axes: [number, number, number, number][] = [
    [ox, dx, minX, maxX],
    [oy, dy, minY, maxY],
    [oz, dz, minZ, maxZ],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-6) {
      if (o < lo || o > hi) return -1;
    } else {
      let t1 = (lo - o) / d;
      let t2 = (hi - o) / d;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}
