/**
 * Arcade-simulation rickshaw controller. Deliberately engine-free (no three.js)
 * so the whole driving model can be unit-tested in node.
 *
 * Feel targets: slow build-up, weighty coasting, strong low-speed steering,
 * stable high-speed behaviour, forgiving collisions, no random rollovers.
 */

import { RIDE } from '../core/config';
import { clamp, clamp01, lerp, moveTowards, TAU } from '../core/mathx';

export interface BoxCollider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
}

export interface DriveInput {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
}

export interface DriveTuning {
  maxSpeed: number;
  accel: number;
  brakeDecel: number;
  steerMaxLow: number;
  steerMaxHigh: number;
  grip: number;
}

export interface StepEvents {
  /** Collision impulse magnitude (0 = none). */
  impact: number;
  impactX: number;
  impactZ: number;
  distance: number;
  /** True when the wheels are on a raised footpath. */
  onSidewalk: boolean;
  stuck: boolean;
}

export type SurfaceSampler = (x: number, z: number) => 'road' | 'sidewalk' | 'offroad';
export type HeightSampler = (x: number, z: number) => number;

export class RickshawController {
  x = 0;
  z = 0;
  yaw = 0;
  speed = 0;
  steerAngle = 0;
  y = 0;
  pitch = 0;
  roll = 0;
  lateralAccel = 0;
  acceleration = 0;
  frontHeight = 0;
  rearHeight = 0;
  distanceDriven = 0;
  reverseTimer = 0;
  stuckTimer = 0;
  stuck = false;
  private stuckWindow = 0;
  private stuckTravelled = 0;
  lastImpact = 0;
  onSidewalk = false;
  /** Total collisions this trip (used for mission quality). */
  hits = 0;
  /** Hard braking events this trip. */
  hardBrakes = 0;

  private prevSpeed = 0;
  private tuning: DriveTuning = {
    maxSpeed: RIDE.maxSpeed,
    accel: RIDE.accel,
    brakeDecel: RIDE.brakeDecel,
    steerMaxLow: RIDE.maxSteerLow,
    steerMaxHigh: RIDE.maxSteerHigh,
    grip: 0.7,
  };

  constructor(
    private colliders: BoxCollider[],
    private heightAt: HeightSampler,
    private surfaceAt: SurfaceSampler,
  ) {}

  setTuning(t: DriveTuning): void {
    this.tuning = { ...this.tuning, ...t };
  }

  setColliders(colliders: BoxCollider[]): void {
    this.colliders = colliders;
  }

  reset(x: number, z: number, yaw: number): void {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.speed = 0;
    this.steerAngle = 0;
    this.y = this.heightAt(x, z);
    this.hits = 0;
    this.hardBrakes = 0;
    this.distanceDriven = 0;
    this.stuck = false;
    this.stuckTimer = 0;
    this.reverseTimer = 0;
  }

  get forward(): { x: number; z: number } {
    return { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
  }

  /** One fixed physics step. `dt` should be a stable value (1/60). */
  step(dt: number, input: DriveInput, steeringSensitivity = 1, deadzone = 0): StepEvents {
    const t = this.tuning;
    const surface = this.surfaceAt(this.x, this.z);
    this.onSidewalk = surface === 'sidewalk';
    const surfacePenalty = surface === 'road' ? 1 : surface === 'sidewalk' ? 0.78 : 0.62;
    const maxSpeed = t.maxSpeed * surfacePenalty;

    // ------------------------------------------------------------- steering
    const speedFactor = clamp01(Math.abs(this.speed) / Math.max(0.1, t.maxSpeed));
    const steerMax = lerp(t.steerMaxLow, t.steerMaxHigh, speedFactor);
    const rawSteer = Math.abs(input.steer) < deadzone ? 0 : input.steer;
    const eased = Math.sign(rawSteer) * Math.pow(clamp01(Math.abs(rawSteer)), 1.25);
    const target = eased * steerMax * clamp(steeringSensitivity, 0.4, 1.6);
    const rate = Math.abs(target) < 0.01 ? RIDE.steerReturn : RIDE.steerRate;
    this.steerAngle = moveTowards(this.steerAngle, target, rate * dt * steerMax * 3.4);

    // -------------------------------------------------------- longitudinal
    const throttle = clamp01(input.throttle);
    const brake = clamp01(input.brake);

    if (brake > 0.02) {
      if (this.speed > 0.02) {
        const before = this.speed;
        this.speed = Math.max(0, this.speed - t.brakeDecel * brake * dt);
        if (this.speed < 0.06) this.speed = 0;
        if (before > 3.4 && this.speed < before - 2.4) this.hardBrakes++;
        this.reverseTimer = 0;
      } else if (throttle < 0.05) {
        // deliberate reverse: hold the brake while stopped
        this.reverseTimer += dt;
        if (this.reverseTimer > RIDE.reverseHold) {
          this.speed = Math.max(-RIDE.maxReverse, this.speed - t.accel * 0.5 * dt);
        }
      }
    } else {
      this.reverseTimer = 0;
    }

    if (throttle > 0.02 && this.speed >= -0.02) {
      const falloff = 1 - clamp01(this.speed / Math.max(0.1, maxSpeed)) * RIDE.accelFalloff;
      this.speed += t.accel * throttle * Math.max(0.06, falloff) * dt;
    } else if (throttle > 0.02 && this.speed < -0.02) {
      // pedalling while rolling backwards brakes gently first
      this.speed = Math.min(0, this.speed + t.brakeDecel * 0.7 * dt);
    }

    // coasting drag
    if (throttle < 0.02 && brake < 0.02) {
      const drag = (RIDE.coastDrag + RIDE.rollingDrag * Math.abs(this.speed)) * dt;
      this.speed = Math.abs(this.speed) <= drag ? 0 : this.speed - Math.sign(this.speed) * drag;
    }
    this.speed = clamp(this.speed, -RIDE.maxReverse, Math.max(maxSpeed, 0.5));

    // --------------------------------------------------------------- yaw
    // Bicycle model: reversing speed flips the turn direction naturally.
    const yawRate = (this.speed / RIDE.wheelbase) * Math.tan(this.steerAngle) * (0.72 + 0.32 * t.grip);
    const clampedYawRate = clamp(yawRate, -2.6, 2.6);
    this.yaw = (this.yaw + clampedYawRate * dt) % TAU;
    if (this.yaw < 0) this.yaw += TAU;

    const latAccel = this.speed * clampedYawRate;
    this.lateralAccel = latAccel;

    // ---------------------------------------------------------- integrate
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const stepDist = this.speed * dt;
    this.x += fx * stepDist;
    this.z += fz * stepDist;
    this.distanceDriven += Math.abs(stepDist);

    // --------------------------------------------------------- collisions
    const impact = this.resolveCollisions();
    this.lastImpact = impact.magnitude;
    if (impact.magnitude > 0.4) this.hits++;

    // ------------------------------------------------------------ ground
    const front = this.heightAt(this.x + fx * 0.8, this.z + fz * 0.8);
    const rear = this.heightAt(this.x - fx * 0.8, this.z - fz * 0.8);
    this.frontHeight = front;
    this.rearHeight = rear;
    const targetY = (front + rear) / 2;
    this.y += (targetY - this.y) * clamp01(dt * 14);
    const targetPitch = Math.atan2(front - rear, 1.6);
    this.pitch += (targetPitch - this.pitch) * clamp01(dt * 9);
    const targetRoll = clamp(-latAccel * 0.016, -0.075, 0.075) + (surface === 'sidewalk' ? Math.sin(this.distanceDriven * 9) * 0.004 : 0);
    this.roll += (targetRoll - this.roll) * clamp01(dt * 8);

    this.acceleration = (this.speed - this.prevSpeed) / Math.max(dt, 0.0001);
    this.prevSpeed = this.speed;

    // --------------------------------------------------------- stuck check
    // Speed alone is not enough: a rickshaw can be pinned against a wall with
    // the wheels spinning. Track how far we actually travelled instead.
    this.stuckWindow += dt;
    this.stuckTravelled += Math.abs(stepDist);
    if (this.stuckWindow >= 0.5) {
      const movedPerSecond = this.stuckTravelled / this.stuckWindow;
      if (throttle > 0.4 && movedPerSecond < 0.35) this.stuckTimer += this.stuckWindow;
      else this.stuckTimer = Math.max(0, this.stuckTimer - this.stuckWindow * 1.6);
      this.stuckWindow = 0;
      this.stuckTravelled = 0;
    }
    this.stuck = this.stuckTimer > 2.2;

    return {
      impact: impact.magnitude,
      impactX: impact.nx,
      impactZ: impact.nz,
      distance: Math.abs(stepDist),
      onSidewalk: this.onSidewalk,
      stuck: this.stuck,
    };
  }

  /** Circle-vs-AABB resolution against the static world. */
  private resolveCollisions(): { magnitude: number; nx: number; nz: number } {
    const radius = RIDE.bodyRadius;
    let magnitude = 0;
    let nx = 0;
    let nz = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (const c of this.colliders) {
        if (c.height < 0.35) continue;
        const closestX = clamp(this.x, c.minX, c.maxX);
        const closestZ = clamp(this.z, c.minZ, c.maxZ);
        let dx = this.x - closestX;
        let dz = this.z - closestZ;
        let dist = Math.hypot(dx, dz);
        if (dist >= radius) continue;
        if (dist < 0.0001) {
          // deep inside: push out along the shallowest axis
          const toMinX = this.x - c.minX;
          const toMaxX = c.maxX - this.x;
          const toMinZ = this.z - c.minZ;
          const toMaxZ = c.maxZ - this.z;
          const min = Math.min(toMinX, toMaxX, toMinZ, toMaxZ);
          if (min === toMinX) {
            dx = -1;
            dz = 0;
          } else if (min === toMaxX) {
            dx = 1;
            dz = 0;
          } else if (min === toMinZ) {
            dx = 0;
            dz = -1;
          } else {
            dx = 0;
            dz = 1;
          }
          dist = 1;
          this.x = closestX + dx * (radius + 0.02);
          this.z = closestZ + dz * (radius + 0.02);
        } else {
          this.x += (dx / dist) * (radius - dist + 0.01);
          this.z += (dz / dist) * (radius - dist + 0.01);
        }
        const nxLocal = dx / (dist || 1);
        const nzLocal = dz / (dist || 1);
        const forwardDot = Math.sin(this.yaw) * nxLocal + Math.cos(this.yaw) * nzLocal;
        const speedInto = -Math.abs(this.speed * forwardDot);
        const mag = Math.min(3, Math.abs(speedInto) * 0.55 + 0.25);
        if (mag > magnitude) {
          magnitude = mag;
          nx = nxLocal;
          nz = nzLocal;
        }
        this.speed *= 1 - RIDE.collisionBounce * 0.6;
        if (Math.abs(this.speed) < 0.05) this.speed = 0;
      }
    }
    return { magnitude, nx, nz };
  }
}
